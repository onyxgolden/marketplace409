# Generates two-room-plan-r2018.dxf, a realistic AutoCAD 2018 (AC1032) test plan,
# with ezdxf (pip install ezdxf). Walls are closed outlines (6" exterior, 4.5"
# interior partition), doors/windows are block INSERTs (one rotated, one on an
# unbroken wall), rooms are outlines + MTEXT, plus a furniture block, a real
# DIMENSION (ezdxf default style scales its text by 100), a HATCH.
import ezdxf
doc = ezdxf.new("R2018", setup=True)
doc.header["$INSUNITS"] = 1
for name, color in [("A-WALL", 7), ("A-DOOR", 3), ("A-GLAZ", 4), ("A-AREA-IDEN", 2), ("A-FURN", 8), ("A-ANNO-DIMS", 1), ("A-WALL-PATT", 9)]:
    doc.layers.add(name, color=color)
msp = doc.modelspace()
def rect(x0, y0, x1, y1, layer="A-WALL"):
    msp.add_lwpolyline([(x0, y0), (x1, y0), (x1, y1), (x0, y1)], close=True, dxfattribs={"layer": layer})
# Exterior 6" walls on centerline rectangle 0..288 x 0..192
T = 3
rect(-T, -T, 100, T); rect(136, -T, 288 + T, T)             # south, door gap 100..136
rect(-T, 192 - T, 40, 192 + T); rect(88, 192 - T, 288 + T, 192 + T)  # north, window gap 40..88
rect(-T, T, T, 192 - T)                                       # west
rect(288 - T, T, 288 + T, 192 - T)                            # east (unbroken; window drawn on it)
# Interior 4.5" partition at x=168 with a door gap y 60..92
t = 2.25
rect(168 - t, T, 168 + t, 60); rect(168 - t, 92, 168 + t, 192 - T)
# Blocks: door (leaf + 90deg swing) and window (glass lines + caps)
door = doc.blocks.new("DOOR36")
door.add_line((0, 0), (0, 36)); door.add_arc((0, 0), 36, 0, 90)
door32 = doc.blocks.new("DOOR32")
door32.add_line((0, 0), (0, 32)); door32.add_arc((0, 0), 32, 0, 90)
win = doc.blocks.new("WIN48")
for y in (-1, 1): win.add_line((0, y), (48, y))
for x in (0, 48): win.add_line((x, -T), (x, T))
msp.add_blockref("DOOR36", (100, T), dxfattribs={"layer": "A-DOOR"})
msp.add_blockref("DOOR32", (168 + t, 60), dxfattribs={"layer": "A-DOOR", "rotation": 90})
msp.add_blockref("WIN48", (40, 192), dxfattribs={"layer": "A-GLAZ"})
msp.add_blockref("WIN48", (288, 70), dxfattribs={"layer": "A-GLAZ", "rotation": 90})  # on the unbroken east wall
# Rooms
rect(T, T, 168 - t, 192 - T, "A-AREA-IDEN"); rect(168 + t, T, 288 - T, 192 - T, "A-AREA-IDEN")
msp.add_mtext("LIVING\\PROOM", dxfattribs={"layer": "A-AREA-IDEN", "char_height": 8}).set_location((80, 96))
msp.add_mtext("BEDROOM", dxfattribs={"layer": "A-AREA-IDEN", "char_height": 8}).set_location((228, 96))
# Furniture block, dimension, hatch
sofa = doc.blocks.new("SOFA84")
sofa.add_lwpolyline([(0, 0), (84, 0), (84, 36), (0, 36)], close=True)
msp.add_blockref("SOFA84", (40, 20), dxfattribs={"layer": "A-FURN"})
dim = msp.add_linear_dim(base=(0, -30), p1=(0, 0), p2=(288, 0), dxfattribs={"layer": "A-ANNO-DIMS"})
dim.render()
h = msp.add_hatch(dxfattribs={"layer": "A-WALL-PATT"}); h.paths.add_polyline_path([(-T, -T), (100, -T), (100, T), (-T, T)])
doc.saveas("two-room-plan-r2018.dxf")
print("ok")
