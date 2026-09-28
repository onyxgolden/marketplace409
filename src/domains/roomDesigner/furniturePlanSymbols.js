// Recognizable top-down plan symbols for furniture and fixtures.
//
// Original FORGE line work in the style of architectural plan blocks: a bed
// shows its headboard, pillows and turned-down sheet; a toilet its tank,
// oval bowl and seat; a tub its basin and drain; an office chair its
// five-star base. Nothing is copied from third-party stencils.
//
// furniturePlanSymbol(catalogId, widthIn, depthIn) returns plain primitives
// in the piece's local frame (plan inches, origin at the piece centre, y
// grows toward the FRONT; the back — headboard, tank, chair back — is at
// -depthIn/2, matching the 3D compositions). The canvas, thumbnails and
// print render them; ids without a symbol return null and keep the
// existing rectangle drawing.
//
//   { kind: "rect", x, y, w, h, rx?, role }
//   { kind: "line", x1, y1, x2, y2, role }
//   { kind: "poly", points: [[x, y], ...], closed, role }
//   { kind: "circle", cx, cy, r, role }
//   { kind: "ellipse", cx, cy, rx, ry, role }
//
// Pure and framework-free.

const rect = (x, y, w, h, role, rx = 0) => ({ kind: "rect", x, y, w, h, rx, role });
const line = (x1, y1, x2, y2, role) => ({ kind: "line", x1, y1, x2, y2, role });
const poly = (points, role, closed = true) => ({ kind: "poly", points, closed, role });
const circle = (cx, cy, r, role) => ({ kind: "circle", cx, cy, r, role });
const ellipse = (cx, cy, rx, ry, role) => ({ kind: "ellipse", cx, cy, rx, ry, role });

function bed(w, d, pillows) {
  const top = -d / 2;
  const headT = Math.min(4, d * 0.06);
  const pillowD = Math.min(12, d * 0.16);
  const gap = 3;
  const out = [
    rect(-w / 2, top, w, d, "frame", 1.5),
    rect(-w / 2, top, w, headT, "headboard"),
  ];
  const pw = (w - gap * (pillows + 1)) / pillows;
  for (let i = 0; i < pillows; i += 1) {
    out.push(rect(-w / 2 + gap + i * (pw + gap), top + headT + 2, pw, pillowD, "pillow", Math.min(4, pillowD / 2)));
  }
  // Turned-down sheet: its top edge below the pillows, with the folded
  // corner triangle at the foot-side right.
  const sheetTop = top + headT + pillowD + 5;
  const fold = Math.min(w, d) * 0.28;
  out.push(poly([[-w / 2, sheetTop], [w / 2, sheetTop], [w / 2, d / 2], [-w / 2, d / 2]], "sheet"));
  out.push(line(-w / 2, sheetTop + 3, w / 2, sheetTop + 3, "sheet")); // folded-over hem
  out.push(poly([[w / 2 - fold, d / 2], [w / 2, d / 2 - fold], [w / 2, d / 2]], "sheet-fold"));
  return out;
}

function toilet(w, d) {
  const tankW = Math.min(20, w - 2);
  const tankD = Math.min(8, d * 0.33);
  const top = -d / 2;
  const bowlRy = (d - tankD) / 2;
  const bowlRx = Math.min(tankW * 0.42, bowlRy * 0.9);
  const bowlCy = top + tankD + bowlRy;
  return [
    rect(-tankW / 2, top, tankW, tankD, "tank", 1),
    ellipse(0, bowlCy, bowlRx, bowlRy, "bowl"),
    ellipse(0, bowlCy + bowlRy * 0.08, bowlRx * 0.72, bowlRy * 0.78, "seat"),
    line(-tankW / 2 + 2, top + 2, -tankW / 2 + 5, top + 2, "handle"),
  ];
}

function bathtub(w, d) {
  const inset = Math.min(3, d * 0.1);
  const iw = w - inset * 2;
  const idp = d - inset * 2;
  return [
    rect(-w / 2, -d / 2, w, d, "shell", 2),
    rect(-w / 2 + inset, -d / 2 + inset, iw, idp, "basin", Math.min(idp / 2, 10)),
    circle(-w / 2 + inset + Math.min(6, iw * 0.12), 0, Math.min(1.2, idp * 0.06), "drain"),
    rect(-w / 2, -2, inset, 4, "faucet"), // spout on the drain end wall
  ];
}

function pedestalSink(w, d) {
  const top = -d / 2;
  const deckD = Math.min(5, d * 0.25);
  const rx = w / 2;
  const ry = d - deckD;
  // Straight back edge, rounded front: a half-ellipse below the deck.
  const pts = [[-w / 2, top], [w / 2, top], [w / 2, top + deckD]];
  for (let i = 0; i <= 16; i += 1) {
    const a = (Math.PI * i) / 16;
    pts.push([rx * Math.cos(a), top + deckD + ry * Math.sin(a)]);
  }
  pts.push([-w / 2, top + deckD]);
  const bowlCy = top + deckD + ry * 0.42;
  return [
    poly(pts, "shell"),
    ellipse(0, bowlCy, rx * 0.68, ry * 0.46, "basin"),
    circle(0, bowlCy, Math.min(0.9, w * 0.05), "drain"),
    rect(-1, top + 0.5, 2, deckD - 1, "faucet"),
  ];
}

function roundBathSink(w, d) {
  const r = Math.min(w, d) / 2;
  return [
    circle(0, 0, r, "shell"),
    circle(0, r * 0.08, r * 0.72, "basin"),
    circle(0, r * 0.08, Math.min(0.9, r * 0.1), "drain"),
    rect(-0.8, -r + 0.3, 1.6, r * 0.28, "faucet"),
  ];
}

function kitchenSink(w, d) {
  const inset = Math.min(2, d * 0.1);
  const deck = Math.min(4, d * 0.2); // faucet deck at the back
  const bowlW = (w - inset * 3) / 2;
  const bowlD = d - inset - deck;
  const out = [rect(-w / 2, -d / 2, w, d, "shell", 1.5)];
  for (const side of [-1, 1]) {
    const x = side < 0 ? -w / 2 + inset : inset / 2;
    out.push(rect(x, -d / 2 + deck, bowlW, bowlD, "basin", 2));
    out.push(circle(x + bowlW / 2, -d / 2 + deck + bowlD / 2, Math.min(1, bowlW * 0.07), "drain"));
  }
  out.push(rect(-1, -d / 2 + 0.5, 2, deck - 1, "faucet"));
  return out;
}

function rectTable(w, d) {
  const e = Math.min(1.5, Math.min(w, d) * 0.05);
  return [
    rect(-w / 2, -d / 2, w, d, "top", 1),
    rect(-w / 2 + e, -d / 2 + e, w - 2 * e, d - 2 * e, "top-edge", 0.5),
    line(-w / 2 + e, 0, w / 2 - e, 0, "grain"),
  ];
}

function roundTable(w, d) {
  const r = Math.min(w, d) / 2;
  return [
    circle(0, 0, r, "top"),
    circle(0, 0, r - Math.min(1.5, r * 0.06), "top-edge"),
    circle(0, 0, r * 0.22, "pedestal"), // pedestal base seen through a glass-free top: dashed in render
  ];
}

function diningChair(w, d) {
  const backD = Math.min(3, d * 0.18);
  return [
    rect(-w / 2, -d / 2 + backD, w, d - backD, "seat", 1.5),
    rect(-w / 2, -d / 2, w, backD, "back", 1),
    line(-w / 2 + 2, -d / 2 + backD + 2, w / 2 - 2, -d / 2 + backD + 2, "seat-edge"),
  ];
}

function officeChair(w, d) {
  const r = Math.min(w, d) / 2;
  const out = [];
  for (let i = 0; i < 5; i += 1) {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / 5;
    const x = Math.cos(a) * (r - 1.2);
    const y = Math.sin(a) * (r - 1.2);
    out.push(line(0, 0, x, y, "spoke"));
    out.push(circle(x, y, 1.2, "caster"));
  }
  const seatR = r * 0.72;
  out.push(circle(0, r * 0.06, seatR, "seat"));
  // Curved back behind the seat.
  const back = [];
  for (let i = 0; i <= 10; i += 1) {
    const a = Math.PI + (Math.PI * i) / 10;
    back.push([Math.cos(a) * seatR * 0.95, r * 0.06 + Math.sin(a) * seatR * 0.95]);
  }
  for (let i = 10; i >= 0; i -= 1) {
    const a = Math.PI + (Math.PI * i) / 10;
    back.push([Math.cos(a) * seatR * 0.7, r * 0.06 + Math.sin(a) * seatR * 0.7]);
  }
  out.push(poly(back, "back"));
  return out;
}

const SYMBOLS = Object.freeze({
  "bed-twin": (w, d) => bed(w, d, 1),
  "bed-full": (w, d) => bed(w, d, 2),
  "bed-queen": (w, d) => bed(w, d, 2),
  "bed-king": (w, d) => bed(w, d, 2),
  toilet,
  bathtub,
  "sink-pedestal": pedestalSink,
  "sink-bath-round": roundBathSink,
  "sink-kitchen-33": kitchenSink,
  "dining-table-rect": rectTable,
  "dining-table-round": roundTable,
  "dining-chair": diningChair,
  "office-chair": officeChair,
});

/** Catalog ids that have a recognizable plan symbol. */
export const PLAN_SYMBOL_CATALOG_IDS = Object.freeze(Object.keys(SYMBOLS));

/** Plan-symbol primitives for a piece at widthIn x depthIn, or null. */
export function furniturePlanSymbol(catalogId, widthIn, depthIn) {
  const build = SYMBOLS[catalogId];
  if (!build || !(widthIn > 0) || !(depthIn > 0)) return null;
  return build(widthIn, depthIn);
}
