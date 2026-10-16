#!/usr/bin/env python3
"""Static offline-conformance checker for diagram output (HTML/SVG).

Narrow diagram-output conformance check for the FORGE offline export
profile. Verifies a generated diagram file makes ZERO network requests
and carries no active content, without executing it.

Design: CLOSED ALLOWLIST. A small permitted markup/CSS/resource subset is
defined below; anything outside it fails closed. This is deliberately not
a blacklist: new active-content constructs are refused by default.

Usage:
    python3 check_offline.py <file> [--json]

Exit 0 when the file is offline-clean; exit 1 with findings otherwise.
Findings carry fixed reason codes and safe structural locations only --
never source-derived content (no URLs, CSS text, attribute values, parser
exception excerpts, or filenames), per the profile's counts-only rule.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
import xml.etree.ElementTree as ET
from html.parser import HTMLParser
from pathlib import Path

# Offline profile bounds (imported SVG/XML is untrusted).
MAX_BYTES = 2_000_000        # 2 MB per file
MAX_ELEMENTS = 2_000         # element count cap
MAX_NESTING = 64             # element nesting depth cap
MAX_DIMENSION = 8_000        # rendered dimension cap (px)

# ---------------------------------------------------------------------------
# Closed policy: permitted markup subset.
#
# Rationale: diagrams need containers, shapes, text, and presentation
# attributes. Everything else -- embedded documents (object/iframe/embed),
# scripts, event handlers, navigation directives (meta refresh), form
# machinery, media with remote sources -- is unnecessary and refused.
# ---------------------------------------------------------------------------

SVG_ELEMENTS = frozenset({
    "svg", "g", "defs", "rect", "circle", "ellipse", "line", "polyline",
    "polygon", "path", "text", "tspan", "title", "desc", "use", "style",
    "image",
})

HTML_ELEMENTS = frozenset({
    "html", "head", "title", "body", "style", "link", "meta",
    "div", "span", "p", "h1", "h2", "h3", "h4", "h5", "h6",
}) | SVG_ELEMENTS

# HTML void elements: never pushed on the nesting stack, never require an
# end tag. (SVG is parsed as strict XML, so this applies to HTML only.)
VOID_ELEMENTS = frozenset({
    "meta", "link", "br", "hr", "img", "input", "col", "area", "base",
    "embed", "source", "track", "wbr", "param",
})

# Permitted attributes (checked against the namespace-local name, so
# xlink:href is evaluated as href and s:script as script).
ADMITTED_ATTRS = frozenset({
    # structural / metadata
    "id", "class", "style", "lang", "role", "charset", "rel", "href",
    "viewbox", "xmlns", "title", "alt",
    # SVG geometry / presentation
    "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry",
    "width", "height", "fill", "stroke", "stroke-width",
    "font-family", "font-size", "font-weight", "text-anchor",
    "points", "d", "transform", "opacity",
})

# Per-element attribute narrowing. Elements not listed here accept the
# global admitted set (subject to the URL/CSS value checks below).
# meta: charset only -- http-equiv/content/name (refresh, navigation) refused.
ELEMENT_ATTRS = {
    "meta": frozenset({"charset"}),
    "link": frozenset({"rel", "href", "id", "class"}),
}

# Attributes whose values are interpreted as URLs by the browser.
URL_ATTRS = frozenset({"href"})

FONTS_HOST_RE = re.compile(r"fonts\.googleapis\.com|fonts\.gstatic\.com",
                           re.IGNORECASE)
ENTITY_RE = re.compile(r"<!ENTITY\b", re.IGNORECASE)
DOCTYPE_INTERNAL_RE = re.compile(r"<!DOCTYPE[^>\[]*\[", re.IGNORECASE | re.DOTALL)
DOCTYPE_RE = re.compile(r"<!DOCTYPE\b", re.IGNORECASE)

# CSS: detection runs on RAW CSS tokenized by a quote/escape/comment-aware
# scanner (_css_strip_comments_safe): a /* sequence inside a quoted string
# is string content, never a comment, so quoted URLs survive comment
# stripping and reach the classifier whole. Escapes are decoded PER TOKEN
# (_css_decode_ident_at for identifiers, _css_unescape on url() arguments,
# import strings, and property names) -- never globally before lexing --
# because decoding \2f\2a to /* before comment stripping creates fake
# comments that hide fetch-bearing references (D641-001 round 5).
# url()/@import extraction is string/paren/brace aware (_css_extract_urls,
# _css_scan_rules); unterminated strings, comments, parens or braces fail
# closed with F_MALFORMED_CSS instead of silently skipping.
# (url/@import/declaration matching is done by the string-aware scanners
# below, not by regexes, so quoted comment markers and semicolons inside
# strings cannot create detection gaps.)
_CSS_WS = " \t\n\r\f"

# Closed CSS property set: the only declarations admitted anywhere (style
# blocks and style attributes). Anything else fails closed -- no general
# browser sanitizer is intended (D641-001).
ADMITTED_CSS_PROPS = frozenset({
    "width", "height",
    "fill", "stroke", "stroke-width",
    "font-family", "font-size", "font-weight",
    "text-anchor", "opacity",
})

# Functions admitted inside admitted declarations. url() is checked by
# _url_codes (local #fragment and data:image: only); every other function
# name is refused outright -- image-set() and friends cannot sneak in.
ADMITTED_CSS_FUNCS = frozenset({"url"})

# Unadmitted XML processing instructions (the XML declaration <?xml ...?>
# is allowed; xml-stylesheet and everything else is refused before the
# XML parser discards them).
XML_PI_RE = re.compile(r"<\?(.*?)\?>", re.DOTALL)
XML_DECL_RE = re.compile(r"^xml[\s?/]", re.IGNORECASE)
HTML_PI_RE = re.compile(r"<\?", re.IGNORECASE)
DIM_VALUE_RE = re.compile(
    r"^\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?)\s*([a-zA-Z%]*)\s*$")
VIEWBOX_SPLIT_RE = re.compile(r"[\s,]+")


def _local(name: str) -> str:
    """Namespace-local, lowercase name: '{ns}tag' -> 'tag', 's:tag' -> 'tag'."""
    if "}" in name:
        name = name.rsplit("}", 1)[1]
    if ":" in name:
        name = name.rsplit(":", 1)[1]
    return name.lower()


def _is_xmlns_decl(raw_name: str) -> bool:
    low = raw_name.lower()
    return low == "xmlns" or low.startswith("xmlns:")


def _css_unescape(css: str) -> str:
    """Unescape CSS escape sequences per CSS Syntax Module Level 3.

    Handles \\<1-6 hex digits>[whitespace] and \\<char>. This decodes the
    browser-interpreted content of ONE token (a quoted string, a url()
    argument, an identifier, a property name) -- it must never be applied
    to whole CSS before tokenization (D641-001 round 5): decoding escapes
    first would turn \\2f\\2a into a fake /* comment delimiter that the
    comment stripper then removes, hiding fetch-bearing references.
    """
    out: list[str] = []
    i, n = 0, len(css)
    hexdigits = "0123456789abcdefABCDEF"
    while i < n:
        c = css[i]
        if c == "\\" and i + 1 < n:
            j = i + 1
            hexpart = ""
            while j < n and len(hexpart) < 6 and css[j] in hexdigits:
                hexpart += css[j]
                j += 1
            if hexpart:
                if j < n and css[j] in " \t\n\r\f":
                    j += 1
                cp = int(hexpart, 16)
                if cp == 0 or cp > 0x10FFFF or 0xD800 <= cp <= 0xDFFF:
                    cp = 0xFFFD
                out.append(chr(cp))
                i = j
            else:
                nc = css[i + 1]
                if nc == "\n":
                    i += 2  # escaped newline contributes nothing
                else:
                    out.append(nc)
                    i += 2
        else:
            out.append(c)
            i += 1
    return "".join(out)


def _url_codes(url: str) -> list[str]:
    """Fail-closed URL classification. Returns finding codes (possibly empty).

    Operates on the browser-interpreted (entity-decoded, stripped) value.
    Anything that is not an empty/fragment/data:image: reference is a
    network fetch and is refused.
    """
    u = url.strip().strip("'\"").strip()
    if not u or u.startswith("#"):
        return []
    low = u.lower()
    if low.startswith("data:"):
        if low.startswith("data:image/"):
            return []
        if low.startswith("data:text/html"):
            return ["F_EXECUTABLE_URL"]
        return ["F_EXTERNAL_REFERENCE"]  # fail closed on other data: types
    if low.startswith(("javascript:", "vbscript:")):
        return ["F_EXECUTABLE_URL"]
    if FONTS_HOST_RE.search(u):
        return ["F_GOOGLE_FONTS"]
    # Remote, protocol-relative, and bare relative URLs are all fetches.
    return ["F_EXTERNAL_REFERENCE"]


def _check_dimension_value(value: str) -> str | None:
    """Validate one width/height value. Returns a finding code or None.

    Admitted forms: unitless or px, finite, 0 < v <= MAX_DIMENSION.
    Unsupported units (%, em, ...) are rejected, not ignored.
    """
    m = DIM_VALUE_RE.match(value)
    if not m:
        return "F_INVALID_DIMENSION"
    num_s, unit = m.group(1), m.group(2)
    try:
        v = float(num_s)
    except ValueError:
        return "F_INVALID_DIMENSION"
    if not math.isfinite(v):
        return "F_INVALID_DIMENSION"
    if unit not in ("", "px"):
        return "F_UNSUPPORTED_SIZING"
    if v <= 0:
        return "F_INVALID_DIMENSION"
    if v > MAX_DIMENSION:
        return "F_OVERSIZED"
    return None


def _check_viewbox(value: str) -> str | None:
    parts = [p for p in VIEWBOX_SPLIT_RE.split(value.strip()) if p]
    if len(parts) != 4:
        return "F_INVALID_DIMENSION"
    try:
        nums = [float(p) for p in parts]
    except ValueError:
        return "F_INVALID_DIMENSION"
    if not all(math.isfinite(n) for n in nums):
        return "F_INVALID_DIMENSION"
    w, h = nums[2], nums[3]
    if w <= 0 or h <= 0:
        return "F_INVALID_DIMENSION"
    if w > MAX_DIMENSION or h > MAX_DIMENSION:
        return "F_OVERSIZED"
    return None


def _check_processing_instructions(text: str, sink: _FindingSink,
                                   is_svg: bool) -> bool:
    """Reject unadmitted processing instructions before parsers discard them.

    The XML declaration (<?xml ...?>) is allowed. Everything else --
    notably <?xml-stylesheet href="https://..."> -- is refused fail-closed.
    Returns True when a refusal was recorded.
    """
    if is_svg:
        for m in XML_PI_RE.finditer(text):
            if XML_DECL_RE.match(m.group(1).strip()):
                continue  # the XML declaration is admitted
            sink.add("F_UNADMITTED_PI",
                     "processing instruction not admitted by the offline profile")
            return True
    else:
        if HTML_PI_RE.search(text):
            sink.add("F_UNADMITTED_PI",
                     "processing instruction not admitted by the offline profile")
            return True
    return False
    """Internal: stop parsing early on structural excess (fail closed)."""


class _StopScan(Exception):
    """Internal: stop parsing early on structural excess (fail closed)."""


class _FindingSink:
    def __init__(self) -> None:
        self.findings: list[dict] = []

    def add(self, code: str, message: str, loc: str = "") -> None:
        self.findings.append({"code": code, "message": message, "loc": loc})


def _css_string_end(text: str, i: int) -> int:
    """Index just past the closing quote of the string starting at i.

    Backslash escapes the next character (CSS Syntax L3). Returns -1 when
    the string is unterminated.
    """
    q = text[i]
    j = i + 1
    n = len(text)
    while j < n:
        d = text[j]
        if d == "\\" and j + 1 < n:
            j += 2
            continue
        if d == q:
            return j + 1
        j += 1
    return -1


def _css_paren_end(text: str, i: int) -> int:
    """Index just past the paren group closing the '(' at i.

    Strings and nested parens are honored. Returns -1 when unterminated.
    """
    depth = 0
    j, n = i, len(text)
    while j < n:
        d = text[j]
        if d == '"' or d == "'":
            end = _css_string_end(text, j)
            if end < 0:
                return -1
            j = end
        elif d == "\\" and j + 1 < n:
            j += 2
        elif d == "(":
            depth += 1
            j += 1
        elif d == ")":
            depth -= 1
            j += 1
            if depth == 0:
                return j
        else:
            j += 1
    return -1


def _css_strip_comments_safe(text: str) -> tuple[str, bool]:
    """Strip /* ... */ comments with quote/escape awareness.

    A /* sequence inside a quoted string is string content, never a
    comment: it survives stripping so the URL classifier sees the complete
    interpreted URL (the quoted-comment bypass). Unterminated comments or
    strings fail closed (ok=False); the caller must refuse instead of
    checking silently-truncated text. Comments are replaced with nothing
    (CSS preprocessing), which cannot hide spellings from detection.
    """
    out: list[str] = []
    i, n = 0, len(text)
    while i < n:
        c = text[i]
        if c == '"' or c == "'":
            end = _css_string_end(text, i)
            if end < 0:
                return "".join(out), False
            out.append(text[i:end])
            i = end
        elif c == "/" and i + 1 < n and text[i + 1] == "*":
            end = text.find("*/", i + 2)
            if end < 0:
                return "".join(out), False
            i = end + 2
        elif c == "\\" and i + 1 < n:
            out.append(text[i:i + 2])
            i += 2
        else:
            out.append(c)
            i += 1
    return "".join(out), True


def _css_ident_end(text: str, i: int) -> int:
    """Raw end index of the identifier starting at i.

    Identifier characters are consumed raw (backslash escapes are kept as
    source pairs here); the caller decodes with _css_unescape. This keeps
    escape sequences from splitting identifiers during tokenization.
    """
    j, n = i, len(text)
    while j < n:
        d = text[j]
        if d == "\\" and j + 1 < n:
            j += 2
        elif d.isalnum() or d in "-_":
            j += 1
        else:
            break
    return j


def _css_decode_ident_at(text: str, i: int) -> tuple[str, int]:
    """Decode the identifier starting at i. Returns (decoded_lower, raw_end).

    Escapes are decoded per token (CSS Syntax L3), so u\\72l(...) spells
    url(...) and f\\69ll spells fill. The raw end index lets the scanner
    continue on the original text.
    """
    j = _css_ident_end(text, i)
    return _css_unescape(text[i:j]).lower(), j


def _css_extract_urls(value: str) -> tuple[list[str], bool]:
    """Extract url(...) arguments with string and escape awareness.

    Operates on RAW CSS: identifiers (including escaped spellings like
    u\\72l) are decoded per token, and each url() argument is decoded
    per token before classification. Returns (decoded_urls, ok);
    ok=False on unterminated string/paren (fail closed). Arguments keep
    their quotes; _url_codes strips them.
    """
    urls: list[str] = []
    i, n = 0, len(value)
    while i < n:
        c = value[i]
        if c == '"' or c == "'":
            end = _css_string_end(value, i)
            if end < 0:
                return urls, False
            i = end
        elif (c.isalpha() or c in "-_" or c == "\\") and not (
                i > 0 and (value[i - 1].isalnum() or value[i - 1] in "-_")):
            name, j = _css_decode_ident_at(value, i)
            if name == "url":
                k = j
                while k < n and value[k] in _CSS_WS:
                    k += 1
                if k < n and value[k] == "(":
                    arg, k2, ok = _css_url_arg(value, k + 1)
                    if not ok:
                        return urls, False
                    urls.append(_css_unescape(arg))
                    i = k2
                    continue
            i = j
        elif c == "\\" and i + 1 < n:
            i += 2
        else:
            i += 1
    return urls, True


def _css_url_arg(value: str, j: int) -> tuple[str, int, bool]:
    """Parse one url( argument starting at j. Returns (arg, next, ok)."""
    n = len(value)
    while j < n and value[j] in _CSS_WS:
        j += 1
    if j < n and (value[j] == '"' or value[j] == "'"):
        end = _css_string_end(value, j)
        if end < 0:
            return "", j, False
        k = end
        while k < n and value[k] in _CSS_WS:
            k += 1
        if k >= n or value[k] != ")":
            return "", k, False
        return value[j:end], k + 1, True
    buf: list[str] = []
    k = j
    while k < n:
        d = value[k]
        if d == "\\" and k + 1 < n:
            buf.append(value[k:k + 2])
            k += 2
            continue
        if d == ")":
            return "".join(buf), k + 1, True
        if d == '"' or d == "'":
            return "", k, False
        buf.append(d)
        k += 1
    return "", k, False


def _css_extract_functions(value: str) -> tuple[list[str], bool]:
    """Function names invoked in a value; strings are skipped.

    Identifier escapes are decoded per token (image\\2d set() spells
    image-set()). Returns (decoded_lower_names, ok); ok=False on
    unterminated string (fail closed).
    """
    names: list[str] = []
    i, n = 0, len(value)
    while i < n:
        c = value[i]
        if c == '"' or c == "'":
            end = _css_string_end(value, i)
            if end < 0:
                return names, False
            i = end
        elif (c.isalpha() or c in "-_" or c == "\\") and not (
                i > 0 and (value[i - 1].isalnum() or value[i - 1] in "-_")):
            name, j = _css_decode_ident_at(value, i)
            k = j
            while k < n and value[k] in _CSS_WS:
                k += 1
            if k < n and value[k] == "(":
                names.append(name)
            i = j
        elif c == "\\" and i + 1 < n:
            i += 2
        else:
            i += 1
    return names, True


def _css_decl_colon(stmt: str) -> int:
    """Index of the declaration colon: first ':' outside strings/parens.

    Returns -1 when there is none.
    """
    depth = 0
    i, n = 0, len(stmt)
    while i < n:
        c = stmt[i]
        if c == '"' or c == "'":
            end = _css_string_end(stmt, i)
            if end < 0:
                return -1
            i = end
        elif c == "\\" and i + 1 < n:
            i += 2  # escaped colon (\3a) is not the declaration separator
        elif c == "(":
            depth += 1
            i += 1
        elif c == ")":
            depth -= 1
            i += 1
        elif c == ":" and depth == 0:
            return i
        else:
            i += 1
    return -1


def _css_scan_rules(text: str) -> tuple[list, list, bool]:
    """Scan comment-stripped CSS for at-rules and declarations.

    Returns (decls, atrules, ok):
      decls: [(prop, value)] for every `prop: value` outside strings/parens
      atrules: [(name, prelude)] for every @-rule outside strings
      ok: False on unbalanced braces or unterminated strings/parens.
    Selectors and other non-declaration text carry no resource surface and
    are ignored; every declaration and at-rule is fully consumed.
    """
    decls: list[tuple[str, str]] = []
    atrules: list[tuple[str, str]] = []
    buf: list[str] = []
    depth = 0
    i, n = 0, len(text)

    def flush() -> bool:
        stmt = "".join(buf).strip()
        buf.clear()
        if not stmt:
            return True
        if stmt.startswith("@"):
            m = re.match(r"@([a-zA-Z-]+)", stmt)
            if not m:
                return False
            atrules.append((m.group(1).lower(), stmt[m.end():].strip()))
            return True
        ci = _css_decl_colon(stmt)
        if ci < 0:
            return True  # selector text or junk: no resource surface
        # Decode identifier escapes in the property name before judging it:
        # f\69ll spells fill to the browser, and its url() must be
        # classified. A name that is not a clean ident after decoding is
        # not a declaration (e.g. pseudo-class selector).
        prop_raw = stmt[:ci].strip()
        decoded, rend = _css_decode_ident_at(prop_raw, 0)
        if rend != len(prop_raw) or \
                not re.fullmatch(r"[a-zA-Z][a-zA-Z0-9-]*", decoded):
            return True
        decls.append((decoded, stmt[ci + 1:].strip()))
        return True

    while i < n:
        c = text[i]
        if c == '"' or c == "'":
            end = _css_string_end(text, i)
            if end < 0:
                return decls, atrules, False
            buf.append(text[i:end])
            i = end
        elif c == "(":
            end = _css_paren_end(text, i)
            if end < 0:
                return decls, atrules, False
            buf.append(text[i:end])
            i = end
        elif c == "\\" and i + 1 < n:
            buf.append(text[i:i + 2])
            i += 2
        elif c == "{":
            if not flush():
                return decls, atrules, False
            depth += 1
            i += 1
        elif c == "}":
            if not flush():
                return decls, atrules, False
            depth -= 1
            if depth < 0:
                return decls, atrules, False
            i += 1
        elif c == ";":
            if not flush():
                return decls, atrules, False
            i += 1
        else:
            buf.append(c)
            i += 1
    if not flush():
        return decls, atrules, False
    return decls, atrules, True


def _css_import_urls(prelude: str) -> tuple[list[str], bool]:
    """URLs referenced by an @import prelude: url(...) args and quoted
    strings, string-aware. Returns (decoded_urls, ok)."""
    urls, ok = _css_extract_urls(prelude)
    if not ok:
        return urls, False
    i, n = 0, len(prelude)
    while i < n:
        c = prelude[i]
        if c == '"' or c == "'":
            end = _css_string_end(prelude, i)
            if end < 0:
                return urls, False
            s = _css_unescape(prelude[i:end])
            if s not in urls:
                urls.append(s)
            i = end
        elif c == "\\" and i + 1 < n:
            i += 2
        else:
            i += 1
    return urls, True


def _check_css_decls(css: str, sink: _FindingSink, loc: str) -> None:
    """Check CSS under a CLOSED grammar with real tokenization.

    Comments are stripped on RAW CSS by a quote/escape-aware scanner (a /*
    inside a quoted URL is string content, never a comment; escape
    sequences like \\2f\\2a are consumed as source pairs and never become
    comment delimiters at this stage), then every at-rule and declaration
    is consumed by a string/paren/brace-aware scanner. Escapes are decoded
    per token -- identifiers, url() arguments, property names -- before
    classification (D641-001 round 5: global unescape-then-lex created fake
    comments that hid fetch-bearing references). Anything outside the
    admitted subset -- unadmitted properties/functions/at-rules, remote
    url() -- fails closed, as do unterminated strings, comments, parens
    or braces.
    """
    stripped, ok = _css_strip_comments_safe(css)
    if not ok:
        sink.add("F_MALFORMED_CSS",
                 "unterminated CSS comment or string", loc)
        return
    decls, atrules, ok = _css_scan_rules(stripped)
    if not ok:
        sink.add("F_MALFORMED_CSS",
                 "malformed CSS structure", loc)
        return

    for name, prelude in atrules:
        if name == "import":
            urls, uok = _css_import_urls(prelude)
            if not uok:
                sink.add("F_MALFORMED_CSS",
                         "malformed CSS import", loc)
                continue
            for url in urls:
                for code in _url_codes(url):
                    if code == "F_EXTERNAL_REFERENCE":
                        code = "F_REMOTE_CSS"
                    sink.add(code, "remote CSS import not allowed offline",
                             loc)
        else:
            sink.add("F_UNADMITTED_CSS",
                     "CSS at-rule not admitted by the offline profile", loc)

    for prop, value in decls:
        _check_css_decl(prop, value, sink, loc)


def _check_css_decl(prop: str, value: str, sink: _FindingSink,
                    loc: str) -> None:
    """Judge one declaration against the admitted property/function sets."""
    p = _css_unescape(prop).strip().lower()  # decode identifier escapes
    urls, ok = _css_extract_urls(value)
    if not ok:
        sink.add("F_MALFORMED_CSS", "malformed url() in CSS", loc)
        return
    # Resource scan runs on every declaration, even unadmitted ones, so a
    # remote url() is always classified as remote (never masked by a
    # property refusal).
    for url in urls:
        for code in _url_codes(url):
            if code == "F_EXTERNAL_REFERENCE":
                code = "F_REMOTE_CSS"
            sink.add(code, "remote url() in CSS not allowed offline", loc)
    if p not in ADMITTED_CSS_PROPS:
        sink.add("F_UNADMITTED_CSS",
                 "CSS property not admitted by the offline profile", loc)
        return
    funcs, ok = _css_extract_functions(value)
    if not ok:
        sink.add("F_MALFORMED_CSS", "malformed function call in CSS", loc)
        return
    for fname in funcs:
        if fname not in ADMITTED_CSS_FUNCS:
            sink.add("F_UNADMITTED_CSS",
                     "CSS function not admitted by the offline profile", loc)
    if p in ("width", "height"):
        code = _check_dimension_value(_css_unescape(value.split("!")[0]))
        if code:
            sink.add(code, "CSS dimension out of profile bounds", loc)


def _check_attr_value(element: str, attr: str, value: str,
                      sink: _FindingSink, loc: str) -> None:
    """Value checks for admitted attributes (URLs, CSS, dimensions)."""
    if attr in URL_ATTRS:
        for code in _url_codes(value):
            sink.add(code, "external reference not allowed offline", loc)
    elif attr == "style":
        _check_css_decls(value, sink, loc)
    elif attr in ("fill", "stroke"):
        # Resource-bearing presentation attributes: plain colors and local
        # #fragment / data:image: paints are admitted; remote url() is not.
        # URL extraction is string-aware and decodes escapes per token on
        # the RAW value (same semantics as style blocks): a \2f\2a inside
        # the URL is decoded inside the token, never lexed as a comment.
        urls, uok = _css_extract_urls(value)
        if not uok:
            sink.add("F_MALFORMED_CSS",
                     "malformed url() in presentation attribute", loc)
        for url in urls:
            for code in _url_codes(url):
                if code == "F_EXTERNAL_REFERENCE":
                    code = "F_REMOTE_CSS"
                sink.add(code,
                         "remote paint reference not allowed offline", loc)
    elif attr in ("width", "height"):
        code = _check_dimension_value(value)
        if code:
            sink.add(code, f"{attr} dimension out of profile bounds", loc)
    elif attr == "viewbox":
        code = _check_viewbox(value)
        if code:
            sink.add(code, "viewBox out of profile bounds", loc)


def _admitted_attrs_for(element: str, raw_attrs: list[tuple[str, str | None]],
                        sink: _FindingSink, loc: str) -> None:
    """Enforce the attribute allowlist and value checks for one element."""
    allowed = ELEMENT_ATTRS.get(element, ADMITTED_ATTRS)
    for raw_k, v in raw_attrs:
        if _is_xmlns_decl(raw_k):
            continue  # namespace declarations are inert
        k = _local(raw_k)
        if k not in allowed:
            sink.add("F_UNADMITTED_ATTR",
                     "attribute not admitted by the offline profile", loc)
            continue
        _check_attr_value(element, k, v or "", sink, loc)


# ---------------------------------------------------------------------------
# HTML path: strict stack-based nesting on top of HTMLParser.
# ---------------------------------------------------------------------------

class _HtmlScan(_FindingSink, HTMLParser):
    def __init__(self) -> None:
        _FindingSink.__init__(self)
        # convert_charrefs=True: attribute/text values are entity-decoded,
        # i.e. the browser-interpreted values the policy must judge.
        HTMLParser.__init__(self, convert_charrefs=True)
        self.stack: list[str] = []
        self.element_count = 0
        self._style_depth = 0

    def _loc(self) -> str:
        return f"element#{self.element_count}"

    def _open(self, tag: str, attrs: list[tuple[str, str | None]],
              push: bool) -> None:
        self.element_count += 1
        if self.element_count > MAX_ELEMENTS:
            self.add("F_OVERSIZED", "element count exceeds profile bound",
                     self._loc())
            raise _StopScan()
        local = _local(tag)
        loc = self._loc()
        admitted = local in HTML_ELEMENTS
        if not admitted:
            # Fail closed: object/iframe/script/s:script and every other
            # non-diagram element is refused outright. The subtree is still
            # tracked for balance but its attributes/CSS are not trusted.
            self.add("F_UNADMITTED_ELEMENT",
                     "element not admitted by the offline profile", loc)
        else:
            _admitted_attrs_for(local, attrs, self, loc)
        if push:
            self.stack.append(local)
            if local == "style":
                self._style_depth += 1
            if len(self.stack) > MAX_NESTING:
                self.add("F_OVERSIZED",
                         "nesting depth exceeds profile bound", loc)
                raise _StopScan()

    def handle_starttag(self, tag: str,
                        attrs: list[tuple[str, str | None]]) -> None:
        self._open(tag, attrs, push=_local(tag) not in VOID_ELEMENTS)

    def handle_startendtag(self, tag: str,
                           attrs: list[tuple[str, str | None]]) -> None:
        # Self-closing: checked, never pushed.
        self._open(tag, attrs, push=False)

    def handle_endtag(self, tag: str) -> None:
        local = _local(tag)
        if not self.stack or self.stack[-1] != local:
            self.add("F_MALFORMED",
                     "mismatched or stray end tag", f"element#{self.element_count}")
            return
        popped = self.stack.pop()
        if popped == "style":
            self._style_depth -= 1

    def handle_data(self, data: str) -> None:
        if self._style_depth and data.strip():
            _check_css_decls(data, self, self._loc())

    def finalize(self) -> None:
        if self.stack:
            self.add("F_MALFORMED", "unterminated elements at end of input",
                     f"element#{self.element_count}")


# ---------------------------------------------------------------------------
# SVG path: strict XML parse; namespace-local names defeat prefix tricks
# (s:script is judged as script).
# ---------------------------------------------------------------------------

def _svg_scan(root: ET.Element, sink: _FindingSink) -> None:
    # Stack entries: (element, depth, in_style).
    stack: list[tuple[ET.Element, int, bool]] = [(root, 1, False)]
    count = 0
    while stack:
        el, depth, in_style = stack.pop()
        count += 1
        if count > MAX_ELEMENTS:
            sink.add("F_OVERSIZED", "element count exceeds profile bound",
                     f"element#{count}")
            return
        if depth > MAX_NESTING:
            sink.add("F_OVERSIZED", "nesting depth exceeds profile bound",
                     f"element#{count}")
            return
        local = _local(el.tag)
        loc = f"element#{count}"
        if local not in SVG_ELEMENTS:
            sink.add("F_UNADMITTED_ELEMENT",
                     "element not admitted by the offline profile", loc)
        else:
            raw_attrs = [(k, v) for k, v in el.attrib.items()]
            _admitted_attrs_for(local, raw_attrs, sink, loc)
            if local == "style" and el.text and el.text.strip():
                _check_css_decls(el.text, sink, loc)
        child_in_style = in_style or local == "style"
        for child in reversed(list(el)):
            stack.append((child, depth + 1, child_in_style))


# ---------------------------------------------------------------------------
# Entry points.
# ---------------------------------------------------------------------------

def check_text(text: str, suffix: str) -> tuple[bool, list[dict]]:
    """Return (ok, findings) for decoded markup text.

    Shared final-policy validator: the sanitizer runs this on its serialized
    output before reporting success (D641-003).
    """
    sink = _FindingSink()

    is_svg = suffix.lower() == ".svg"

    # Unadmitted processing instructions are refused BEFORE parsers can
    # discard them (e.g. <?xml-stylesheet href="https://...">).
    if _check_processing_instructions(text, sink, is_svg):
        return False, sink.findings

    if ENTITY_RE.search(text) or DOCTYPE_INTERNAL_RE.search(text):
        sink.add("F_ENTITY_EXPANSION",
                 "entity declarations / internal DTD subset not allowed")
        return False, sink.findings

    if is_svg:
        if DOCTYPE_RE.search(text):
            sink.add("F_ENTITY_EXPANSION",
                     "DOCTYPE not allowed in untrusted SVG")
            return False, sink.findings
        try:
            root = ET.fromstring(text.encode("utf-8"))
        except ET.ParseError:
            # No exception excerpt: counts-only diagnostics (D641-005).
            sink.add("F_MALFORMED", "SVG is not well-formed XML")
            return False, sink.findings
        _svg_scan(root, sink)
    else:
        scan = _HtmlScan()
        try:
            scan.feed(text)
            scan.finalize()
        except _StopScan:
            pass
        except Exception:
            sink.add("F_MALFORMED", "failed to parse document")
            return False, sink.findings
        sink.findings.extend(scan.findings)

    # Deduplicate on (code, loc).
    seen: set[tuple[str, str]] = set()
    unique: list[dict] = []
    for f in sink.findings:
        key = (f["code"], f["loc"])
        if key not in seen:
            seen.add(key)
            unique.append(f)
    return (len(unique) == 0), unique


def check_file(path: Path) -> tuple[bool, list[dict]]:
    """Return (ok, findings) for a diagram output file."""
    # Byte budget enforced BEFORE reading/materializing (D641-004).
    try:
        size = os.stat(path).st_size
    except OSError:
        return False, [{"code": "F_MALFORMED",
                        "message": "unreadable input",
                        "loc": ""}]
    if size > MAX_BYTES:
        return False, [{"code": "F_OVERSIZED",
                        "message": "file exceeds byte budget",
                        "loc": ""}]
    try:
        raw = path.read_bytes()
    except OSError:
        return False, [{"code": "F_MALFORMED",
                        "message": "unreadable input",
                        "loc": ""}]
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        return False, [{"code": "F_MALFORMED",
                        "message": "input is not valid UTF-8",
                        "loc": ""}]
    return check_text(text, path.suffix)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("file", type=Path, help="diagram HTML/SVG file to check")
    parser.add_argument("--json", action="store_true",
                        help="emit findings as JSON")
    args = parser.parse_args()
    ok, findings = check_file(args.file)
    # No filename in output: paths are treated as potentially sensitive.
    if args.json:
        print(json.dumps({"ok": ok,
                          "finding_count": len(findings),
                          "findings": findings}, indent=2))
    else:
        if ok:
            print("OFFLINE-CLEAN")
        else:
            print("OFFLINE-REFUSED")
            for f in findings:
                loc = f" [{f['loc']}]" if f["loc"] else ""
                print(f"  [{f['code']}] {f['message']}{loc}")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
