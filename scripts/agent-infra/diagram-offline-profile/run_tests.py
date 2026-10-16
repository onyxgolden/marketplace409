#!/usr/bin/env python3
"""Test runner for the diagram offline export profile.

Runs:
  1. Static checker over valid fixtures (must pass).
  2. Static checker over adversarial fixtures (must refuse with expected
     codes) -- includes the D641-001 bypass regressions.
  3. Synthetic dimension/structural bound tests (D641-004).
  4. Sanitizer conversion tests (D641-002): idempotence, entity/text
     preservation, adversarial attribute handling, never-adds-unadmitted.
  5. Sanitizer refusal tests (D641-003): quoted/protocol-relative imports,
     escaped CSS, rejected source, destination preservation on failure.
  6. Privacy tests (D641-005): private markers in URLs, CSS, attributes,
     and filenames must never appear in checker/sanitizer CLI output
     (JSON and human-readable, stdout and stderr).
  7. Network-denied render (Playwright, --network): ONLY files that pass
     the static gate are rendered; refused files are never rendered.
     Records attempted network requests (must be ZERO), checks essential
     labels/boxes for clipping after system-font substitution, and records
     the pinned browser identity. NOTE: this exercises Playwright SVG
     element rasterization, not the installed skill's export_png.py.

Usage: python3 run_tests.py [--network]  (network test requires Playwright)
Exit 0 on all pass; prints TAP-ish summary.
"""

from __future__ import annotations

import argparse
import io
import json
import re
import subprocess
import sys
import tempfile
from contextlib import redirect_stdout
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from check_offline import check_file, check_text  # noqa: E402
from sanitize_offline import sanitize  # noqa: E402

FIX = HERE / "fixtures"
PRIVATE_MARKERS = ("Vault-7", "CONFIDENTIAL", "s3cr3t-t0ken")

results: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, note: str = "") -> None:
    results.append((name, ok, note))
    print(f"{'ok' if ok else 'FAIL'} - {name}" + (f" ({note})" if note else ""))


def _tmp(content: str, suffix: str) -> Path:
    t = tempfile.NamedTemporaryFile("w", suffix=suffix, delete=False,
                                    encoding="utf-8")
    t.write(content)
    t.close()
    return Path(t.name)


class _SvgTextExtract(__import__("html.parser", fromlist=["HTMLParser"]).HTMLParser):
    """Extract text nodes inside <svg> only (labels/boxes under test)."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.texts: list[str] = []
        self._svg_depth = 0
        self._skip = 0

    def handle_starttag(self, tag, attrs) -> None:
        low = tag.lower()
        if low == "svg":
            self._svg_depth += 1
        if low in ("style", "script"):
            self._skip += 1

    def handle_endtag(self, tag) -> None:
        low = tag.lower()
        if low == "svg" and self._svg_depth:
            self._svg_depth -= 1
        if low in ("style", "script") and self._skip:
            self._skip -= 1

    def handle_data(self, data) -> None:
        if self._svg_depth and not self._skip and data.strip():
            self.texts.append(data.strip())


def _svg_labels(path: Path) -> list[str]:
    ex = _SvgTextExtract()
    ex.feed(path.read_text(encoding="utf-8"))
    return ex.texts


def _svg_doc(inner: str, **attrs: str) -> str:
    a = " ".join(f'{k}="{v}"' for k, v in attrs.items())
    return (f'<?xml version="1.0" encoding="utf-8"?>\n'
            f'<svg xmlns="http://www.w3.org/2000/svg" {a}>{inner}</svg>')


# --- 1. Static checker: valid fixtures pass ---
for fname in ("valid-01.html", "valid-02.svg", "valid-04.html"):
    ok, findings = check_file(FIX / fname)
    check(f"static:{fname}:passes", ok, f"findings={len(findings)}")

# --- 2. Static checker: known-bad fixtures refused ---
EXPECTED_FAIL = {
    "external-01.html": "F_GOOGLE_FONTS",
    "external-02.html": "F_UNADMITTED_ELEMENT",   # <script> not admitted
    "external-03.html": "F_EXTERNAL_REFERENCE",   # remote <image href>
    "external-04.svg": "F_GOOGLE_FONTS",           # remote @import in SVG CSS
    "active-01.html": "F_UNADMITTED_ATTR",         # onclick
    "active-02.html": "F_UNADMITTED_ELEMENT",      # <script>
    "active-03.svg": "F_ENTITY_EXPANSION",
    "active-04.html": "F_OVERSIZED",
    # D641-001 bypass regressions:
    "bypass-01.html": "F_UNADMITTED_ELEMENT",      # <object data>
    "bypass-02.html": "F_UNADMITTED_ELEMENT",      # <iframe srcdoc>
    "bypass-03.html": "F_UNADMITTED_ATTR",         # meta http-equiv=refresh
    "bypass-04.html": "F_REMOTE_CSS",              # escaped u\72l() url
    "bypass-05.svg": "F_UNADMITTED_ELEMENT",       # <s:script> (ns prefix)
}
for fname, code in EXPECTED_FAIL.items():
    ok, findings = check_file(FIX / fname)
    codes = {f["code"] for f in findings}
    check(f"static:{fname}:refused", (not ok) and code in codes,
          f"codes={sorted(codes)}")

# --- 2b. D641-001 residuals: closed CSS/resource surface ---
# image-set() function refused (closed function set).
ok, findings = check_text(
    '<style>div{background-image:image-set("https://example.invalid/x.png" 1x)}'
    "</style><div>test</div>", ".html")
check("css:imageset:refused",
      (not ok) and "F_UNADMITTED_CSS" in {f["code"] for f in findings})
# CSS comment splice must not hide @import from the checker.
ok, findings = check_text(
    '<style>@import/**/"https://example.invalid/x.css";</style><div>test</div>',
    ".html")
check("css:comment-spliced-import:refused",
      (not ok) and "F_REMOTE_CSS" in {f["code"] for f in findings})
# Resource-bearing presentation attribute with remote url().
ok, findings = check_text(
    '<svg xmlns="http://www.w3.org/2000/svg">'
    '<rect x="1" y="1" width="10" height="10" '
    'fill="url(https://example.invalid/paint.svg#x)"/></svg>', ".svg")
check("css:remote-fill-url:refused",
      (not ok) and "F_REMOTE_CSS" in {f["code"] for f in findings})
# Local #fragment paint is still admitted.
ok, _ = check_text(
    '<svg xmlns="http://www.w3.org/2000/svg">'
    '<rect x="1" y="1" width="10" height="10" fill="url(#g)"/></svg>', ".svg")
check("css:local-fill-url:passes", ok)
# XML stylesheet processing instruction refused before the XML parser
# discards it.
ok, findings = check_text(
    '<?xml version="1.0"?><?xml-stylesheet type="text/css" '
    'href="https://example.invalid/x.css"?>'
    '<svg xmlns="http://www.w3.org/2000/svg"><text>t</text></svg>', ".svg")
check("svg:stylesheet-pi:refused",
      (not ok) and "F_UNADMITTED_PI" in {f["code"] for f in findings})
# The XML declaration itself remains admitted.
ok, _ = check_text(
    '<?xml version="1.0" encoding="utf-8"?>'
    '<svg xmlns="http://www.w3.org/2000/svg"><text>t</text></svg>', ".svg")
check("svg:xml-declaration:passes", ok)
# Unsupported logical sizing refused (closed property set); physical
# sizing at the bound still passes.
ok, findings = check_text(
    '<svg xmlns="http://www.w3.org/2000/svg" '
    'style="inline-size:9001px;block-size:20px"></svg>', ".svg")
check("bounds:logical-sizing:refused",
      (not ok) and "F_UNADMITTED_CSS" in {f["code"] for f in findings})
ok, findings = check_text(
    '<svg xmlns="http://www.w3.org/2000/svg" '
    'style="inline-size:8000px"></svg>', ".svg")
check("bounds:logical-sizing-8000:refused",
      (not ok) and "F_UNADMITTED_CSS" in {f["code"] for f in findings})
ok, _ = check_text(_svg_doc("", viewBox="0 0 400 200", width="8000",
                             height="8000"), ".svg")
check("bounds:dimension-8000:passes", ok)
ok, findings = check_text(_svg_doc("", viewBox="0 0 400 200", width="8001",
                                   height="20"), ".svg")
check("bounds:dimension-8001:refused",
      (not ok) and "F_OVERSIZED" in {f["code"] for f in findings})
ok, _ = check_text('<svg xmlns="http://www.w3.org/2000/svg" '
                   'style="width:8000px;height:20px"></svg>', ".svg")
check("bounds:css-dimension-8000:passes", ok)
ok, findings = check_text('<svg xmlns="http://www.w3.org/2000/svg" '
                          'style="width:8001px;height:20px"></svg>', ".svg")
check("bounds:css-dimension-8001:refused",
      (not ok) and "F_OVERSIZED" in {f["code"] for f in findings})
# --- 3. Dimension / structural bounds (D641-004) ---
ok, findings = check_text('<svg xmlns="http://www.w3.org/2000/svg" '
                          'style="width:50%"></svg>', ".svg")
check("bounds:css-percent:rejected",
      (not ok) and "F_UNSUPPORTED_SIZING" in {f["code"] for f in findings})
ok, _ = check_text(_svg_doc("", viewBox="0 0 400,200"), ".svg")
check("bounds:comma-viewBox:passes", ok)
ok, findings = check_text(_svg_doc("", viewBox="0 0 400 9001"), ".svg")
check("bounds:viewBox-9001:refused",
      (not ok) and "F_OVERSIZED" in {f["code"] for f in findings})
for bad_vb in ("0 0 NaN 200", "0 0 Infinity 200", "0 0 400"):
    ok, findings = check_text(_svg_doc("", viewBox=bad_vb), ".svg")
    check(f"bounds:viewBox-{bad_vb}:refused",
          (not ok) and "F_INVALID_DIMENSION" in {f["code"] for f in findings})
ok, findings = check_text(
    "<html><body><svg><g></svg></g></body></html>", ".html")
check("bounds:misnested:refused",
      (not ok) and "F_MALFORMED" in {f["code"] for f in findings})
ok, findings = check_text("<html><body><svg><g><text>oops", ".html")
check("bounds:unterminated:refused",
      (not ok) and "F_MALFORMED" in {f["code"] for f in findings})
# True nesting depth 64 passes, 65 refused (svg=1, each g adds 1).
deep64 = ('<?xml version="1.0" encoding="utf-8"?>\n'
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">'
          + "<g>" * 63 + "</g>" * 63 + "</svg>")
deep65 = ('<?xml version="1.0" encoding="utf-8"?>\n'
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">'
          + "<g>" * 64 + "</g>" * 64 + "</svg>")
ok, _ = check_text(deep64, ".svg")
check("bounds:depth-64:passes", ok)
ok, findings = check_text(deep65, ".svg")
check("bounds:depth-65:refused",
      (not ok) and "F_OVERSIZED" in {f["code"] for f in findings})
# Void-element siblings in HTML head.
ok, _ = check_text('<!DOCTYPE html><html><head><meta charset="utf-8">'
                   '<title>t</title></head><body></body></html>', ".html")
check("bounds:void-siblings:passes", ok)

# --- 4. Sanitizer conversions (D641-002) ---
_, html_out, report = sanitize(FIX / "valid-03.html")
check("sanitize:valid-03:ok", report["ok"])
san_path = _tmp(html_out, ".html")
ok2, findings2 = check_file(san_path)
check("sanitize:valid-03:offline-clean", ok2, f"findings={len(findings2)}")
check("sanitize:valid-03:text-preserved", report["text_preserved"],
      f"text nodes {report['text_nodes_before']}->{report['text_nodes_after']}")
before = re.findall(r"<text[^>]*>(.*?)</text>",
                    (FIX / "valid-03.html").read_text(), re.DOTALL)
after = re.findall(r"<text[^>]*>(.*?)</text>", html_out, re.DOTALL)
check("sanitize:valid-03:labels-identical", before == after,
      f"labels={len(before)}")
removed = {c["code"] for c in report["changes"]}
check("sanitize:valid-03:removed-font-link",
      "REMOVED_REMOTE_LINK" in removed, f"changes={sorted(removed)}")

# Idempotence: sanitizing the output changes nothing.
ok_i, out_i, _ = sanitize(san_path)
check("sanitize:idempotent", ok_i and out_i == html_out)

# Adversarial quoted attribute must not become an event handler.
adv = _tmp('<svg xmlns="http://www.w3.org/2000/svg">'
           '<text title="&quot; onmouseover=&quot;alert(1)">Hello</text></svg>',
           ".svg")
ok_a, out_a, _ = sanitize(adv)
adv_out = _tmp(out_a, ".svg") if ok_a else None
clean_a = check_file(adv_out)[0] if adv_out else False
has_handler_attr = 'onmouseover="' in out_a if ok_a else True
check("sanitize:adversarial-attr:no-handler",
      ok_a and clean_a and not has_handler_attr, f"out={out_a[:80]}")

# Entities / Unicode survive with identical rendered text.
ent = _tmp('<svg xmlns="http://www.w3.org/2000/svg">'
           '<text>A &amp; B &#x1F600; &lt;ok&gt;</text></svg>', ".svg")
ok_e, out_e, rep_e = sanitize(ent)
check("sanitize:entities-preserved",
      ok_e and rep_e["text_preserved"] and "&#x1F600;" not in out_e
      and "\U0001F600" in out_e)

# Sanitizer never adds unadmitted elements/attributes: output passes gate.
check("sanitize:output-admits-policy", ok2)

# --- 5. Sanitizer refusals (D641-003) ---
qi = _tmp('<style>@import "https://example.invalid/x.css";</style>'
          '<svg><text>A</text></svg>', ".html")
ok_q, out_q, rep_q = sanitize(qi)
check("sanitize:quoted-import:stripped-or-refused",
      (ok_q and "@import" not in out_q) or not ok_q)
pr = _tmp('<style>@import url(//example.invalid/x.css);</style>'
          '<svg><text>A</text></svg>', ".html")
ok_p, out_p, _ = sanitize(pr)
check("sanitize:protocol-relative-import:stripped-or-refused",
      (ok_p and "example.invalid" not in out_p) or not ok_p)
es = _tmp('<style>p{background:u\\72l(https://example.invalid/x.png)}</style>'
          '<p>hi</p>', ".html")
ok_s, _, rep_s = sanitize(es)
check("sanitize:escaped-css-url:refused",
      (not ok_s) and "F_REMOTE_CSS" in rep_s.get("finding_codes", []))
# Failed conversion: CLI exits nonzero and preserves existing destination.
dst = _tmp("SENTINEL-DO-NOT-OVERWRITE", ".html")
proc = subprocess.run([sys.executable, str(HERE / "sanitize_offline.py"),
                       str(es), str(dst), "--json"],
                      capture_output=True, text=True, timeout=60)
check("sanitize:cli-refused-exit",
      proc.returncode == 1, f"exit={proc.returncode}")
check("sanitize:cli-preserves-destination",
      dst.read_text(encoding="utf-8") == "SENTINEL-DO-NOT-OVERWRITE")
# Successful conversion: CLI exits zero and writes the destination.
dst2 = _tmp("SENTINEL", ".html")
proc2 = subprocess.run([sys.executable, str(HERE / "sanitize_offline.py"),
                        str(FIX / "valid-03.html"), str(dst2), "--json"],
                       capture_output=True, text=True, timeout=60)
ok_c, _ = check_file(dst2)
check("sanitize:cli-success-writes",
      proc2.returncode == 0 and ok_c, f"exit={proc2.returncode}")


def _run_cli_json(script: str, *args: str) -> tuple[int, str, str]:
    proc = subprocess.run([sys.executable, str(HERE / script), *args],
                          capture_output=True, text=True, timeout=60)
    return proc.returncode, proc.stdout, proc.stderr


# --- 5b. D641-004 residuals: pre-traversal bounds in the sanitizer ---# Entity-before-parse canary: declarations must be refused before any
# parser sees them, never expanded.
ent_in = _tmp('<!DOCTYPE svg [<!ENTITY msg "EXPANDED">]>'
              '<svg xmlns="http://www.w3.org/2000/svg">'
              "<text>&msg;</text></svg>", ".svg")
ok_ent, out_ent, rep_ent = sanitize(ent_in)
check("sanitize:entity-before-parse:refused",
      (not ok_ent) and "F_ENTITY_EXPANSION" in rep_ent.get("finding_codes", [])
      and "EXPANDED" not in out_ent)
# 1100-deep nesting: bounded refusal, never RecursionError.
deep_in = _tmp('<?xml version="1.0" encoding="utf-8"?>\n'
               '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">'
               + "<g>" * 1100 + "</g>" * 1100 + "</svg>", ".svg")
try:
    ok_deep, _, rep_deep = sanitize(deep_in)
    deep_refused = (not ok_deep) and "F_OVERSIZED" in rep_deep.get(
        "finding_codes", [])
except RecursionError:
    deep_refused = False
check("sanitize:depth-1100:refused-not-crash", deep_refused)
# Refused sanitize() produces no output and touches no destination.
deep_dst = _tmp("SENTINEL-DEEP", ".html")
proc_deep = subprocess.run([sys.executable, str(HERE / "sanitize_offline.py"),
                            str(deep_in), str(deep_dst), "--json"],
                           capture_output=True, text=True, timeout=120)
check("sanitize:deep-refusal:no-destination-change",
      proc_deep.returncode == 1
      and deep_dst.read_text(encoding="utf-8") == "SENTINEL-DEEP")
# Logical sizing refused at sanitize() level too (pre-gate policy).
log_in = _tmp('<svg xmlns="http://www.w3.org/2000/svg" '
              'style="inline-size:9001px"></svg>', ".svg")
ok_log, _, rep_log = sanitize(log_in)
check("sanitize:logical-sizing:refused",
      (not ok_log) and "F_UNADMITTED_CSS" in rep_log.get("finding_codes", []))

# --- 5c. D641-005 residuals: operational failures stay bounded ---
# Missing destination parent with a private marker in the path: exit 1,
# one fixed-code operational result, no path echo, no success-looking report.
missing_parent = Path(tempfile.gettempdir()) / "CONFIDENTIAL-Vault-7-missing-dir"
missing_dst = missing_parent / "out.html"
valid_src = _tmp("<div>hello</div>", ".html")
rc_m, out_m, err_m = _run_cli_json("sanitize_offline.py",
                                   str(valid_src), str(missing_dst), "--json")
leak_m = any(m in out_m or m in err_m for m in PRIVATE_MARKERS)
try:
    rep_m = json.loads(out_m)
except Exception:  # noqa: BLE001
    rep_m = {}
check("sanitize:missing-parent:bounded-failure",
      rc_m == 1 and not leak_m and rep_m.get("ok") is not True,
      f"exit={rc_m}")
# Human-readable form too.
rc_mh, out_mh, err_mh = _run_cli_json("sanitize_offline.py",
                                     str(valid_src), str(missing_dst))
check("sanitize:missing-parent:human-bounded",
      rc_mh == 1 and not any(m in out_mh or m in err_mh
                             for m in PRIVATE_MARKERS))
# Destination path that is a directory: bounded refusal, no traceback leak.
dir_dst = Path(tempfile.mkdtemp())
rc_d, out_d, err_d = _run_cli_json("sanitize_offline.py",
                                   str(valid_src), str(dir_dst), "--json")
check("sanitize:destination-is-dir:bounded-failure",
      rc_d == 1 and not any(m in out_d or m in err_d
                            for m in PRIVATE_MARKERS))


# --- 6. Privacy: no source content in diagnostics (D641-005) ---
priv_files = {
    "url": _tmp('<html><head><link rel="stylesheet" '
                'href="https://example.invalid/CONFIDENTIAL-Vault-7?token=s3cr3t-t0ken">'
                "</head><body></body></html>", ".html"),
    "css": _tmp('<html><head><style>@import '
                '"https://example.invalid/s3cr3t-t0ken.css";</style></head>'
                "<body></body></html>", ".html"),
    "attr": _tmp('<html><body><svg><text title="CONFIDENTIAL s3cr3t-t0ken">'
                 'x</text></svg></body></html>', ".html"),
    "malformed": _tmp('<svg><g><text>CONFIDENTIAL-Vault-7', ".svg"),
}
# Private marker also embedded in a FILENAME.
priv_named = FIX.parent / "tmp-priv-CONFIDENTIAL-Vault-7-check.html"
priv_named.write_text(priv_files["url"].read_text(encoding="utf-8"))
leak = False
for label, pf in list(priv_files.items()) + [("filename", priv_named)]:
    for script, sargs in (("check_offline.py", ["--json"]),
                          ("check_offline.py", [])):
        rc, out, err = _run_cli_json(script, str(pf), *sargs)
        if any(m in out or m in err for m in PRIVATE_MARKERS):
            leak = True
            print(f"  LEAK in {script} {sargs} over {label}")
    for script, sargs in (("sanitize_offline.py", ["--json"]),
                          ("sanitize_offline.py", [])):
        d = _tmp("SENTINEL", ".html")
        rc, out, err = _run_cli_json(script, str(pf), str(d), *sargs)
        if any(m in out or m in err for m in PRIVATE_MARKERS):
            leak = True
            print(f"  LEAK in {script} {sargs} over {label}")
check("privacy:no-source-content-in-diagnostics", not leak)
priv_named.unlink(missing_ok=True)


# --- 7. Network-denied render (Playwright) ---
def network_denied(paths: list[Path]) -> tuple[bool, list[str], str, str, str]:
    """Load pages with ALL network aborted.

    Returns (zero_requests, attempted, png_path, labels_note, browser_id).
    Only files passing the static gate are rendered; refused files are
    never rendered (canary).
    """
    from playwright.sync_api import sync_playwright

    attempted: list[str] = []
    exe = (Path.home() / ".cache/ms-playwright/chromium-1234/chrome-linux64/chrome")
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=str(exe),
                                    args=["--no-sandbox"])
        try:
            browser_id = f"chromium-1234/{browser.version}"
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
            labels_note = ""
            for path in paths:
                gate_ok, _ = check_file(path)
                if not gate_ok:
                    raise AssertionError(
                        f"refused file reached the renderer: {path.name}")
                page = ctx.new_page()
                page.goto(path.resolve().as_uri(),
                          wait_until="domcontentloaded")
                page.wait_for_timeout(1500)
                # Essential labels present after system-font substitution:
                # rendered svg text must equal the source's svg text nodes.
                texts = page.eval_on_selector_all(
                    "svg text", "els => els.map(e => e.textContent)")
                expected = _svg_labels(path)
                labels_note = f"texts={len(texts)}"
                if sorted(t for t in texts if t and t.strip()) != \
                   sorted(expected):
                    raise AssertionError(
                        f"label mismatch after render: {path.name} "
                        f"rendered={texts!r} expected={expected!r}")
                # Boxes not clipped to zero (geometry survives substitution).
                boxes = page.eval_on_selector_all(
                    "svg rect, svg text",
                    "els => els.map(e => { const b = e.getBBox(); "
                    "return [b.width, b.height]; })")
                if not all(w > 0 and h > 0 for w, h in boxes):
                    raise AssertionError(
                        f"clipped/empty geometry after render: {path.name}")
                # PNG export flow under the same denied network. NOTE: this
                # exercises Playwright SVG-element rasterization, not the
                # installed skill's export_png.py.
                if path.suffix == ".html":
                    svg = page.locator("svg").first
                    box = svg.evaluate(
                        "el => { const b = el.viewBox.baseVal; "
                        "return [b.width, b.height]; }")
                    if box[0] > 0 and box[1] > 0:
                        with tempfile.NamedTemporaryFile(
                                "wb", suffix=".png", delete=False) as f:
                            png_path = f.name
                        svg.screenshot(path=png_path)
                page.close()
            return (len(attempted) == 0), attempted, png_path, labels_note, \
                browser_id
        finally:
            browser.close()


def run_network() -> None:
    pages = [FIX / "valid-01.html", san_path, FIX / "valid-04.html",
             FIX / "valid-02.svg"]
    try:
        ok3, attempted, png, labels_note, browser_id = network_denied(pages)
    except AssertionError as exc:
        check("network-denied:gate-and-render", False, str(exc)[:100])
        return
    except Exception as exc:  # noqa: BLE001
        check("network-denied:zero-requests", False, f"error: {exc!r}"[:100])
        return
    check("network-denied:zero-requests", ok3,
          f"attempted={len(attempted)} browser={browser_id} " + labels_note +
          (f" first={attempted[0][:60]}" if attempted else ""))
    if png:
        size = Path(png).stat().st_size
        check("network-denied:png-exported", size > 1000, f"{size} bytes")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--network", action="store_true",
                        help="run Playwright network-denied test")
    parser.add_argument("--skip-network", action="store_true")
    args = parser.parse_args()

    if args.network and not args.skip_network:
        try:
            run_network()
        except Exception as exc:  # noqa: BLE001
            check("network-denied:zero-requests", False, f"error: {exc!r}"[:80])
        # Request canary: a newly-refused resource-bearing fixture must be
        # stopped by the static gate before any renderer sees it.
        canary = _tmp('<style>div{background-image:'
                      'image-set("https://example.invalid/x.png" 1x)}</style>'
                      "<div>t</div>", ".html")
        try:
            network_denied([canary])
            check("network-denied:refused-never-rendered", False,
                  "gate bypassed")
        except AssertionError as exc:
            held = "refused file reached the renderer" in str(exc)
            check("network-denied:refused-never-rendered", held,
                  "gate held" if held else "unexpected")
        except Exception as exc:  # noqa: BLE001
            check("network-denied:refused-never-rendered", False,
                  f"error: {exc!r}"[:80])
    elif not args.network:
        print("note: network test skipped (pass --network to run)")

    failed = [n for n, ok, _ in results if not ok]
    print(f"\n{len(results) - len(failed)}/{len(results)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
