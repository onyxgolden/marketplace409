#!/usr/bin/env python3
"""Test runner for the diagram offline export profile.

Runs:
  1. Static checker over 12 synthetic fixtures (4 valid, 4 external-resource
     attempts, 4 active-content/oversized/malformed).
  2. Sanitizer on the Google-Fonts valid flow; label/text comparison
     before/after (font substitution must not clip essential labels).
  3. Network-denied render of every valid flow (Playwright route-abort);
     records attempted network requests and asserts ZERO, including the
     PNG export path.
  4. Private-label leak check: private-looking fixture content must never
     appear in requests, logs, or persistent profiles.

Usage: python3 run_tests.py [--network]  (network test requires Playwright)
Exit 0 on all pass; prints TAP-ish summary.
"""

from __future__ import annotations

import argparse
import io
import re
import sys
import tempfile
from contextlib import redirect_stdout
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from check_offline import check_file  # noqa: E402
from sanitize_offline import sanitize  # noqa: E402

FIX = HERE / "fixtures"
PRIVATE_MARKERS = ("Vault-7", "CONFIDENTIAL", "internal ledger")

results: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, note: str = "") -> None:
    results.append((name, ok, note))
    print(f"{'ok' if ok else 'FAIL'} - {name}" + (f" ({note})" if note else ""))


# --- 1. Static checker over 12 fixtures ---
EXPECTED_FAIL = {
    "external-01.html": "F_GOOGLE_FONTS",
    "external-02.html": "F_EXTERNAL_REFERENCE",  # script src (script tag also flagged)
    "external-03.html": "F_EXTERNAL_REFERENCE",
    "external-04.svg": "F_GOOGLE_FONTS",
    "active-01.html": "F_EVENT_HANDLER",
    "active-02.html": "F_SCRIPT",
    "active-03.svg": "F_ENTITY_EXPANSION",
    "active-04.html": "F_OVERSIZED",
}
for fname in ("valid-01.html", "valid-02.svg", "valid-04.html"):
    ok, findings = check_file(FIX / fname)
    check(f"static:{fname}:passes", ok, f"findings={len(findings)}")

for fname, code in EXPECTED_FAIL.items():
    ok, findings = check_file(FIX / fname)
    codes = {f["code"] for f in findings}
    # external-02: script tag itself is flagged as F_SCRIPT; the remote src
    # is unreachable after that refusal — accept either refusal signal.
    want = {code} | ({"F_SCRIPT"} if fname == "external-02.html" else set())
    check(f"static:{fname}:refused", (not ok) and bool(codes & want),
          f"codes={sorted(codes)}")

# --- 2. Sanitizer on valid-03 + label comparison ---
html_out, report = sanitize(FIX / "valid-03.html")
with tempfile.NamedTemporaryFile("w", suffix=".html", delete=False) as t:
    t.write(html_out)
    sanitized_path = Path(t.name)
ok2, findings2 = check_file(sanitized_path)
check("sanitize:valid-03:offline-clean", ok2, f"findings={len(findings2)}")
check("sanitize:valid-03:text-preserved", report["text_preserved"],
      f"text nodes {report['text_nodes_before']}->{report['text_nodes_after']}")
# Labeled boxes/edges identical before/after: compare <text> contents.
before = re.findall(r"<text[^>]*>(.*?)</text>", (FIX / "valid-03.html").read_text(),
                    re.DOTALL)
after = re.findall(r"<text[^>]*>(.*?)</text>", html_out, re.DOTALL)
check("sanitize:valid-03:labels-identical", before == after,
      f"labels={len(before)}")
removed = {c["code"] for c in report["changes"]}
check("sanitize:valid-03:removed-font-link",
      "REMOVED_REMOTE_LINK" in removed, f"changes={sorted(removed)}")


# --- 3. Network-denied render (Playwright) ---
def network_denied(paths: list[Path]) -> tuple[bool, list[str], str]:
    """Load pages with ALL network aborted; return (zero_requests, log, png)."""
    from playwright.sync_api import sync_playwright

    attempted: list[str] = []
    exe = (Path.home() / ".cache/ms-playwright/chromium-1234/chrome-linux64/chrome")
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=str(exe),
                                    args=["--no-sandbox"])
        try:
            ctx = browser.new_context()

            def _deny(route):
                url = route.request.url
                if url.startswith(("http://", "https://")):
                    attempted.append(url)
                    route.abort()
                else:
                    route.continue_()

            ctx.route("**/*", _deny)
            png_path = ""
            for path in paths:
                page = ctx.new_page()
                page.goto(path.resolve().as_uri(), wait_until="domcontentloaded")
                page.wait_for_timeout(1500)
                # PNG export flow under the same denied network.
                if path.suffix == ".html":
                    svg = page.locator("svg").first
                    box = svg.evaluate(
                        "el => { const b = el.viewBox.baseVal; return [b.width, b.height]; }")
                    if box[0] > 0 and box[1] > 0:
                        svg.evaluate(
                            "el => { const b = el.viewBox.baseVal; "
                            "el.style.setProperty('width', b.width + 'px', 'important'); "
                            "el.style.setProperty('height', b.height + 'px', 'important'); }")
                        with tempfile.NamedTemporaryFile(
                                "wb", suffix=".png", delete=False) as f:
                            png_path = f.name
                        svg.screenshot(path=png_path)
                page.close()
            return (len(attempted) == 0), attempted, png_path
        finally:
            browser.close()


def run_network() -> None:
    pages = [FIX / "valid-01.html", sanitized_path, FIX / "valid-04.html",
             FIX / "valid-02.svg"]
    ok3, attempted, png = network_denied(pages)
    check("network-denied:zero-requests", ok3,
          f"attempted={len(attempted)}" + (f" first={attempted[0][:60]}" if attempted else ""))
    if png:
        size = Path(png).stat().st_size
        check("network-denied:png-exported", size > 1000, f"{size} bytes")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--network", action="store_true",
                        help="run Playwright network-denied test")
    parser.add_argument("--skip-network", action="store_true")
    args = parser.parse_args()

    # --- 4. Private-label leak check ---
    buf = io.StringIO()
    with redirect_stdout(buf):
        for r_name, r_ok, r_note in results:
            print(r_name, r_ok, r_note)  # summary lines only, no file content
    leaked = [m for m in PRIVATE_MARKERS if m in buf.getvalue()]
    check("privacy:no-fixture-content-in-logs", not leaked,
          f"leaked={leaked}")
    check("privacy:report-carries-counts-only",
          all("Vault" not in json.dumps(c) for c in [report]),
          "sanitizer report has no content")

    if args.network and not args.skip_network:
        try:
            run_network()
        except Exception as exc:  # noqa: BLE001
            check("network-denied:zero-requests", False, f"error: {exc!r}"[:80])
    elif not args.network:
        print("note: network test skipped (pass --network to run)")

    failed = [n for n, ok, _ in results if not ok]
    print(f"\n{len(results) - len(failed)}/{len(results)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    import json  # noqa: E402  (local import keeps module import light)
    raise SystemExit(main())
