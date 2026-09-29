"""Generate the FORGE import-library "test house" fixtures.

Original FORGE drawing (authored for this test library; no third-party
source), written the way a residential CAD plan is actually drawn:
AIA-style layers, walls as two parallel faces per segment, door leaves with
swing arcs in wall gaps, three-line window symbols, closed room outlines
with centred names, linear dimensions, furniture blocks, a hatch, and a
title block. Units: inches ($INSUNITS = 1).

Outputs (next to this script's parent folders):
  dxf/forge-test-house.dxf         detailed DXF
  pdf/forge-test-house-vector.pdf  the same plan as a vector PDF

Run:  python make_forge_test_house.py   (needs ezdxf + matplotlib)
Deterministic: same input -> same geometry (DXF handles may differ).
"""

import os
import ezdxf
from ezdxf import units
from ezdxf.enums import TextEntityAlignment

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

EXT = 6.0  # exterior wall thickness (in)
INT = 4.5  # interior wall thickness (in)
W, D = 480.0, 336.0  # 40' x 28' outside dimensions

# Wall centerlines: (x1, y1, x2, y2, thickness). y grows up (CAD convention).
e = EXT / 2
WALLS = [
    (e, e, W - e, e, EXT),  # south
    (W - e, e, W - e, D - e, EXT),  # east
    (W - e, D - e, e, D - e, EXT),  # north
    (e, D - e, e, e, EXT),  # west
    (192, e, 192, D - e, INT),  # living | rest
    (192, 168, W - e, 168, INT),  # kitchen+bath (north) | bedrooms (south)
    (336, e, 336, 168, INT),  # bedroom 1 | bedroom 2
    (384, 168, 384, D - e, INT),  # kitchen | bath
]
# Openings on a wall index: (wall, distance-from-start-to-centre, width, kind)
OPENINGS = [
    (0, 96, 36, "door"),  # front door (living)
    (0, 264, 48, "window"),  # bedroom 1 window
    (0, 408, 48, "window"),  # bedroom 2 window
    (1, 252, 36, "window"),  # bath window
    (2, 144, 60, "window"),  # kitchen window (north)
    (2, 360, 72, "window"),  # living window (north)
    (3, 168, 72, "window"),  # living window (west)
    (4, 240, 32, "door"),  # living -> kitchen
    (5, 72, 30, "door"),  # hall -> bedroom 1 (from kitchen side)
    (5, 216, 30, "door"),  # -> bedroom 2
    (7, 60, 28, "door"),  # kitchen -> bath
]
ROOMS = [
    ("LIVING", [(e + 3, e + 3), (192 - 3, e + 3), (192 - 3, D - e - 3), (e + 3, D - e - 3)]),
    ("KITCHEN", [(192 + 3, 168 + 3), (384 - 3, 168 + 3), (384 - 3, D - e - 3), (192 + 3, D - e - 3)]),
    ("BATH", [(384 + 3, 168 + 3), (W - e - 3, 168 + 3), (W - e - 3, D - e - 3), (384 + 3, D - e - 3)]),
    ("BEDROOM 1", [(192 + 3, e + 3), (336 - 3, e + 3), (336 - 3, 168 - 3), (192 + 3, 168 - 3)]),
    ("BEDROOM 2", [(336 + 3, e + 3), (W - e - 3, e + 3), (W - e - 3, 168 - 3), (336 + 3, 168 - 3)]),
]


def unit(v):
    import math
    n = math.hypot(v[0], v[1])
    return (v[0] / n, v[1] / n)


def build_dxf():
    doc = ezdxf.new("R2018", setup=True)
    doc.units = units.IN
    doc.header["$INSUNITS"] = 1
    doc.header["$MEASUREMENT"] = 0
    layers = {
        "A-WALL": 7, "A-DOOR": 3, "A-GLAZ": 5, "A-AREA": 8, "A-AREA-IDEN": 2,
        "A-DIMS": 1, "A-FURN": 6, "A-FLOR-PATT": 9, "A-ANNO-TTLB": 7,
    }
    for name, color in layers.items():
        doc.layers.add(name, color=color)
    msp = doc.modelspace()

    # Walls: two faces per segment, interrupted at openings.
    for wi, (x1, y1, x2, y2, t) in enumerate(WALLS):
        dx, dy = unit((x2 - x1, y2 - y1))
        nx, ny = -dy, dx
        length = ((x2 - x1) ** 2 + (y2 - y1) ** 2) ** 0.5
        cuts = sorted((c - w / 2, c + w / 2) for (wj, c, w, _k) in OPENINGS if wj == wi)
        spans, cur = [], 0.0
        for a, b in cuts:
            spans.append((cur, a))
            cur = b
        spans.append((cur, length))
        for a, b in spans:
            if b - a < 0.5:
                continue
            for side in (-1, 1):
                ox, oy = nx * side * t / 2, ny * side * t / 2
                msp.add_line((x1 + dx * a + ox, y1 + dy * a + oy), (x1 + dx * b + ox, y1 + dy * b + oy), dxfattribs={"layer": "A-WALL"})
            # jamb lines closing the wall ends at openings
            for s in (a, b):
                if 0.5 < s < length - 0.5:
                    px, py = x1 + dx * s, y1 + dy * s
                    msp.add_line((px - nx * t / 2, py - ny * t / 2), (px + nx * t / 2, py + ny * t / 2), dxfattribs={"layer": "A-WALL"})

    # Doors (leaf + 90-degree swing) and windows (three lines across the wall).
    import math
    for wi, c, w, kind in OPENINGS:
        x1, y1, x2, y2, t = WALLS[wi]
        dx, dy = unit((x2 - x1, y2 - y1))
        nx, ny = -dy, dx
        hx, hy = x1 + dx * (c - w / 2), y1 + dy * (c - w / 2)  # hinge side
        if kind == "door":
            tipx, tipy = hx + nx * w, hy + ny * w
            msp.add_line((hx, hy), (tipx, tipy), dxfattribs={"layer": "A-DOOR"})
            start = math.degrees(math.atan2(dy, dx))
            msp.add_arc((hx, hy), w, start, start + 90, dxfattribs={"layer": "A-DOOR"})
        else:
            for f in (-0.5, 0.0, 0.5):
                ox, oy = nx * f * t, ny * f * t
                msp.add_line((hx + ox, hy + oy), (hx + dx * w + ox, hy + dy * w + oy), dxfattribs={"layer": "A-GLAZ"})

    # Bath floor tile hatch (drawn before the room names so it never covers them).
    hatch = msp.add_hatch(color=9, dxfattribs={"layer": "A-FLOR-PATT"})
    hatch.set_pattern_fill("ANSI37", scale=96)
    hatch.paths.add_polyline_path(ROOMS[2][1], is_closed=True)

    # Rooms: closed outlines + centred names and areas.
    for name, pts in ROOMS:
        msp.add_lwpolyline(pts, close=True, dxfattribs={"layer": "A-AREA"})
        cx = sum(p[0] for p in pts) / len(pts)
        cy = sum(p[1] for p in pts) / len(pts)
        area = abs(sum(pts[i][0] * pts[(i + 1) % 4][1] - pts[(i + 1) % 4][0] * pts[i][1] for i in range(4))) / 2 / 144
        msp.add_text(name, height=9, dxfattribs={"layer": "A-AREA-IDEN"}).set_placement((cx, cy + 6), align=TextEntityAlignment.MIDDLE_CENTER)
        msp.add_text(f"{area:.0f} SF", height=6, dxfattribs={"layer": "A-AREA-IDEN"}).set_placement((cx, cy - 8), align=TextEntityAlignment.MIDDLE_CENTER)

    # Dimensions (overall).
    arch = {"dimlunit": 4, "dimlfac": 1.0, "dimtxt": 6, "dimasz": 4, "dimexe": 3, "dimexo": 2}  # feet-and-inches
    dim = msp.add_linear_dim(base=(0, -24), p1=(0, 0), p2=(W, 0), text="40'-0\"", dimstyle="Standard", override=arch, dxfattribs={"layer": "A-DIMS"})
    dim.render()
    dim = msp.add_linear_dim(base=(-24, 0), p1=(0, 0), p2=(0, D), angle=90, text="28'-0\"", dimstyle="Standard", override=arch, dxfattribs={"layer": "A-DIMS"})
    dim.render()

    # Furniture blocks.
    bed = doc.blocks.new("FURN-BED-QUEEN")
    bed.add_lwpolyline([(0, 0), (60, 0), (60, 80), (0, 80)], close=True)
    bed.add_lwpolyline([(4, 64), (28, 64), (28, 76), (4, 76)], close=True)
    bed.add_lwpolyline([(32, 64), (56, 64), (56, 76), (32, 76)], close=True)
    sofa = doc.blocks.new("FURN-SOFA")
    sofa.add_lwpolyline([(0, 0), (84, 0), (84, 36), (0, 36)], close=True)
    sofa.add_lwpolyline([(6, 6), (78, 6), (78, 28), (6, 28)], close=True)
    table = doc.blocks.new("FURN-TABLE-6")
    table.add_lwpolyline([(0, 0), (72, 0), (72, 36), (0, 36)], close=True)
    for x in (12, 36, 60):
        table.add_circle((x, -8), 7)
        table.add_circle((x, 44), 7)
    msp.add_blockref("FURN-BED-QUEEN", (234, 40), dxfattribs={"layer": "A-FURN"})
    msp.add_blockref("FURN-BED-QUEEN", (378, 40), dxfattribs={"layer": "A-FURN"})
    msp.add_blockref("FURN-SOFA", (30, 40), dxfattribs={"layer": "A-FURN"})
    msp.add_blockref("FURN-TABLE-6", (240, 250), dxfattribs={"layer": "A-FURN"})

    # Title block text.
    msp.add_text("FORGE IMPORT TEST HOUSE - FIRST FLOOR PLAN", height=10, dxfattribs={"layer": "A-ANNO-TTLB"}).set_placement((0, -48))
    msp.add_text("SCALE: 1/4\" = 1'-0\"   ORIGINAL FORGE TEST DRAWING", height=6, dxfattribs={"layer": "A-ANNO-TTLB"}).set_placement((0, -60))

    path = os.path.join(ROOT, "dxf", "forge-test-house.dxf")
    doc.saveas(path)
    return doc, path


def build_vector_pdf(doc):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from ezdxf.addons.drawing import RenderContext, Frontend
    from ezdxf.addons.drawing.matplotlib import MatplotlibBackend
    from ezdxf.addons.drawing.config import BackgroundPolicy, ColorPolicy, Configuration

    # True 1/4" = 1'-0" scale on an 11 x 8.5 sheet: one paper inch = 48
    # drawing inches, so the importer's architectural scale can be verified.
    fig = plt.figure(figsize=(11, 8.5))
    ax = fig.add_axes([0, 0, 1, 1])
    ctx = RenderContext(doc)
    config = Configuration(background_policy=BackgroundPolicy.WHITE, color_policy=ColorPolicy.BLACK)
    Frontend(ctx, MatplotlibBackend(ax), config=config).draw_layout(doc.modelspace(), finalize=False)
    cx, cy = W / 2, (D - 62) / 2  # plan + title block (y -62 .. 336) centred on the sheet
    ax.set_xlim(cx - 11 * 48 / 2, cx + 11 * 48 / 2)
    ax.set_ylim(cy - 8.5 * 48 / 2, cy + 8.5 * 48 / 2)
    ax.set_aspect("equal")
    ax.axis("off")
    path = os.path.join(ROOT, "pdf", "forge-test-house-vector.pdf")
    fig.savefig(path, format="pdf", metadata={"Creator": "FORGE import test library", "CreationDate": None, "ModDate": None})
    plt.close(fig)
    return path


if __name__ == "__main__":
    doc, dxf_path = build_dxf()
    pdf_path = build_vector_pdf(doc)
    print(dxf_path)
    print(pdf_path)
