#!/usr/bin/env python3
"""Static offline-conformance checker for diagram output (HTML/SVG).

Narrow diagram-output conformance check for the FORGE offline export
profile. Verifies a generated diagram file makes ZERO network requests
and carries no active content, without executing it.

Usage:
    python3 check_offline.py <file> [--json]

Exit 0 when the file is offline-clean; exit 1 with findings otherwise.
Findings are dicts: {"code": ..., "message": ..., "detail": ...}.

This checker is deliberately narrow (not a general security scanner):
it enforces the offline profile contract only.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

# Offline profile bounds (imported SVG/XML is untrusted).
MAX_BYTES = 2_000_000        # 2 MB per file
MAX_ELEMENTS = 2_000         # element count cap
MAX_NESTING = 64             # element nesting depth cap
MAX_DIMENSION = 8_000        # viewBox/CSS pixel dimension cap

REFERENCE_ATTRS = {
    "src", "href", "xlink:href", "poster", "srcset", "action", "formaction",
}
CSS_URL_RE = re.compile(r"url\(\s*['\"]?([^)'\"]+?)['\"]?\s*\)", re.IGNORECASE)
CSS_IMPORT_RE = re.compile(
    r"@import\s+(?:url\(\s*['\"]?([^)'\"]+?)['\"]?\s*\)|['\"]([^'\"]+)['\"])",
    re.IGNORECASE,
)
FONTS_HOST_RE = re.compile(r"fonts\.googleapis\.com|fonts\.gstatic\.com", re.IGNORECASE)
ENTITY_RE = re.compile(r"<!ENTITY\b", re.IGNORECASE)
DOCTYPE_INTERNAL_RE = re.compile(r"<!DOCTYPE[^>\[]*\[", re.IGNORECASE | re.DOTALL)
EXECUTABLE_SCHEMES = ("javascript:", "vbscript:", "data:text/html")
VIEWBOX_RE = re.compile(r"viewBox\s*=\s*['\"]([^'\"]+)['\"]", re.IGNORECASE)
WH_RE = re.compile(r"\b(width|height)\s*=\s*['\"]?(\d+(?:\.\d+)?)", re.IGNORECASE)


def _is_remote(url: str) -> bool:
    u = url.strip().strip("'\"")
    if not u or u.startswith("#"):
        return False
    if u.lower().startswith("data:"):
        # Only embedded images are allowed; executable data URLs are
        # flagged separately as F_EXECUTABLE_URL.
        return not u.lower().startswith("data:image/")
    return True


def _is_executable(url: str) -> bool:
    u = url.strip().strip("'\"").lower()
    return u.startswith(EXECUTABLE_SCHEMES)


class _Scan(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.findings: list[dict] = []
        self.depth = 0
        self.max_depth = 0
        self.element_count = 0
        self.text_chunks: list[str] = []

    def _finding(self, code: str, message: str, detail: str = "") -> None:
        self.findings.append({"code": code, "message": message, "detail": detail})

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.element_count += 1
        self.depth += 1
        self.max_depth = max(self.max_depth, self.depth)
        low = tag.lower()
        if low == "script":
            self._finding("F_SCRIPT", "script element not allowed in offline output",
                           f"<{tag}>")
            return
        amap = {k.lower(): (v or "") for k, v in attrs}
        for k, v in amap.items():
            if k.startswith("on"):
                self._finding("F_EVENT_HANDLER",
                              "event-handler attribute not allowed", k)
            if k in REFERENCE_ATTRS and v:
                if _is_executable(v):
                    self._finding("F_EXECUTABLE_URL",
                                  "executable URL not allowed", f"{k}={v[:80]}")
                elif _is_remote(v):
                    if FONTS_HOST_RE.search(v):
                        self._finding("F_GOOGLE_FONTS",
                                      "Google Fonts reference not allowed offline",
                                      f"{k}={v[:80]}")
                    else:
                        self._finding("F_EXTERNAL_REFERENCE",
                                      "external reference not allowed offline",
                                      f"{k}={v[:80]}")
        style = amap.get("style", "")
        if style:
            self._check_css(style, "style attribute")

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.handle_starttag(tag, attrs)
        self.handle_endtag(tag)

    def handle_endtag(self, tag: str) -> None:
        self.depth = max(0, self.depth - 1)

    def handle_data(self, data: str) -> None:
        if data.strip():
            self.text_chunks.append(data.strip())
        self._check_css(data, "style block")

    def _check_css(self, css: str, where: str) -> None:
        for m in CSS_IMPORT_RE.finditer(css):
            url = m.group(1) or m.group(2) or ""
            if FONTS_HOST_RE.search(url):
                self._finding("F_GOOGLE_FONTS",
                              "Google Fonts @import not allowed offline",
                              f"{where}: {url[:80]}")
            elif _is_remote(url):
                self._finding("F_REMOTE_CSS",
                              "remote CSS import not allowed offline",
                              f"{where}: {url[:80]}")
        for m in CSS_URL_RE.finditer(css):
            url = m.group(1)
            if _is_executable(url):
                self._finding("F_EXECUTABLE_URL",
                              "executable URL in CSS not allowed",
                              f"{where}: {url[:80]}")
            elif _is_remote(url):
                if FONTS_HOST_RE.search(url):
                    self._finding("F_GOOGLE_FONTS",
                                  "Google Fonts url() not allowed offline",
                                  f"{where}: {url[:80]}")
                else:
                    self._finding("F_REMOTE_CSS",
                                  "remote url() in CSS not allowed offline",
                                  f"{where}: {url[:80]}")


def check_file(path: Path) -> tuple[bool, list[dict]]:
    """Return (ok, findings) for a diagram output file."""
    findings: list[dict] = []
    raw = path.read_bytes()

    if len(raw) > MAX_BYTES:
        findings.append({
            "code": "F_OVERSIZED",
            "message": f"file exceeds byte budget ({len(raw)} > {MAX_BYTES})",
            "detail": path.name,
        })
        return False, findings

    text = raw.decode("utf-8", errors="replace")

    if ENTITY_RE.search(text) or DOCTYPE_INTERNAL_RE.search(text):
        findings.append({
            "code": "F_ENTITY_EXPANSION",
            "message": "entity declarations / internal DTD subset not allowed",
            "detail": path.name,
        })
        return False, findings

    if path.suffix.lower() == ".svg":
        # Imported/standalone SVG is untrusted: strict XML parse.
        import xml.etree.ElementTree as ET

        class _NoDoctype(ET.XMLParser):
            pass

        try:
            ET.fromstring(raw, parser=ET.XMLParser())
        except ET.ParseError as exc:
            findings.append({
                "code": "F_MALFORMED",
                "message": "SVG is not well-formed XML",
                "detail": str(exc)[:120],
            })
            return False, findings

    scan = _Scan()
    try:
        scan.feed(text)
    except Exception as exc:  # HTMLParser is lenient; be defensive anyway
        findings.append({
            "code": "F_MALFORMED",
            "message": "failed to parse document",
            "detail": str(exc)[:120],
        })
        return False, findings

    findings.extend(scan.findings)

    if scan.element_count > MAX_ELEMENTS:
        findings.append({
            "code": "F_OVERSIZED",
            "message": f"element count {scan.element_count} exceeds {MAX_ELEMENTS}",
            "detail": path.name,
        })
    if scan.max_depth > MAX_NESTING:
        findings.append({
            "code": "F_OVERSIZED",
            "message": f"nesting depth {scan.max_depth} exceeds {MAX_NESTING}",
            "detail": path.name,
        })
    for m in VIEWBOX_RE.finditer(text):
        parts = m.group(1).split()
        if len(parts) == 4:
            try:
                w, h = float(parts[2]), float(parts[3])
            except ValueError:
                continue
            if w > MAX_DIMENSION or h > MAX_DIMENSION or w <= 0 or h <= 0:
                findings.append({
                    "code": "F_OVERSIZED",
                    "message": f"viewBox dimension out of bounds ({w}x{h})",
                    "detail": path.name,
                })
    for m in WH_RE.finditer(text):
        try:
            v = float(m.group(2))
        except ValueError:
            continue
        if v > MAX_DIMENSION:
            findings.append({
                "code": "F_OVERSIZED",
                "message": f"{m.group(1)}={v} exceeds {MAX_DIMENSION}",
                "detail": path.name,
            })

    # Deduplicate findings on (code, detail).
    seen: set[tuple[str, str]] = set()
    unique: list[dict] = []
    for f in findings:
        key = (f["code"], f["detail"])
        if key not in seen:
            seen.add(key)
            unique.append(f)
    return (len(unique) == 0), unique


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("file", type=Path, help="diagram HTML/SVG file to check")
    parser.add_argument("--json", action="store_true",
                        help="emit findings as JSON")
    args = parser.parse_args()
    ok, findings = check_file(args.file)
    if args.json:
        print(json.dumps({"file": str(args.file), "ok": ok,
                          "findings": findings}, indent=2))
    else:
        if ok:
            print(f"OFFLINE-CLEAN: {args.file}")
        else:
            print(f"OFFLINE-REFUSED: {args.file}")
            for f in findings:
                print(f"  [{f['code']}] {f['message']} ({f['detail']})")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
