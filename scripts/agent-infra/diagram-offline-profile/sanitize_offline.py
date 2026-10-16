#!/usr/bin/env python3
"""Convert a diagram HTML/SVG file to the FORGE offline export profile.

Removes every network-dependent construct so the result renders with
local/system assets only. Operates under the SAME closed policy as
check_offline.py: only admitted elements/attributes are emitted, output is
escaped on serialization, and the final serialized output is validated by
the shared checker before success is reported.

Contract:
- sanitize() returns (ok, html, report). Report carries counts and fixed
  reason codes only -- never file content, URLs, or filenames.
- ok=True only if the serialized output passes check_offline.check_text
  AND rendered text is preserved (labels intact) or the input had no text.
- The CLI writes the destination atomically on success only; a failed
  conversion never replaces an existing valid destination.

Usage:
    python3 sanitize_offline.py <src> <dst> [--json]
"""

from __future__ import annotations

import argparse
import html as html_module
import json
import os
import sys
import tempfile
from html.parser import HTMLParser
from pathlib import Path

from check_offline import (
    ADMITTED_ATTRS,
    ELEMENT_ATTRS,
    HTML_ELEMENTS,
    MAX_BYTES,
    MAX_ELEMENTS,
    MAX_NESTING,
    SVG_ELEMENTS,
    URL_ATTRS,
    VOID_ELEMENTS,
    _check_css_decls,
    _check_processing_instructions,
    _css_strip_comments_safe,
    _FindingSink,
    _is_xmlns_decl,
    _local,
    _url_codes,
    check_text,
    DOCTYPE_INTERNAL_RE,
    DOCTYPE_RE,
    ENTITY_RE,
)

import io
import xml.etree.ElementTree as ET


class _TextExtract(HTMLParser):
    """Independent rendered-text extractor (skips style/script subtrees)."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.texts: list[str] = []
        self._skip = 0

    def handle_starttag(self, tag, attrs) -> None:
        if _local(tag) in ("style", "script"):
            self._skip += 1

    def handle_endtag(self, tag) -> None:
        if _local(tag) in ("style", "script") and self._skip:
            self._skip -= 1

    def handle_data(self, data) -> None:
        if not self._skip and data.strip():
            self.texts.append(data.strip())


def _extract_text_html(text: str) -> list[str]:
    ex = _TextExtract()
    ex.feed(text)
    return ex.texts


def _extract_text_svg(text: str) -> list[str]:
    try:
        root = ET.fromstring(text.encode("utf-8"))
    except ET.ParseError:
        return []
    out: list[str] = []
    stack = [root]
    while stack:
        el = stack.pop()
        if _local(el.tag) == "style":
            continue
        if el.text and el.text.strip():
            out.append(el.text.strip())
        for child in reversed(list(el)):
            stack.append(child)
        if el.tail and el.tail.strip():
            out.append(el.tail.strip())
    return out


class _Sanitizer(HTMLParser):
    """HTML sanitizer emitting only policy-admitted, escaped markup."""

    def __init__(self, sink: _FindingSink) -> None:
        # convert_charrefs=True decodes entities in text AND attributes, so
        # serialization re-escapes the browser-interpreted values (D641-002).
        super().__init__(convert_charrefs=True)
        self.sink = sink
        self.out: list[str] = []
        self.change_counts: dict[str, int] = {}
        self.elements_before = 0
        self.elements_after = 0
        self._drop_depth = 0  # inside a dropped (unadmitted) subtree
        self._refuse = False

    def _changed(self, code: str) -> None:
        self.change_counts[code] = self.change_counts.get(code, 0) + 1

    def handle_decl(self, decl: str) -> None:
        if self._drop_depth:
            return
        if decl.lower().startswith("doctype html"):
            self.out.append("<!DOCTYPE html>")
        # Other declarations (e.g. XML prologs in .svg handled separately)
        # are dropped silently: they carry no diagram content.

    def handle_comment(self, data: str) -> None:
        # Comments are inert; drop them (never carry content forward).
        pass

    def _emit_attrs(self, element: str,
                    attrs: list[tuple[str, str | None]]) -> str:
        parts: list[str] = []
        allowed = ELEMENT_ATTRS.get(element, ADMITTED_ATTRS)
        for raw_k, v in attrs:
            if _is_xmlns_decl(raw_k):
                parts.append(f' {raw_k}="{html_module.escape(v or "", quote=True)}"')
                continue
            k = _local(raw_k)
            if k not in allowed:
                self._changed("REMOVED_UNADMITTED_ATTR")
                continue
            val = v or ""
            if k in URL_ATTRS and _url_codes(val):
                # Remote URL on an admitted attribute: drop the attribute.
                self._changed("REMOVED_REMOTE_ATTR")
                continue
            if k == "style":
                # Any remote url()/import in a style attribute -> drop it.
                # Other violations (unsupported sizing, ...) -> refuse.
                probe = _FindingSink()
                _check_css_decls(val, probe, "")
                if any(c in ("F_REMOTE_CSS", "F_GOOGLE_FONTS", "F_EXECUTABLE_URL")
                       for c in {f["code"] for f in probe.findings}):
                    self._changed("REMOVED_REMOTE_CSS")
                    continue
                if probe.findings:
                    # Unsupported sizing etc.: refuse rather than mangle.
                    self._refuse = True
                    self.sink.add("F_INVALID_DIMENSION",
                                  "style attribute outside profile bounds")
                    return ""
            # Escaped serialization: decoded values can never break out of
            # the attribute (D641-002).
            parts.append(f' {k}="{html_module.escape(val, quote=True)}"')
        return "".join(parts)

    def handle_starttag(self, tag, attrs) -> None:
        if self._drop_depth:
            self._drop_depth += 1
            return
        local = _local(tag)
        self.elements_before += 1
        if local not in HTML_ELEMENTS:
            # Unadmitted element (object/iframe/script/...): drop subtree.
            self._changed("REMOVED_UNADMITTED_ELEMENT")
            self._drop_depth += 1
            return
        if local == "link":
            amap = {_local(k): (v or "") for k, v in attrs
                    if not _is_xmlns_decl(k)}
            href = amap.get("href", "")
            if _url_codes(href):
                self._changed("REMOVED_REMOTE_LINK")
                return
        if local == "image":
            amap = {_local(k): (v or "") for k, v in attrs
                    if not _is_xmlns_decl(k)}
            if _url_codes(amap.get("href", "")):
                self._changed("REMOVED_REMOTE_IMAGE")
                return
        if local == "meta":
            # Only charset survives the policy; enforced via allowlist.
            pass
        attr_s = self._emit_attrs(local, attrs)
        if self._refuse:
            return
        self.elements_after += 1
        self.out.append(f"<{local}{attr_s}>")

    def handle_startendtag(self, tag, attrs) -> None:
        drop_before = self._drop_depth
        self.handle_starttag(tag, attrs)
        if self._drop_depth > drop_before:
            # Self-closing unadmitted element: the drop opens and closes here.
            self._drop_depth = drop_before
            return
        if not self._drop_depth and not self._refuse:
            local = _local(tag)
            # Self-closing: emit the matching end tag for non-void elements
            # so output stays well-formed and idempotent.
            if local not in VOID_ELEMENTS:
                self.out.append(f"</{local}>")

    def handle_endtag(self, tag) -> None:
        if self._drop_depth:
            self._drop_depth -= 1
            return
        local = _local(tag)
        if local in HTML_ELEMENTS and local not in VOID_ELEMENTS:
            self.out.append(f"</{local}>")

    def handle_data(self, data: str) -> None:
        if self._drop_depth:
            return
        # Style blocks: strip remote @imports (safe: rule-level removal),
        # refuse on remote url() inside declarations.
        # NOTE: _Sanitizer tracks style via a simple flag set in start/end.
        self.out.append(html_module.escape(data))

    def handle_entityref(self, name: str) -> None:
        # With convert_charrefs=True these are not called; defined for
        # explicitness per the review (D641-002).
        self.handle_data(f"&{name};")

    def handle_charref(self, name: str) -> None:
        self.handle_data(f"&#{name};")


class _StyleAwareSanitizer(_Sanitizer):
    """Sanitizer with style-block CSS processing."""

    def __init__(self, sink: _FindingSink) -> None:
        super().__init__(sink)
        self._in_style = False
        self._style_buf: list[str] = []

    def handle_starttag(self, tag, attrs) -> None:
        if _local(tag) == "style" and not self._drop_depth:
            # Emit the open tag now; CSS text is buffered and processed in
            # handle_endtag.
            _Sanitizer.handle_starttag(self, tag, attrs)
            if not self._refuse:
                self._in_style = True
            return
        super().handle_starttag(tag, attrs)

    def handle_startendtag(self, tag, attrs) -> None:
        # A self-closed <style/> has no body: do not arm the CSS buffer.
        if _local(tag) == "style":
            _Sanitizer.handle_startendtag(self, tag, attrs)
            self._in_style = False
            self._style_buf = []
            return
        super().handle_startendtag(tag, attrs)

    def handle_endtag(self, tag) -> None:
        if _local(tag) == "style" and self._in_style:
            css = "".join(self._style_buf)
            self._style_buf = []
            self._in_style = False
            cleaned, ok = _clean_style_block(css, self)
            if not ok:
                self._refuse = True
                return
            # <style> is a raw-text element: the browser does not
            # entity-decode its content, so emit the CSS unescaped
            # (escaping here would double-encode on every pass and
            # break idempotence).
            if "</style" in cleaned.lower():
                self._refuse = True
                self.sink.add("F_MALFORMED",
                              "style block contains closing tag")
                return
            self.out.append(cleaned)
            self.out.append("</style>")
            return
        super().handle_endtag(tag)

    def handle_data(self, data: str) -> None:
        if self._in_style:
            self._style_buf.append(data)
            return
        super().handle_data(data)


def _clean_style_block(css: str, s: _Sanitizer) -> tuple[str, bool]:
    """Remove remote @imports; refuse on remote url() or other violations."""
    from check_offline import _css_strip_comments_safe
    # Comment-strip on RAW css (D641-001 round 5): escapes are decoded per
    # token during classification, never before lexing, so \2f\2a cannot
    # become a fake comment that hides a fetch-bearing reference.
    stripped, ok = _css_strip_comments_safe(css)
    if not ok:
        s.sink.add("F_MALFORMED_CSS",
                   "style block has unterminated comment or string")
        return "", False
    unescaped = stripped
    # The @import strip below runs on the comment-stripped raw text; the
    # remote probe above and the re-probe below both classify per-token
    # decoded URLs, so any import the regex misses still refuses.
    probe = _FindingSink()
    _check_css_decls(css, probe, "")
    codes = {f["code"] for f in probe.findings}
    if codes & {"F_REMOTE_CSS", "F_GOOGLE_FONTS", "F_EXECUTABLE_URL"}:
        # Distinguish: remote @import rules can be dropped safely;
        # remote url() inside declarations cannot -> refuse.
        import re as _re
        stripped = _re.sub(
            r"@import\s*(?:url\(\s*[^)]*?\)|[\"'][^\"']*[\"'])\s*;",
            "", unescaped, flags=_re.IGNORECASE)
        reprobe = _FindingSink()
        _check_css_decls(stripped, reprobe, "")
        recodes = {f["code"] for f in reprobe.findings}
        if recodes & {"F_REMOTE_CSS", "F_GOOGLE_FONTS", "F_EXECUTABLE_URL"}:
            s.sink.add("F_REMOTE_CSS",
                       "style block requires network resources")
            return "", False
        s._changed("REMOVED_REMOTE_CSS_IMPORT")
        return stripped, True
    if codes:
        s.sink.add("F_INVALID_DIMENSION",
                   "style block outside profile bounds")
        return "", False
    return css, True


def _sanitize_svg(text: str, sink: _FindingSink
                  ) -> tuple[bool, str, dict[str, int]]:
    """SVG sanitizer: rebuild from the admitted subset via ElementTree.

    Uses an EXPLICIT stack (iterative) -- never recursion -- so deeply
    nested input cannot raise RecursionError; the shared policy still
    refuses input beyond the depth bound.
    """
    try:
        root = ET.fromstring(text.encode("utf-8"))
    except ET.ParseError:
        sink.add("F_MALFORMED", "SVG is not well-formed XML")
        return False, "", {}
    changes: dict[str, int] = {}

    # Sentinel: clean_element returns _REFUSE (not None) when the element
    # forces whole-document refusal. None means "drop this element and
    # continue" (salvage); _REFUSE aborts the sanitize as failed.
    _REFUSE = object()

    def bump(code: str) -> None:
        changes[code] = changes.get(code, 0) + 1

    def clean_element(el: ET.Element):
        local = _local(el.tag)
        if local not in SVG_ELEMENTS:
            bump("REMOVED_UNADMITTED_ELEMENT")
            return None
        allowed = ELEMENT_ATTRS.get(local, ADMITTED_ATTRS)
        new = ET.Element(local)
        for qname, val in el.attrib.items():
            if _is_xmlns_decl(qname):
                continue
            k = _local(qname)
            if k not in allowed:
                bump("REMOVED_UNADMITTED_ATTR")
                continue
            if k in URL_ATTRS and _url_codes(val):
                bump("REMOVED_REMOTE_ATTR")
                return None  # drop elements whose URL is remote
            if k == "style":
                probe = _FindingSink()
                _check_css_decls(val, probe, "")
                codes = {f["code"] for f in probe.findings}
                if codes and not codes <= {"F_REMOTE_CSS", "F_GOOGLE_FONTS",
                                           "F_EXECUTABLE_URL"}:
                    # Unsupported/unadmitted CSS: refuse rather than mangle.
                    sink.findings.extend(probe.findings)
                    return None
                if codes:
                    bump("REMOVED_REMOTE_CSS")
                    continue
            new.set(k, val)
        if local == "style":
            cleaned, ok = _clean_style_block(el.text or "", _style_ctx(sink, changes))
            if not ok:
                # A style block with a non-import remote resource (or other
                # violation) refuses the whole document -- same as the HTML
                # path -- instead of silently dropping the block. The sink
                # already carries the F_REMOTE_CSS / F_MALFORMED_CSS finding.
                return _REFUSE
            new.text = cleaned
        else:
            new.text = el.text
        return new

    cleaned_root = clean_element(root)
    if cleaned_root is None or cleaned_root is _REFUSE:
        return False, "", changes
    # Iterative rebuild: (old, new) pairs on an explicit stack.
    stack: list[tuple[ET.Element, ET.Element]] = [(root, cleaned_root)]
    while stack:
        old, new = stack.pop()
        for child in list(old):
            c = clean_element(child)
            if c is _REFUSE:
                return False, "", changes
            if c is not None:
                new.append(c)
                c.tail = child.tail
                stack.append((child, c))
    # Preserve the SVG namespace declaration for well-formedness.
    cleaned_root.set("xmlns", "http://www.w3.org/2000/svg")
    out = ET.tostring(cleaned_root, encoding="unicode")
    return True, out, changes


class _style_ctx:
    """Minimal adapter so _clean_style_block can record changes."""

    def __init__(self, sink: _FindingSink, changes: dict[str, int]) -> None:
        self.sink = sink
        self._changes = changes

    def _changed(self, code: str) -> None:
        self._changes[code] = self._changes.get(code, 0) + 1


def _preflight(text: str, is_svg: bool, sink: _FindingSink) -> bool:
    """Reject dangerous pre-parse constructs and enforce structural bounds.

    Runs BEFORE any sanitization traversal: entity declarations/internal
    DTD subsets and unadmitted processing instructions are refused before a
    parser can expand or discard them, and element count/depth are bounded
    with non-recursive measurement so unbounded input cannot crash the
    rebuild (D641-004).

    Returns True when the input may proceed; False with findings in sink
    when it must be refused.
    """
    if ENTITY_RE.search(text) or DOCTYPE_INTERNAL_RE.search(text):
        sink.add("F_ENTITY_EXPANSION",
                 "entity declarations / internal DTD subset not allowed")
        return False
    if is_svg:
        if DOCTYPE_RE.search(text):
            sink.add("F_ENTITY_EXPANSION",
                     "DOCTYPE not allowed in untrusted SVG")
            return False
        if _check_processing_instructions(text, sink, True):
            return False
        # Iterative depth/count measurement (no recursion, no tree build).
        try:
            depth = 0
            count = 0
            for event, el in ET.iterparse(io.BytesIO(text.encode("utf-8")),
                                         events=("start", "end")):
                if event == "start":
                    depth += 1
                    count += 1
                    if count > MAX_ELEMENTS or depth > MAX_NESTING:
                        sink.add("F_OVERSIZED",
                                 "element count or depth exceeds profile bound")
                        return False
                    el.clear()
                else:
                    depth -= 1
        except ET.ParseError:
            sink.add("F_MALFORMED", "SVG is not well-formed XML")
            return False
    else:
        if _check_processing_instructions(text, sink, False):
            return False
    return True


def sanitize(path: Path) -> tuple[bool, str, dict]:
    """Return (ok, sanitized_text, report). Report carries counts only."""
    report: dict = {"ok": False}
    try:
        size = os.stat(path).st_size
    except OSError:
        report["finding_codes"] = ["F_MALFORMED"]
        return False, "", report
    if size > MAX_BYTES:
        report["finding_codes"] = ["F_OVERSIZED"]
        return False, "", report
    try:
        raw = path.read_bytes()
    except OSError:
        report["finding_codes"] = ["F_MALFORMED"]
        return False, "", report
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        report["finding_codes"] = ["F_MALFORMED"]
        return False, "", report

    report["bytes_in"] = len(raw)
    sink: _FindingSink = _FindingSink()
    is_svg = path.suffix.lower() == ".svg"

    # Pre-flight: refuse entities/PIs and bound structure BEFORE any
    # traversal or recursive parsing (D641-004). The shared policy gate
    # cannot run first here -- the sanitizer intentionally salvages
    # policy-violating-but-safe content (e.g. remote font links are
    # removed, not fatal) -- so only the structural bounds are pre-gated.
    if not _preflight(text, is_svg, sink):
        report["finding_codes"] = sorted({f["code"] for f in sink.findings}
                                         or {"F_MALFORMED"})
        return False, "", report

    if is_svg:
        pre_ok, out, changes = _sanitize_svg(text, sink)
        elements_before = text.count("<")
        if not pre_ok:
            report["finding_codes"] = sorted({f["code"] for f in sink.findings}
                                             or {"F_MALFORMED"})
            return False, "", report
    else:
        s = _StyleAwareSanitizer(sink)
        try:
            s.feed(text)
        except Exception:
            report["finding_codes"] = ["F_MALFORMED"]
            return False, "", report
        if s._refuse or s._drop_depth:
            report["finding_codes"] = sorted({f["code"] for f in sink.findings}
                                             or {"F_MALFORMED"})
            return False, "", report
        # Unterminated input: refuse rather than emit a repaired document.
        out = "".join(s.out)
        elements_before = s.elements_before
        changes = s.change_counts
        report["elements_before"] = s.elements_before
        report["elements_after"] = s.elements_after
        # Malformed nesting in the output is caught by the final check_text
        # validation below; no separate stack check is needed here.

    # Independent rendered-text comparison (D641-002): text extracted from
    # the input and from the output by SEPARATE parses must agree.
    extract = _extract_text_svg if is_svg else _extract_text_html
    before = extract(text)
    after = extract(out)
    text_preserved = before == after
    if not text_preserved:
        report["finding_codes"] = ["TEXT_NOT_PRESERVED"]
        report["text_nodes_before"] = len(before)
        report["text_nodes_after"] = len(after)
        return False, "", report

    # Final-policy validation on the exact serialized output (D641-003).
    ok, findings = check_text(out, path.suffix)
    if not ok:
        report["finding_codes"] = sorted({f["code"] for f in findings})
        return False, "", report

    # Byte bound applies to the exact serialized output too (D641-004).
    if len(out.encode("utf-8")) > MAX_BYTES:
        report["finding_codes"] = ["F_OVERSIZED"]
        return False, "", report

    report.update({
        "ok": True,
        "bytes_out": len(out.encode("utf-8")),
        "text_nodes_before": len(before),
        "text_nodes_after": len(after),
        "text_preserved": True,
        "changes": [{"code": c, "count": n}
                    for c, n in sorted(changes.items())],
    })
    if not is_svg:
        pass  # element counts already recorded above
    else:
        report["elements_before"] = elements_before
        report["elements_after"] = out.count("<")
    return True, out, report


def _write_destination(dst: Path, out: str) -> str | None:
    """Atomically replace dst with out. Returns None on success, else a
    fixed reason code. Never raises, never echoes paths (D641-005)."""
    tmp = ""
    try:
        fd, tmp = tempfile.mkstemp(dir=str(dst.parent), prefix=".sanitize-")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                f.write(out)
            os.replace(tmp, dst)
            tmp = ""  # replaced: nothing to clean up
            return None
        except OSError:
            return "F_DESTINATION_WRITE_FAILED"
    except OSError:
        return "F_DESTINATION_WRITE_FAILED"
    finally:
        if tmp:
            try:
                os.unlink(tmp)
            except OSError:
                pass


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("src", type=Path, help="input diagram file")
    parser.add_argument("dst", type=Path, help="offline output path")
    parser.add_argument("--json", action="store_true",
                        help="print report as JSON")
    args = parser.parse_args()
    ok, out, report = sanitize(args.src)
    # No source/destination paths in output: treated as potentially sensitive.
    if not ok:
        # Failed conversion never replaces an existing valid destination.
        if args.json:
            print(json.dumps(report, indent=2))
        else:
            print(f"REFUSED: {','.join(report.get('finding_codes', []))}")
        return 1
    # Destination write is part of the operation: temp creation, write and
    # replacement are all wrapped, and success is printed only AFTER the
    # requested write completes (D641-005).
    err = _write_destination(args.dst, out)
    if err is not None:
        report = {"ok": False, "finding_codes": [err]}
        if args.json:
            print(json.dumps(report, indent=2))
        else:
            print(f"REFUSED: {err}")
        return 1
    report["ok"] = True
    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print(f"sanitized: changes={sum(c['count'] for c in report['changes'])}, "
              f"text_preserved={report['text_preserved']}, "
              f"bytes={report['bytes_in']}->{report['bytes_out']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
