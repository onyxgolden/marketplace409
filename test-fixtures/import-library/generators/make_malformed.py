"""Generate the deliberately malformed import-library fixtures.

All derived from FORGE's own test-house fixtures (no third-party content), so
each one isolates a single failure the importers must handle safely:

  dxf/malformed-truncated.dxf          DXF cut off mid-ENTITIES (no EOF marker)
  dxf/malformed-fake.dwg               DWG version signature + junk bytes
  vsdx/malformed-not-a-zip.vsdx        plain text renamed .vsdx
  vsdx/malformed-missing-pages.vsdx    valid zip, pages part removed
  pdf/malformed-truncated.pdf          PDF cut off before its xref/trailer

Run after make_forge_test_house*.py:  python make_malformed.py
"""

import os
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
FIXED_TIME = (2026, 9, 28, 0, 0, 0)


def read(rel):
    with open(os.path.join(ROOT, rel), "rb") as f:
        return f.read()


def write(rel, data):
    with open(os.path.join(ROOT, rel), "wb") as f:
        f.write(data)
    print(rel, len(data))


dxf = read("dxf/forge-test-house.dxf")
cut = dxf.find(b"ENTITIES")
write("dxf/malformed-truncated.dxf", dxf[: cut + (len(dxf) - cut) // 3])
write("dxf/malformed-fake.dwg", b"AC1032" + bytes((i * 37 + 11) % 256 for i in range(4090)))

write("vsdx/malformed-not-a-zip.vsdx", b"This is not a Visio package, just text with a .vsdx name.\n" * 20)
src = zipfile.ZipFile(os.path.join(ROOT, "vsdx/forge-test-house.vsdx"))
out = os.path.join(ROOT, "vsdx/malformed-missing-pages.vsdx")
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for name in src.namelist():
        if name.startswith("visio/pages/"):
            continue
        info = zipfile.ZipInfo(name, date_time=FIXED_TIME)
        info.compress_type = zipfile.ZIP_DEFLATED
        z.writestr(info, src.read(name))
print("vsdx/malformed-missing-pages.vsdx", os.path.getsize(out))

pdf = read("pdf/forge-test-house-vector.pdf")
write("pdf/malformed-truncated.pdf", pdf[: pdf.rfind(b"xref") // 2])
