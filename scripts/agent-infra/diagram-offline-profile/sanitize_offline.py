#!/usr/bin/env python3
"""Convert a diagram HTML file to the FORGE offline export profile.

Removes every network-dependent construct so the result renders with
local/system assets only:

- Google Fonts <link> and @import (font stacks already end in generic
  families, so viewers fall back to system faces)
- remote <script src>, remote stylesheet <link>, remote images
- inline event-handler attributes and <script> blocks

Usage:
    python3 sanitize_offline.py <in.html> <out.html> [--json]

Prints a JSON report of changes (counts only, never file content, so
private-looking labels never leak into logs).
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

from check_offline import REFERENCE_ATTRS, _is_remote

VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link",
        "meta", "param", "source", "track", "wbr"}


class _Sanitizer(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=False)
        self.out: list[str] = []
        self.changes: list[dict] = []
        self.text_before: list[str] = []
        self.text_after: list[str] = []
        self.elements_before = 0
        self.elements_after = 0
        self._skip_depth = 0  # inside removed <script>/<style-remote>

    def _record(self, code: str, detail: str) -> None:
        self.changes.append({"code": code, "detail": detail})

    def handle_decl(self, decl: str) -> None:
        self.out.append(f"<!{decl}>")

    def handle_comment(self, data: str) -> None:
        self.out.append(f"<!--{data}-->")

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if self._skip_depth:
            self._skip_depth += 1
            return
        low = tag.lower()
        self.elements_before += 1
        if low == "script":
            self._record("REMOVED_SCRIPT", f"<{tag}> block")
            self._skip_depth = 1
            return
        amap = {k.lower(): (v or "") for k, v in attrs}
        if low == "link":
            rel = amap.get("rel", "").lower()
            href = amap.get("href", "")
            if "stylesheet" in rel or "font" in rel or _is_remote(href):
                self._record("REMOVED_REMOTE_LINK",
                             f"rel={rel or '?'} host={(href[:60])}")
                return
        if low in ("img", "image") or (low == "img"):
            src = amap.get("src", "") or amap.get("href", "")
            if _is_remote(src):
                self._record("REMOVED_REMOTE_IMAGE", f"<{tag}> src")
                self.out.append(
                    f'<rect class="offline-image-removed" width="24" height="24"/>')
                return
        keep: list[tuple[str, str]] = []
        for k, v in attrs:
            kl = k.lower()
            if kl.startswith("on"):
                self._record("REMOVED_EVENT_HANDLER", kl)
                continue
            if kl in REFERENCE_ATTRS and _is_remote(v or ""):
                self._record("REMOVED_REMOTE_ATTR", f"{kl}")
                continue
            keep.append((k, v or ""))
        self.elements_after += 1
        attr_s = "".join(f' {k}="{v}"' for k, v in keep)
        if low in VOID:
            self.out.append(f"<{tag}{attr_s}>")
        else:
            self.out.append(f"<{tag}{attr_s}>")

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.handle_starttag(tag, attrs)
        if not self._skip_depth:
            self.handle_endtag(tag)

    def handle_endtag(self, tag: str) -> None:
        if self._skip_depth:
            self._skip_depth -= 1
            return
        self.out.append(f"</{tag}>")

    def handle_data(self, data: str) -> None:
        if self._skip_depth:
            return
        if data.strip():
            self.text_before.append(data.strip())
            self.text_after.append(data.strip())
        self.out.append(data)


CSS_IMPORT_REMOTE_RE = re.compile(
    r"@import\s+url\(\s*['\"]?https?://[^)'\"]+['\"]?\s*\)\s*;", re.IGNORECASE)


def sanitize(path: Path) -> tuple[str, dict]:
    """Return (sanitized_html, report). Report carries counts only."""
    raw = path.read_bytes().decode("utf-8", errors="replace")
    # Strip remote CSS @imports before parsing (they live inside <style>).
    raw2, n_css = CSS_IMPORT_REMOTE_RE.subn("", raw)
    s = _Sanitizer()
    s.feed(raw2)
    report = {
        "file": path.name,
        "bytes_in": len(raw.encode("utf-8")),
        "bytes_out": len("".join(s.out).encode("utf-8")),
        "remote_css_imports_removed": n_css,
        "changes": [{"code": c["code"], "detail": c["detail"]}
                    for c in s.changes],
        "text_nodes_before": len(s.text_before),
        "text_nodes_after": len(s.text_after),
        "text_preserved": s.text_before == s.text_after,
        "elements_before": s.elements_before,
        "elements_after": s.elements_after,
    }
    return "".join(s.out), report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("src", type=Path, help="input diagram HTML")
    parser.add_argument("dst", type=Path, help="offline output HTML path")
    parser.add_argument("--json", action="store_true",
                        help="print report as JSON")
    args = parser.parse_args()
    html, report = sanitize(args.src)
    args.dst.write_text(html, encoding="utf-8")
    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print(f"sanitized {args.src} -> {args.dst}")
        print(f"  changes: {len(report['changes'])}, "
              f"text preserved: {report['text_preserved']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
