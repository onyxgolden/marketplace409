"""Generate an original, non-architectural VSDX diagram for the import test
library's "difficult" VSDX role.

Why this exists (2026-09-29): the fixture previously in this role,
vsdx/poi-github260.vsdx, was a real-world VSDX attached to an Apache POI bug
report (github.com/apache/poi issue #260, a NullPointerException on a
missing cell attribute). The bug report and the commit that added the file
to POI's test-data (SVN r1893992, message "github260") say nothing about
who created the DIAGRAM'S CONTENT or whether they had the right to
redistribute it — a reporter attaching a file that reproduces a parser bug
is not evidence they authored or licensed that file's content. Per this
library's own rule ("Provenance or it doesn't go in... 'Found it online' is
not evidence"), that fixture should never have been accepted, and is
replaced by this originally-authored one: a generic, non-architectural
org-chart-style diagram (64 boxes across an 8x8 grid, 56 connectors, 2
labeled title/legend boxes, and 2 deliberately-empty helper shapes — see
diagram_page() below) — no third-party content, no rights question, same
test purpose: content FORGE must import safely without inventing walls,
rooms or openings, the way a non-architectural diagram from any source
(this generator included) should be handled.

Output: vsdx/generic-diagram.vsdx     Run: python make_generic_diagram_vsdx.py
Deterministic: same input -> same bytes (fixed zip timestamps, stable shape order).
"""

import os
import zipfile
from xml.sax.saxutils import escape

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
NS = "http://schemas.microsoft.com/office/visio/2012/main"
RNS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
FIXED_TIME = (2026, 9, 29, 0, 0, 0)

# Deliberately generic, non-architectural master names: nothing here should
# ever be mistaken for Wall/Door/Window/Space evidence.
MASTERS = [(1, "Process"), (2, "Decision"), (3, "Terminator"), (4, "Connector")]


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

    def box(self, master, pinx, piny, w, h, text="", name=None):
        """A generic 2-D shape (box/terminator): the same rectangle-geometry
        pattern the floor-plan generator uses, just with non-architectural
        master names and text."""
        sid = self.next_id
        self.next_id += 1
        name_attr = f' NameU="{escape(name)}"' if name else ""
        cells = (cell("PinX", float(pinx), "IN") + cell("PinY", float(piny), "IN") + cell("Width", float(w), "IN")
                 + cell("Height", float(h), "IN") + cell("LocPinX", float(w / 2), "IN") + cell("LocPinY", float(h / 2), "IN"))
        text_xml = f"<Text>{escape(text)}</Text>" if text else ""
        self.shapes.append(f'<Shape ID="{sid}" Type="Shape" Master="{master}"{name_attr}>{cells}{rect_geom(w, h)}{text_xml}</Shape>')
        return sid

    def connector(self, x1, y1, x2, y2, name="Connector"):
        """A 1-D connector shape (BeginX/BeginY/EndX/EndY), the real Visio
        cell pair the importer's isOneD check looks for — org charts and
        flowcharts are full of these joining boxes together."""
        sid = self.next_id
        self.next_id += 1
        cells = (cell("BeginX", float(x1), "IN") + cell("BeginY", float(y1), "IN")
                 + cell("EndX", float(x2), "IN") + cell("EndY", float(y2), "IN"))
        geom = ('<Section N="Geometry" IX="0">'
                f'<Row T="MoveTo" IX="1">{cell("X", 0.0)}{cell("Y", 0.0)}</Row>'
                f'<Row T="LineTo" IX="2">{cell("X", 1.0)}{cell("Y", 0.0)}</Row></Section>')
        self.shapes.append(f'<Shape ID="{sid}" Type="Shape" Master="4" NameU="{escape(name)}">{cells}{geom}</Shape>')
        return sid

    def empty_helper(self):
        """No geometry section and no text — a plausible "helper" shape in a
        real exported diagram (a grouping anchor, a hidden guide) with
        nothing importable. Exercises the importer's `skipped` path."""
        sid = self.next_id
        self.next_id += 1
        self.shapes.append(f'<Shape ID="{sid}" Type="Shape"><Cell N="PinX" V="0.0000" U="IN"/><Cell N="PinY" V="0.0000" U="IN"/></Shape>')
        return sid

    def xml(self, page_w, page_h):
        sheet = (cell("PageWidth", float(page_w), "IN") + cell("PageHeight", float(page_h), "IN")
                 + cell("PageScale", 1.0, "IN") + cell("DrawingScale", 1.0, "IN") + cell("DrawingSizeType", 3))
        return (f'<?xml version="1.0" encoding="utf-8" standalone="yes"?><PageContents xmlns="{NS}" xmlns:r="{RNS}">'
                f"<PageSheet>{sheet}</PageSheet><Shapes>{''.join(self.shapes)}</Shapes></PageContents>")


def diagram_page():
    """A generic org-chart: an 8x8 grid of process/decision/terminator boxes
    (64 boxes), a connector joining each box to its left neighbor within its
    row (56 connectors, since the first column has none to join), 2 labeled
    title/legend boxes, and 2 deliberately-empty helper shapes — 124 shapes
    total (122 with importable geometry/text, 2 without), heavily varied
    text, non-architectural throughout, and no third-party content."""
    p = Page()
    cols = 8
    rows = 8
    box_w, box_h = 90.0, 40.0
    gap_x, gap_y = 30.0, 30.0
    labels = [
        "Start", "Intake", "Triage", "Review A", "Review B", "Escalate", "Approve", "Reject",
        "Archive", "Notify", "Route", "Assign", "Verify", "Audit", "Close", "Reopen",
    ]
    for r in range(rows):
        for c in range(cols):
            master = 2 if (r + c) % 3 == 0 else (3 if (r + c) % 7 == 0 else 1)
            label = labels[(r * cols + c) % len(labels)] + f" {r * cols + c + 1}"
            x = 60 + c * (box_w + gap_x)
            y = 60 + r * (box_h + gap_y)
            p.box(master, x, y, box_w, box_h, text=label, name=["Process", "Decision", "Terminator"][master - 1])
            if c > 0:
                p.connector(x - gap_x / 2, y + box_h / 2, x, y + box_h / 2)
    # A few standalone text labels (title, legend) with no box around them.
    p.box(1, 60, 20, 400, 24, text="GENERIC PROCESS DIAGRAM — ORIGINAL, NON-ARCHITECTURAL", name="Title")
    p.box(1, 60, rows * (box_h + gap_y) + 80, 300, 20, text="Legend: rectangles = steps, diamonds = decisions", name="Legend")
    # Deliberately empty helper shapes: no geometry, no text.
    p.empty_helper()
    p.empty_helper()
    return p.xml(1200, 900)


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
        'xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>FORGE generic diagram (non-architectural)</dc:title><dc:creator>FORGE import test library</dc:creator></cp:coreProperties>')
    parts["docProps/app.xml"] = '<?xml version="1.0" encoding="utf-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>FORGE test generator</Application></Properties>'
    parts["visio/document.xml"] = f'<?xml version="1.0" encoding="utf-8" standalone="yes"?><VisioDocument xmlns="{NS}" xmlns:r="{RNS}"/>'
    parts["visio/_rels/document.xml.rels"] = rels([("rId1", f"{V}/pages", "pages/pages.xml"), ("rId2", f"{V}/masters", "masters/masters.xml")])
    parts["visio/pages/pages.xml"] = (f'<?xml version="1.0" encoding="utf-8" standalone="yes"?><Pages xmlns="{NS}" xmlns:r="{RNS}">'
        '<Page ID="0" NameU="Diagram" Name="Diagram"><Rel r:id="rId1"/></Page></Pages>')
    parts["visio/pages/_rels/pages.xml.rels"] = rels([("rId1", f"{V}/page", "page1.xml")])
    parts["visio/pages/page1.xml"] = diagram_page()
    parts["visio/masters/masters.xml"] = masters_xml()
    parts["visio/masters/_rels/masters.xml.rels"] = rels([(f"rId{i + 1}", f"{V}/master", f"master{i + 1}.xml") for i in range(len(MASTERS))])
    for i, (_mid, name) in enumerate(MASTERS):
        parts[f"visio/masters/master{i + 1}.xml"] = master_contents(name)

    path = os.path.join(ROOT, "vsdx", "generic-diagram.vsdx")
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        for name, data in parts.items():
            info = zipfile.ZipInfo(name, date_time=FIXED_TIME)
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, data)
    return path


if __name__ == "__main__":
    print(build())
