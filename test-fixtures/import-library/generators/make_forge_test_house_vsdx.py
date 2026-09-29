"""Generate the FORGE import-library test house as a Visio (.vsdx) drawing.

Original FORGE drawing (no third-party content): the same 40' x 28' house as
make_forge_test_house.py, built as a complete OPC package the way Visio's
floor-plan template stores one: [Content_Types], package/document rels,
core/app properties, a masters part (Wall, Door, Window, Space, Queen bed,
Sofa, Dining table), and two pages ("Floor Plan" and "Notes").

Page scale: 1/4" = 1'-0" (PageScale 0.25 in, DrawingScale 12 in); shape
cells are in drawing units (real-world inches), which is how scaled Visio
pages store geometry.

Output: vsdx/forge-test-house.vsdx     Run: python make_forge_test_house_vsdx.py
"""

import os
import zipfile
from xml.sax.saxutils import escape

from make_forge_test_house import EXT, INT, W, D, WALLS, OPENINGS, ROOMS, unit

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
NS = "http://schemas.microsoft.com/office/visio/2012/main"
RNS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
FIXED_TIME = (2026, 9, 28, 0, 0, 0)  # deterministic zip timestamps

MASTERS = [(1, "Wall"), (2, "Door"), (3, "Window"), (4, "Space"), (5, "Queen bed"), (6, "Sofa"), (7, "Dining table")]


def cell(n, v, u=None):
    unit_attr = f' U="{u}"' if u else ""
    return f'<Cell N="{n}" V="{v:.4f}"{unit_attr}/>' if isinstance(v, float) else f'<Cell N="{n}" V="{v}"{unit_attr}/>'


def rect_geom(w, h):
    rows = [("MoveTo", 0, 0), ("LineTo", w, 0), ("LineTo", w, h), ("LineTo", 0, h), ("LineTo", 0, 0)]
    return '<Section N="Geometry" IX="0">' + "".join(
        f'<Row T="{t}" IX="{i + 1}">{cell("X", float(x))}{cell("Y", float(y))}</Row>' for i, (t, x, y) in enumerate(rows)) + "</Section>"


class Page:
    def __init__(self):
        self.shapes = []
        self.next_id = 1

    def shape(self, master, pinx, piny, w, h, angle=0.0, text="", name=None, extra_geom=""):
        sid = self.next_id
        self.next_id += 1
        name_attr = f' NameU="{escape(name)}"' if name else ""
        cells = (cell("PinX", float(pinx), "IN") + cell("PinY", float(piny), "IN") + cell("Width", float(w), "IN")
                 + cell("Height", float(h), "IN") + cell("LocPinX", float(w / 2), "IN") + cell("LocPinY", float(h / 2), "IN")
                 + cell("Angle", float(angle), "RAD"))
        text_xml = f"<Text>{escape(text)}</Text>" if text else ""
        self.shapes.append(f'<Shape ID="{sid}" Type="Shape" Master="{master}"{name_attr}>{cells}{rect_geom(w, h)}{extra_geom}{text_xml}</Shape>')
        return sid

    def xml(self, page_w, page_h):
        sheet = (cell("PageWidth", float(page_w), "IN") + cell("PageHeight", float(page_h), "IN")
                 + cell("PageScale", 0.25, "IN") + cell("DrawingScale", 12.0, "IN") + cell("DrawingSizeType", 3))
        return (f'<?xml version="1.0" encoding="utf-8" standalone="yes"?><PageContents xmlns="{NS}" xmlns:r="{RNS}">'
                f"<PageSheet>{sheet}</PageSheet><Shapes>{''.join(self.shapes)}</Shapes></PageContents>")


def floor_plan():
    import math
    p = Page()
    for wi, (x1, y1, x2, y2, t) in enumerate(WALLS):
        dx, dy = unit((x2 - x1, y2 - y1))
        length = math.hypot(x2 - x1, y2 - y1)
        cuts = sorted((c - w / 2, c + w / 2) for (wj, c, w, _k) in OPENINGS if wj == wi)
        spans, cur = [], 0.0
        for a, b in cuts:
            spans.append((cur, a))
            cur = b
        spans.append((cur, length))
        angle = math.atan2(dy, dx)
        for a, b in spans:
            if b - a < 0.5:
                continue
            mid = (a + b) / 2
            p.shape(1, x1 + dx * mid, y1 + dy * mid, b - a, t, angle, name="Wall")
    for wi, c, w, kind in OPENINGS:
        x1, y1, x2, y2, t = WALLS[wi]
        dx, dy = unit((x2 - x1, y2 - y1))
        angle = math.atan2(dy, dx)
        cx, cy = x1 + dx * c, y1 + dy * c
        if kind == "door":
            p.shape(2, cx, cy, w, t, angle, name="Door")
        else:
            p.shape(3, cx, cy, w, t, angle, name="Window")
    for name, pts in ROOMS:
        xs, ys = [q[0] for q in pts], [q[1] for q in pts]
        p.shape(4, (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, max(xs) - min(xs), max(ys) - min(ys), text=name.title(), name="Space")
    p.shape(5, 264, 80, 60, 80, name="Queen bed")
    p.shape(5, 408, 80, 60, 80, name="Queen bed")
    p.shape(6, 72, 58, 84, 36, name="Sofa")
    p.shape(7, 276, 268, 72, 36, name="Dining table")
    return p.xml(11 * 48, 8.5 * 48)


def notes_page():
    p = Page()
    p.shape(4, 264, 300, 400, 40, text="FORGE IMPORT TEST HOUSE - ORIGINAL FORGE TEST DRAWING - 1/4 in = 1 ft", name="Title")
    return p.xml(11 * 48, 8.5 * 48)


def masters_xml():
    els = "".join(f'<Master ID="{mid}" NameU="{n}" Name="{n}"><Rel r:id="rId{i + 1}"/></Master>' for i, (mid, n) in enumerate(MASTERS))
    return f'<?xml version="1.0" encoding="utf-8" standalone="yes"?><Masters xmlns="{NS}" xmlns:r="{RNS}">{els}</Masters>'


def master_contents(name):
    return (f'<?xml version="1.0" encoding="utf-8" standalone="yes"?><MasterContents xmlns="{NS}" xmlns:r="{RNS}"><Shapes>'
            f'<Shape ID="5" Type="Shape" NameU="{name}">{cell("Width", 1.0, "IN")}{cell("Height", 1.0, "IN")}{rect_geom(1, 1)}</Shape>'
            f"</Shapes></MasterContents>")


def rels(items):
    body = "".join(f'<Relationship Id="{rid}" Type="{t}" Target="{target}"/>' for rid, t, target in items)
    return f'<?xml version="1.0" encoding="utf-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">{body}</Relationships>'


def build():
    V = "http://schemas.microsoft.com/visio/2010/relationships"
    O = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
    parts = {}
    ct_over = [
        ("/visio/document.xml", "application/vnd.ms-visio.drawing.main+xml"),
        ("/visio/pages/pages.xml", "application/vnd.ms-visio.pages+xml"),
        ("/visio/pages/page1.xml", "application/vnd.ms-visio.page+xml"),
        ("/visio/pages/page2.xml", "application/vnd.ms-visio.page+xml"),
        ("/visio/masters/masters.xml", "application/vnd.ms-visio.masters+xml"),
        *[(f"/visio/masters/master{i + 1}.xml", "application/vnd.ms-visio.master+xml") for i in range(len(MASTERS))],
        ("/docProps/core.xml", "application/vnd.openxmlformats-package.core-properties+xml"),
        ("/docProps/app.xml", "application/vnd.openxmlformats-officedocument.extended-properties+xml"),
    ]
    parts["[Content_Types].xml"] = ('<?xml version="1.0" encoding="utf-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
        + "".join(f'<Override PartName="{n}" ContentType="{t}"/>' for n, t in ct_over) + "</Types>")
    parts["_rels/.rels"] = rels([("rId1", "http://schemas.microsoft.com/visio/2010/relationships/document", "visio/document.xml"),
                                 ("rId2", "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties", "docProps/core.xml"),
                                 ("rId3", f"{O}/extended-properties", "docProps/app.xml")])
    parts["docProps/core.xml"] = ('<?xml version="1.0" encoding="utf-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
        'xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>FORGE import test house</dc:title><dc:creator>FORGE import test library</dc:creator></cp:coreProperties>')
    parts["docProps/app.xml"] = '<?xml version="1.0" encoding="utf-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>FORGE test generator</Application></Properties>'
    parts["visio/document.xml"] = f'<?xml version="1.0" encoding="utf-8" standalone="yes"?><VisioDocument xmlns="{NS}" xmlns:r="{RNS}"/>'
    parts["visio/_rels/document.xml.rels"] = rels([("rId1", f"{V}/pages", "pages/pages.xml"), ("rId2", f"{V}/masters", "masters/masters.xml")])
    parts["visio/pages/pages.xml"] = (f'<?xml version="1.0" encoding="utf-8" standalone="yes"?><Pages xmlns="{NS}" xmlns:r="{RNS}">'
        '<Page ID="0" NameU="Floor Plan" Name="Floor Plan"><Rel r:id="rId1"/></Page><Page ID="1" NameU="Notes" Name="Notes"><Rel r:id="rId2"/></Page></Pages>')
    parts["visio/pages/_rels/pages.xml.rels"] = rels([("rId1", f"{V}/page", "page1.xml"), ("rId2", f"{V}/page", "page2.xml")])
    parts["visio/pages/page1.xml"] = floor_plan()
    parts["visio/pages/page2.xml"] = notes_page()
    parts["visio/masters/masters.xml"] = masters_xml()
    parts["visio/masters/_rels/masters.xml.rels"] = rels([(f"rId{i + 1}", f"{V}/master", f"master{i + 1}.xml") for i in range(len(MASTERS))])
    for i, (_mid, name) in enumerate(MASTERS):
        parts[f"visio/masters/master{i + 1}.xml"] = master_contents(name)

    path = os.path.join(ROOT, "vsdx", "forge-test-house.vsdx")
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        for name, data in parts.items():
            info = zipfile.ZipInfo(name, date_time=FIXED_TIME)
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, data)
    return path


if __name__ == "__main__":
    print(build())
