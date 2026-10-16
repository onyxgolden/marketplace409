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

# CSS: url(...) / @import matchers run on CSS-UNESCAPED text, so escaped
# spellings like u\72l(...) are caught.
CSS_URL_RE = re.compile(r"url\(\s*([^)]*?)\s*\)", re.IGNORECASE)
CSS_IMPORT_RE = re.compile(
    r"@import\s+(?:url\(\s*([^)]*?)\s*\)|([\"'][^\"']*[\"']))",
    re.IGNORECASE,
)
CSS_DIM_RE = re.compile(
    r"(min-|max-)?\b(width|height)\s*:\s*([^;}{!]+)", re.IGNORECASE)
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

    Handles \\<1-6 hex digits>[whitespace] and \\<char>. This is what the
    browser interprets, so url()/@import detection must run on the
    unescaped form (u\\72l(...) === url(...)).
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


class _StopScan(Exception):
    """Internal: stop parsing early on structural excess (fail closed)."""


class _FindingSink:
    def __init__(self) -> None:
        self.findings: list[dict] = []

    def add(self, code: str, message: str, loc: str = "") -> None:
        self.findings.append({"code": code, "message": message, "loc": loc})


def _check_css_decls(css: str, sink: _FindingSink, loc: str) -> None:
    """Check unescaped CSS for remote/active constructs and dimensions."""
    text = _css_unescape(css)
    for m in CSS_IMPORT_RE.finditer(text):
        url = (m.group(1) or m.group(2) or "").strip().strip("'\"")
        for code in _url_codes(url):
            if code == "F_EXTERNAL_REFERENCE":
                code = "F_REMOTE_CSS"
            sink.add(code, "remote CSS import not allowed offline", loc)
    for m in CSS_URL_RE.finditer(text):
        url = m.group(1).strip().strip("'\"")
        for code in _url_codes(url):
            if code == "F_EXTERNAL_REFERENCE":
                code = "F_REMOTE_CSS"
            sink.add(code, "remote url() in CSS not allowed offline", loc)
    for m in CSS_DIM_RE.finditer(text):
        prefix, _name, value = m.group(1), m.group(2), m.group(3)
        if prefix:
            sink.add("F_UNSUPPORTED_SIZING",
                     "min-/max- sizing not supported by the offline profile",
                     loc)
            continue
        code = _check_dimension_value(value)
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

    if ENTITY_RE.search(text) or DOCTYPE_INTERNAL_RE.search(text):
        sink.add("F_ENTITY_EXPANSION",
                 "entity declarations / internal DTD subset not allowed")
        return False, sink.findings

    is_svg = suffix.lower() == ".svg"
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
