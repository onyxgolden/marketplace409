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
//   { kind: "text", x, y, text, size, role }   (letter codes: REF, DW, W, ...)
//
// Pure and framework-free.

const rect = (x, y, w, h, role, rx = 0) => ({ kind: "rect", x, y, w, h, rx, role });
const line = (x1, y1, x2, y2, role) => ({ kind: "line", x1, y1, x2, y2, role });
const poly = (points, role, closed = true) => ({ kind: "poly", points, closed, role });
const circle = (cx, cy, r, role) => ({ kind: "circle", cx, cy, r, role });
const ellipse = (cx, cy, rx, ry, role) => ({ kind: "ellipse", cx, cy, rx, ry, role });
const text = (x, y, value, size) => ({ kind: "text", x, y, text: value, size, role: "text" });
const labelSize = (w, d) => Math.max(3, Math.min(8, Math.min(w, d) * 0.3));

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


// ---- Phase 2: the rest of the residential library ----

function seating(w, d, seats, { footrest = false } = {}) {
  const bodyD = footrest ? d * 0.78 : d;
  const top = -d / 2;
  const backD = Math.min(8, bodyD * 0.22);
  const armW = Math.min(7, w * 0.14);
  const out = [
    rect(-w / 2, top, w, bodyD, "frame", 2),
    rect(-w / 2, top, w, backD, "back", 1.5),
    rect(-w / 2, top + backD, armW, bodyD - backD, "arm", 1.5),
    rect(w / 2 - armW, top + backD, armW, bodyD - backD, "arm", 1.5),
  ];
  const seatW = (w - 2 * armW - (seats + 1)) / seats;
  for (let i = 0; i < seats; i += 1) {
    out.push(rect(-w / 2 + armW + 1 + i * (seatW + 1), top + backD + 1, seatW, bodyD - backD - 2, "cushion", 2));
  }
  if (footrest) out.push(rect(-w / 2 + armW, top + bodyD + 1, w - 2 * armW, d - bodyD - 1, "footrest", 1.5));
  return out;
}

function roundSideTable(w, d) {
  const r = Math.min(w, d) / 2;
  return [circle(0, 0, r, "top"), circle(0, 0, r - Math.min(1.2, r * 0.08), "top-edge")];
}

function desk(w, d) {
  const pw = Math.min(16, w * 0.33);
  return [
    rect(-w / 2, -d / 2, w, d, "top", 1),
    rect(w / 2 - pw, -d / 2 + 1, pw - 1, d - 2, "drawer", 0.5),
    line(w / 2 - pw, -d / 6, w / 2 - 1, -d / 6, "top-edge"),
    line(w / 2 - pw, d / 6, w / 2 - 1, d / 6, "top-edge"),
  ];
}

function island(w, d) {
  const over = Math.min(12, d * 0.3);
  return [
    rect(-w / 2, -d / 2, w, d, "counter", 1),
    line(-w / 2, d / 2 - over, w / 2, d / 2 - over, "overhang"), // seating overhang
    line(-w / 2, -d / 2 + 1.5, w / 2, -d / 2 + 1.5, "door-face"),
  ];
}

function nightstand(w, d) {
  return [
    rect(-w / 2, -d / 2, w, d, "top", 1),
    line(-w / 2 + 1, d / 2 - 2, w / 2 - 1, d / 2 - 2, "door-face"),
    circle(0, d / 2 - 3.5, Math.min(0.8, w * 0.04), "knob"),
  ];
}

function dresser(w, d) {
  const out = [rect(-w / 2, -d / 2, w, d, "top", 1), line(-w / 2 + 1, d / 2 - 2, w / 2 - 1, d / 2 - 2, "door-face")];
  for (const f of [-0.25, 0.25]) out.push(circle(w * f, d / 2 - 3.5, Math.min(0.8, d * 0.05), "knob"));
  out.push(line(0, d / 2 - 2, 0, -d / 2 + 1, "grain")); // two drawer columns
  return out;
}

function appliance(w, d, code, extra = []) {
  return [
    rect(-w / 2, -d / 2, w, d, "appliance", 1),
    line(-w / 2 + 1, d / 2 - 2, w / 2 - 1, d / 2 - 2, "door-face"),
    ...extra,
    text(0, 0, code, labelSize(w, d)),
  ];
}

function refrigerator(w, d) {
  return appliance(w, d, "REF", [line(0, d / 2 - 2, 0, d / 2 - Math.min(8, d * 0.3), "door-face")]);
}

function range(w, d) {
  const out = [rect(-w / 2, -d / 2, w, d, "appliance", 1), rect(-w / 2 + 1, -d / 2 + 1, w - 2, Math.min(3, d * 0.12), "controls")];
  const r = Math.min(w, d) * 0.15;
  const top = -d / 2 + Math.min(3, d * 0.12) + 1;
  const rows = [top + (d - (top + d / 2)) * 0.28, top + (d - (top + d / 2)) * 0.72];
  for (const y of rows) for (const x of [-w / 4, w / 4]) out.push(circle(x, y, r, "burner"));
  return out;
}

function microwaveCart(w, d) {
  return [
    rect(-w / 2, -d / 2, w, d, "top", 1),
    rect(-w / 2 + 3, -d / 2 + 2, w * 0.6, d - 5, "appliance", 0.5),
    text(-w / 2 + 3 + w * 0.3, -0.5, "MW", labelSize(w * 0.6, d - 5)),
  ];
}

function vanity(w, d, basins) {
  const out = [rect(-w / 2, -d / 2, w, d, "counter", 1)];
  const slot = w / basins;
  for (let i = 0; i < basins; i += 1) {
    const cx = -w / 2 + slot * (i + 0.5);
    const rx = Math.min(slot * 0.32, 8);
    out.push(ellipse(cx, 1, rx, Math.min(d * 0.3, 6), "basin"));
    out.push(circle(cx, 1, Math.min(0.8, rx * 0.12), "drain"));
    out.push(rect(cx - 1, -d / 2 + 1, 2, 3, "faucet"));
  }
  return out;
}

function shower(w, d) {
  const inset = Math.min(2, Math.min(w, d) * 0.06);
  const dx = 0;
  const dy = 0;
  const x0 = -w / 2 + inset;
  const y0 = -d / 2 + inset;
  const x1 = w / 2 - inset;
  const y1 = d / 2 - inset;
  return [
    rect(-w / 2, -d / 2, w, d, "shell", 1),
    rect(x0, y0, x1 - x0, y1 - y0, "pan", 0.5),
    line(x0, y0, dx, dy, "slope"),
    line(x1, y0, dx, dy, "slope"),
    line(x0, y1, dx, dy, "slope"),
    line(x1, y1, dx, dy, "slope"),
    circle(dx, dy, Math.min(1.5, w * 0.04), "drain"),
    line(-w / 2, d / 2, w / 2, d / 2, "door"), // glass door / curtain side
  ];
}

function washer(w, d) {
  return [
    rect(-w / 2, -d / 2, w, d, "appliance", 1),
    rect(-w / 2 + 1, -d / 2 + 1, w - 2, Math.min(3, d * 0.12), "controls"),
    circle(0, 2, Math.min(w, d) * 0.32, "drum"),
    text(0, 2, "W", labelSize(w, d)),
  ];
}

function dryer(w, d) {
  return [
    rect(-w / 2, -d / 2, w, d, "appliance", 1),
    rect(-w / 2 + 1, -d / 2 + 1, w - 2, Math.min(3, d * 0.12), "controls"),
    text(0, 2, "D", labelSize(w, d)),
  ];
}

function waterHeater(w, d) {
  const r = Math.min(w, d) / 2;
  return [circle(0, 0, r, "shell"), circle(0, 0, r * 0.8, "top-edge"), text(0, 0, "WH", labelSize(w, d) * 0.9)];
}

function utilitySink(w, d) {
  const inset = Math.min(2.5, Math.min(w, d) * 0.12);
  return [
    rect(-w / 2, -d / 2, w, d, "shell", 1),
    rect(-w / 2 + inset, -d / 2 + inset + 2, w - 2 * inset, d - 2 * inset - 2, "basin", 2),
    circle(0, 2, Math.min(1, w * 0.05), "drain"),
    rect(-1, -d / 2 + 0.5, 2, inset + 1, "faucet"),
  ];
}

function bookshelf(w, d) {
  const out = [rect(-w / 2, -d / 2, w, d, "frame", 0.5), line(-w / 2, -d / 2 + 1, w / 2, -d / 2 + 1, "back")];
  const bays = Math.max(1, Math.round(w / 12));
  for (let i = 1; i < bays; i += 1) out.push(line(-w / 2 + (w * i) / bays, -d / 2, -w / 2 + (w * i) / bays, d / 2, "shelf"));
  return out;
}

function tvStand(w, d) {
  return [
    rect(-w / 2, -d / 2, w, d, "top", 1),
    rect(-w * 0.4, -d / 2 + 1.5, w * 0.8, Math.min(2, d * 0.15), "screen"),
    line(-w / 2 + 1, d / 2 - 2, w / 2 - 1, d / 2 - 2, "door-face"),
  ];
}

function arcPoints(cx, cy, r, a0, a1, n = 8) {
  const pts = [];
  for (let i = 0; i <= n; i += 1) {
    const a = a0 + ((a1 - a0) * i) / n;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
}

function wardrobe(w, d) {
  const door = Math.min(w / 2, d); // swing radius kept inside the footprint
  return [
    rect(-w / 2, -d / 2, w, d, "frame", 0.5),
    line(-w / 2, 0, w / 2, 0, "rod"), // hanging rod
    line(0, d / 2 - 1, 0, d / 2, "door"),
    poly(arcPoints(-w / 2, d / 2, door, -Math.PI / 2, 0).map(([x, y]) => [x, Math.min(y, d / 2)]), "swing", false),
    poly(arcPoints(w / 2, d / 2, door, Math.PI, 1.5 * Math.PI).map(([x, y]) => [x, Math.min(y, d / 2)]), "swing", false),
  ];
}

function storageChest(w, d) {
  return [
    rect(-w / 2, -d / 2, w, d, "top", 1),
    rect(-w / 2 + 1.5, -d / 2 + 1.5, w - 3, d - 3, "top-edge", 0.5),
    line(-w / 2 + 2, -d / 2 + 1, w / 2 - 2, -d / 2 + 1, "hinge"),
  ];
}

function lamp(w, d) {
  const r = Math.min(w, d) / 2;
  const k = r * 0.7071;
  return [
    circle(0, 0, r, "shade"),
    line(-k, -k, k, k, "lamp-x"),
    line(-k, k, k, -k, "lamp-x"),
  ];
}

// ---- cabinets (plan conventions) ----
const FACE = 1.5; // door-face line inset from the front

function baseCabinet(w, d, extra = []) {
  return [
    rect(-w / 2, -d / 2, w, d, "cabinet", 0.5),
    line(-w / 2, d / 2 - FACE, w / 2, d / 2 - FACE, "door-face"),
    ...extra,
  ];
}

const drawerBase = (w, d) => baseCabinet(w, d, [
  line(-w / 2 + 1, d / 2 - FACE - 3, w / 2 - 1, d / 2 - FACE - 3, "drawer-line"),
]);

const trashBase = (w, d) => baseCabinet(w, d, [rect(-w * 0.3, -d * 0.3, w * 0.6, d * 0.5, "bin", 1)]);

const sinkBase = (w, d, { apron = false } = {}) => baseCabinet(w, d, [
  rect(-w * 0.35, apron ? -d / 2 + 3 : -d / 2 + 4, w * 0.7, apron ? d - 3 : d - 9, "basin", 1.5),
  circle(0, apron ? 1.5 : 0, Math.min(1, w * 0.03), "drain"),
]);

function lShape(w, d, arm) {
  // Corner base: two 24"-deep arms meeting at the back-left corner.
  return [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, -d / 2 + arm], [-w / 2 + arm, -d / 2 + arm], [-w / 2 + arm, d / 2], [-w / 2, d / 2]];
}

function cornerBase(w, d) {
  const arm = Math.min(24, Math.min(w, d) * 0.66);
  return [
    poly(lShape(w, d, arm), "cabinet"),
    circle(-w / 2 + arm * 0.6, -d / 2 + arm * 0.6, arm * 0.45, "susan"),
    line(-w / 2 + arm, -d / 2 + arm, -w / 2 + arm, d / 2, "door-face"),
  ];
}

function easyReachBase(w, d) {
  const arm = Math.min(24, Math.min(w, d) * 0.66);
  return [
    poly(lShape(w, d, arm), "cabinet"),
    line(w / 2, -d / 2 + arm, -w / 2 + arm, d / 2, "door-face"), // angled easy-reach door
  ];
}

function blindBase(w, d, side) {
  const blind = Math.min(12, w * 0.33);
  const x0 = side < 0 ? -w / 2 : w / 2 - blind;
  const out = baseCabinet(w, d);
  for (let i = 0; i <= 3; i += 1) {
    const x = x0 + (blind * i) / 3;
    out.push(line(x, -d / 2, Math.min(x0 + blind, x + blind / 2), d / 2 - FACE, "blind"));
  }
  return out;
}

function wallCabinet(w, d, extra = []) {
  // Wall cabinets hang above the counter: dashed outline and door face.
  return [
    rect(-w / 2, -d / 2, w, d, "wall-cabinet", 0.5),
    line(-w / 2, d / 2 - FACE, w / 2, d / 2 - FACE, "wall-face"),
    ...extra,
  ];
}

function wallCornerCabinet(w, d) {
  const arm = Math.min(12, Math.min(w, d) * 0.5);
  return [poly(lShape(w, d, arm), "wall-cabinet"), line(-w / 2 + arm, -d / 2 + arm, w / 2, -d / 2 + arm, "door-face")];
}

function tallCabinet(w, d, code) {
  const out = [
    rect(-w / 2, -d / 2, w, d, "cabinet", 0.5),
    line(-w / 2, -d / 2, w / 2, d / 2, "tall-x"),
    line(-w / 2, d / 2, w / 2, -d / 2, "tall-x"),
  ];
  if (code) out.push(text(0, 0, code, labelSize(w, d)));
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
  // Phase 2
  "sofa-3seat": (w, d) => seating(w, d, 3),
  loveseat: (w, d) => seating(w, d, 2),
  armchair: (w, d) => seating(w, d, 1),
  recliner: (w, d) => seating(w, d, 1, { footrest: true }),
  "coffee-table": rectTable,
  "side-table": roundSideTable,
  desk,
  "kitchen-island": island,
  nightstand,
  dresser,
  refrigerator,
  range,
  dishwasher: (w, d) => appliance(w, d, "DW"),
  "microwave-cart": microwaveCart,
  "vanity-single": (w, d) => vanity(w, d, 1),
  "vanity-double": (w, d) => vanity(w, d, 2),
  shower,
  "shower-48x36": shower,
  washer,
  dryer,
  "water-heater": waterHeater,
  "utility-sink": utilitySink,
  bookshelf,
  "tv-stand": tvStand,
  wardrobe,
  "storage-chest": storageChest,
  "floor-lamp": lamp,
  "table-lamp": lamp,
  // cabinets
  "cabinet-base-24": (w, d) => baseCabinet(w, d),
  "cabinet-base-db": drawerBase,
  "cabinet-base-drawer": drawerBase,
  "cabinet-sink-36": (w, d) => sinkBase(w, d),
  "cabinet-sink-farm": (w, d) => sinkBase(w, d, { apron: true }),
  "cabinet-base-trash": trashBase,
  "cabinet-base-corner": cornerBase,
  "cabinet-base-blind": (w, d) => blindBase(w, d, -1),
  "cabinet-base-blind-rh": (w, d) => blindBase(w, d, 1),
  "cabinet-base-easy-reach": easyReachBase,
  "cabinet-island-base": (w, d) => baseCabinet(w, d, [line(-w / 2, -d / 2 + FACE, w / 2, -d / 2 + FACE, "door-face")]),
  "cabinet-wall-24": (w, d) => wallCabinet(w, d),
  "cabinet-wall-corner": wallCornerCabinet,
  "cabinet-wall-bridge": (w, d) => wallCabinet(w, d),
  "cabinet-wall-microwave": (w, d) => wallCabinet(w, d, [text(0, 0, "MW", labelSize(w, d))]),
  "cabinet-open-shelf": (w, d) => wallCabinet(w, d, [line(-w / 2, 0, w / 2, 0, "shelf")]),
  "cabinet-pantry-24": (w, d) => tallCabinet(w, d),
  "cabinet-tall-oven": (w, d) => tallCabinet(w, d, "OV"),
  "cabinet-tall-utility": (w, d) => tallCabinet(w, d, "U"),
  "cabinet-vanity-sink": (w, d) => sinkBase(w, d),
  "cabinet-vanity-drawer": drawerBase,
  "cabinet-linen-tower": (w, d) => tallCabinet(w, d, "L"),
  "cabinet-bath-wall": (w, d) => wallCabinet(w, d),
});

/** Catalog ids that have a recognizable plan symbol. */
export const PLAN_SYMBOL_CATALOG_IDS = Object.freeze(Object.keys(SYMBOLS));

/** Plan-symbol primitives for a piece at widthIn x depthIn, or null. */
export function furniturePlanSymbol(catalogId, widthIn, depthIn) {
  const build = SYMBOLS[catalogId];
  if (!build || !(widthIn > 0) || !(depthIn > 0)) return null;
  return build(widthIn, depthIn);
}
