#!/usr/bin/env python3
"""Generate the PPTX fixture corpus for Capture Phase 3 Slice 1 tests.

Reproducible: re-running this script regenerates every fixture byte-for-byte
(except ZIP timestamps, which do not affect test outcomes — tests assert on
parsed content, never on file hashes).

Fixtures (all built with python-pptx 1.0.2 unless noted):
  synthetic-4-slide-16x9.pptx  — FIXED synthetic deck: 4 slides, 16:9,
                                  title, bullets, picture, table, notes on all.
  deck-4x3-notes-images.pptx    — 4:3, 3 slides, notes + pictures.
  deck-16x9-table-chart.pptx    — 16:9, 3 slides, table + native chart + image.
  deck-mixed-placeholders-fonts.pptx — 16:9, footer/date/slide-number
                                  placeholders, missing-font text, group shape.
  deck-101-slides.pptx          — 101 slides: exceeds the 100-slide cap.
  deck-oversized-image.pptx     — embeds a 8000x6000 (48 MP) PNG: exceeds
                                  the 40 MP per-image cap.
  deck-external-rels-macro-ole.pptx — synthetic deck + external hyperlink
                                  relationship, vbaProject.bin macro part,
                                  embedded OLE object part (hand-built ZIP edit).
  bad-not-a-zip.pptx            — plain text, not a ZIP at all.
  bad-legacy.ppt                — OLE compound-document header, not a ZIP.
  bad-traversal.pptx            — ZIP entry named ../evil.txt.
  bad-zip-bomb.pptx             — one entry declaring 600 MB uncompressed
                                  (central-directory check must reject it
                                  without expanding it).
  bad-malformed.pptx            — valid ZIP, no presentation.xml.

Usage: python3 generate-pptx-fixtures.py [out-dir]
"""
import io
import os
import struct
import sys
import zipfile

from PIL import Image
from pptx import Presentation
from pptx.chart.data import CategoryChartData
from pptx.enum.chart import XL_CHART_TYPE
from pptx.enum.shapes import MSO_SHAPE
from pptx.util import Emu, Inches, Pt

OUT = sys.argv[1] if len(sys.argv) > 1 else "."
os.makedirs(OUT, exist_ok=True)


def _png(width, height, color, name):
    path = os.path.join(OUT, name)
    Image.new("RGB", (width, height), color).save(path, "PNG")
    return path


def _add_notes(slide, text):
    slide.notes_slide.notes_text_frame.text = text


def _title_and_bullets(slide, title, bullets):
    slide.shapes.title.text = title
    tf = slide.placeholders[1].text_frame
    tf.clear()
    for i, b in enumerate(bullets):
        para = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        para.text = b
        para.level = 0


def synthetic_4_slide():
    prs = Presentation()
    prs.slide_width = Inches(13.333)
    prs.slide_height = Inches(7.5)
    blank = prs.slide_layouts[6]
    title_layout = prs.slide_layouts[0]
    tbc_layout = prs.slide_layouts[1]

    s1 = prs.slides.add_slide(title_layout)
    s1.shapes.title.text = "Synthetic Deck"
    s1.placeholders[1].text = "A four-slide fixture for Capture import tests"
    _add_notes(s1, "Welcome to the synthetic deck. This is the cover slide.")

    s2 = prs.slides.add_slide(tbc_layout)
    _title_and_bullets(s2, "Key points", [
        "First point: the import must keep slide order.",
        "Second point: notes stay attached to their slide.",
        "Third point: no slide may go missing silently.",
    ])
    _add_notes(s2, "These are the key points for slide two. Say them slowly.")

    s3 = prs.slides.add_slide(blank)
    tx = s3.shapes.add_textbox(Inches(0.5), Inches(0.5), Inches(6), Inches(1))
    tx.text_frame.text = "Picture slide"
    pic = _png(800, 600, (30, 90, 160), "_fixture-blue.png")
    s3.shapes.add_picture(pic, Inches(0.5), Inches(1.8), Inches(6), Inches(4.5))
    _add_notes(s3, "The picture shows a blue rectangle. Nothing else is on this slide.")

    s4 = prs.slides.add_slide(blank)
    tx = s4.shapes.add_textbox(Inches(0.5), Inches(0.4), Inches(6), Inches(0.8))
    tx.text_frame.text = "Quarterly figures"
    rows, cols = 3, 3
    table_shape = s4.shapes.add_table(rows, cols, Inches(0.5), Inches(1.5),
                                       Inches(8), Inches(2.4))
    table = table_shape.table
    data = [["Quarter", "Units", "Revenue"], ["Q1", "120", "$12,000"],
            ["Q2", "150", "$15,000"]]
    for r in range(rows):
        for c in range(cols):
            table.cell(r, c).text = data[r][c]
    _add_notes(s4, "The table shows the quarterly figures for Q1 and Q2.")

    prs.save(os.path.join(OUT, "synthetic-4-slide-16x9.pptx"))


def deck_4x3():
    prs = Presentation()
    prs.slide_width = Inches(10)
    prs.slide_height = Inches(7.5)
    tbc = prs.slide_layouts[1]
    blank = prs.slide_layouts[6]

    s1 = prs.slides.add_slide(tbc)
    _title_and_bullets(s1, "Four by three", ["Aspect ratio is 4:3.",
                                             "Slides are 10 by 7.5 inches."])
    _add_notes(s1, "This deck is four by three. The renderer must letterbox, never stretch.")

    s2 = prs.slides.add_slide(blank)
    pic = _png(640, 480, (160, 40, 40), "_fixture-red.png")
    s2.shapes.add_picture(pic, Inches(1), Inches(1), Inches(6), Inches(4.5))
    tx = s2.shapes.add_textbox(Inches(1), Inches(6), Inches(6), Inches(0.6))
    tx.text_frame.text = "Red picture slide"
    _add_notes(s2, "Red picture. Used to check image extraction and aspect ratio.")

    s3 = prs.slides.add_slide(tbc)
    _title_and_bullets(s3, "No notes here", ["This slide has no speaker notes."])
    prs.save(os.path.join(OUT, "deck-4x3-notes-images.pptx"))


def deck_table_chart():
    prs = Presentation()
    prs.slide_width = Inches(13.333)
    prs.slide_height = Inches(7.5)
    blank = prs.slide_layouts[6]

    s1 = prs.slides.add_slide(blank)
    tx = s1.shapes.add_textbox(Inches(0.5), Inches(0.4), Inches(8), Inches(0.8))
    tx.text_frame.text = "Table slide"
    table_shape = s1.shapes.add_table(2, 2, Inches(0.5), Inches(1.5),
                                       Inches(6), Inches(1.2))
    table_shape.table.cell(0, 0).text = "Item"
    table_shape.table.cell(0, 1).text = "Count"
    table_shape.table.cell(1, 0).text = "Widgets"
    table_shape.table.cell(1, 1).text = "42"
    _add_notes(s1, "Table with one row of data. Widgets count is forty-two.")

    s2 = prs.slides.add_slide(blank)
    tx = s2.shapes.add_textbox(Inches(0.5), Inches(0.4), Inches(8), Inches(0.8))
    tx.text_frame.text = "Chart slide"
    chart_data = CategoryChartData()
    chart_data.categories = ["A", "B", "C"]
    chart_data.add_series("Series 1", (10, 20, 30))
    chart_shape = s2.shapes.add_chart(XL_CHART_TYPE.COLUMN_CLUSTERED, Inches(0.5),
                        Inches(1.5), Inches(8), Inches(4.5), chart_data)
    chart_shape.chart.has_title = True
    chart_shape.chart.chart_title.text_frame.text = "Sales by category"
    _add_notes(s2, "Column chart with three categories A, B, C and values ten, twenty, thirty.")

    s3 = prs.slides.add_slide(blank)
    pic = _png(400, 300, (40, 160, 60), "_fixture-green.png")
    s3.shapes.add_picture(pic, Inches(0.5), Inches(0.5), Inches(4), Inches(3))
    _add_notes(s3, "Green picture slide.")
    prs.save(os.path.join(OUT, "deck-16x9-table-chart.pptx"))


def deck_mixed():
    prs = Presentation()
    prs.slide_width = Inches(13.333)
    prs.slide_height = Inches(7.5)
    blank = prs.slide_layouts[6]
    tbc = prs.slide_layouts[1]

    s1 = prs.slides.add_slide(tbc)
    _title_and_bullets(s1, "Placeholders and fonts", [
        "Footer, date and slide number must not become narration.",
    ])
    # Hand-edit the slide XML: add footer/date/slide-number placeholder
    # shapes plus a run in a font that is not installed anywhere.
    _add_notes(s1, "Notes for the placeholders slide. The footer text below is not narration.")

    s2 = prs.slides.add_slide(blank)
    tx = s2.shapes.add_textbox(Inches(0.5), Inches(0.5), Inches(8), Inches(1))
    tf = tx.text_frame
    run = tf.paragraphs[0].add_run()
    run.text = "Text in a missing font"
    run.font.name = "ZzMissing Font 123"
    run.font.size = Pt(24)
    grp = s2.shapes.add_group_shape()
    grp.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0.5), Inches(2),
                         Inches(2), Inches(1))
    _add_notes(s2, "Group shape slide with a missing font run.")
    path = os.path.join(OUT, "deck-mixed-placeholders-fonts.pptx")
    prs.save(path)

    # Post-process slide 1: inject footer / date / slide-number placeholder
    # shapes. These are the master-boilerplate shapes the text extractor
    # must skip (brief §2.2) — python-pptx cannot create them directly.
    def _ph_shape(shape_id, name, ph_type, text):
        return (
            f'<p:sp><p:nvSpPr><p:cNvPr id="{shape_id}" name="{name}"/>'
            f"<p:cNvSpPr/><p:nvPr>"
            f'<p:ph type="{ph_type}" sz="quarter" idx="{shape_id}"/>'
            f"</p:nvPr></p:nvSpPr>"
            f"<p:spPr><a:xfrm><a:off x=\"0\" y=\"0\"/>"
            f"<a:ext cx=\"1000000\" cy=\"200000\"/></a:xfrm></p:spPr>"
            f"<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>{text}</a:t>"
            f"</a:r></a:p></p:txBody></p:sp>"
        )

    def mutate(zin, zout):
        xml = zin.read("ppt/slides/slide1.xml").decode("utf-8")
        inject = "".join([
            _ph_shape(100, "Footer Placeholder", "ftr", "Confidential — do not distribute"),
            _ph_shape(101, "Date Placeholder", "dt", "November 15, 2026"),
            _ph_shape(102, "Slide Number Placeholder", "sldNum", "7"),
        ])
        xml = xml.replace("</p:spTree>", inject + "</p:spTree>")
        zout.writestr("ppt/slides/slide1.xml", xml)

    tmp = path + ".tmp"
    _rewrite_zip(path, tmp, mutate, skip=("ppt/slides/slide1.xml",))
    os.replace(tmp, path)


def deck_101_slides():
    prs = Presentation()
    prs.slide_width = Inches(13.333)
    prs.slide_height = Inches(7.5)
    tbc = prs.slide_layouts[1]
    for i in range(101):
        s = prs.slides.add_slide(tbc)
        s.shapes.title.text = f"Slide {i + 1}"
    prs.save(os.path.join(OUT, "deck-101-slides.pptx"))


def deck_oversized_image():
    prs = Presentation()
    prs.slide_width = Inches(13.333)
    prs.slide_height = Inches(7.5)
    blank = prs.slide_layouts[6]
    pic = _png(8000, 6000, (200, 200, 200), "_fixture-huge.png")
    s = prs.slides.add_slide(blank)
    s.shapes.add_picture(pic, Inches(0.5), Inches(0.5), Inches(6), Inches(4.5))
    prs.save(os.path.join(OUT, "deck-oversized-image.pptx"))


def _rewrite_zip(src, dst, mutate, skip=()):
    """Copy a ZIP, skipping `skip` names, letting mutate(zip_in, zip_out)
    add/replace entries."""
    with zipfile.ZipFile(src) as zin, zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            if item.filename in skip:
                continue
            zout.writestr(item, zin.read(item.filename))
        mutate(zin, zout)


def deck_external_rels_macro_ole():
    src = os.path.join(OUT, "synthetic-4-slide-16x9.pptx")
    dst = os.path.join(OUT, "deck-external-rels-macro-ole.pptx")

    def mutate(zin, zout):
        # External hyperlink relationship on slide 1 (must never be fetched).
        rels_name = "ppt/slides/_rels/slide1.xml.rels"
        rels = zin.read(rels_name).decode("utf-8")
        rels = rels.replace(
            "</Relationships>",
            '<Relationship Id="rIdExternal1" '
            'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" '
            'Target="https://example.invalid/evil" TargetMode="External"/>'
            "</Relationships>")
        zout.writestr(rels_name, rels)
        # Fake macro part + content-type override (must never execute).
        zout.writestr("ppt/vbaProject.bin", b"\x00\x01\x02FAKE-MACRO-BYTES")
        ct = zin.read("[Content_Types].xml").decode("utf-8")
        ct = ct.replace(
            "</Types>",
            '<Override PartName="/ppt/vbaProject.bin" '
            'ContentType="application/vnd.ms-office.vbaProject"/>'
            "</Types>")
        zout.writestr("[Content_Types].xml", ct)
        # Fake embedded OLE object part.
        zout.writestr("ppt/embeddings/oleObject1.bin", b"\xd0\xcf\x11\xe0FAKE-OLE")
    _rewrite_zip(src, dst, mutate,
                 skip=("ppt/slides/_rels/slide1.xml.rels", "[Content_Types].xml"))


def bad_files():
    out = lambda n: os.path.join(OUT, n)
    with open(out("bad-not-a-zip.pptx"), "wb") as f:
        f.write(b"This is not a ZIP file at all, just plain text.\n" * 10)
    with open(out("bad-legacy.ppt"), "wb") as f:
        f.write(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\x00" * 512)
    # Traversal entry: a ZIP whose central directory names ../evil.txt.
    with zipfile.ZipFile(out("bad-traversal.pptx"), "w") as z:
        z.writestr("[Content_Types].xml",
                   '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>')
        z.writestr("../evil.txt", "escape attempt")
    # ZIP bomb by declaration: one entry claims 600 MB uncompressed.
    # Written as a stored entry with a lying central-directory size would be
    # dishonest; instead write real compressible data and a header that
    # declares the true 600 MB size — the reader must refuse from the
    # central directory without expanding it. To keep the fixture small,
    # build the entry with a raw DEFLATE stream of zeros produced by
    # zlib at level 9, then patch the central directory sizes by hand.
    import zlib
    # Stream the zeros through the compressor in 1 MB chunks so the
    # generator itself never holds 600 MB at once.
    raw = zlib.compressobj(9, zlib.DEFLATED, -15)
    comp_parts = []
    crc = 0
    chunk = b"\x00" * (1024 * 1024)
    remaining = 600 * 1024 * 1024
    while remaining > 0:
        take = chunk if remaining >= len(chunk) else b"\x00" * remaining
        comp_parts.append(raw.compress(take))
        crc = zlib.crc32(take, crc)
        remaining -= len(take)
    comp = b"".join(comp_parts) + raw.flush()
    crc &= 0xFFFFFFFF
    usize = 600 * 1024 * 1024
    name = b"ppt/media/huge.bin"
    local = struct.pack("<IHHHHHIIIHH", 0x04034B50, 20, 0, 8, 0, 0, crc,
                        len(comp), usize, len(name), 0) + name + comp
    central = struct.pack("<IHHHHHHIIIHHHHHII", 0x02014B50, 20, 20, 0, 8, 0, 0,
                          crc, len(comp), usize, len(name), 0, 0, 0, 0, 0, 0) + name
    eocd = struct.pack("<IHHHHIIH", 0x06054B50, 0, 0, 1, 1, len(central),
                       len(local), 0)
    with open(out("bad-zip-bomb.pptx"), "wb") as f:
        f.write(local + central + eocd)
    # Malformed: valid ZIP, but no presentation part at all.
    with zipfile.ZipFile(out("bad-malformed.pptx"), "w") as z:
        z.writestr("[Content_Types].xml",
                   '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>')
        z.writestr("ppt/presentation.xml",
                   '<?xml version="1.0"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldIdLst/></p:presentation>')


def main():
    synthetic_4_slide()
    deck_4x3()
    deck_table_chart()
    deck_mixed()
    deck_101_slides()
    deck_oversized_image()
    deck_external_rels_macro_ole()
    bad_files()
    for tmp in ("_fixture-blue.png", "_fixture-red.png",
                "_fixture-green.png", "_fixture-huge.png"):
        p = os.path.join(OUT, tmp)
        if os.path.exists(p):
            os.remove(p)
    print("fixtures written to", OUT)
    for name in sorted(os.listdir(OUT)):
        if name.endswith((".pptx", ".ppt")):
            print(f"  {name}: {os.path.getsize(os.path.join(OUT, name))} bytes")


if __name__ == "__main__":
    main()
