// Pure 3D furniture composition for the FORGE room/layout designer.
//
// furnitureParts(catalogId, dims) answers ONE question: "given this object,
// what simple visual primitives compose it?" It returns plain JSON part
// descriptors — no THREE, no DOM, no WebGL — so it stays unit-testable and
// the domain layer stays serializable (per arch review: it must NOT become a
// second catalog; the furniture catalog remains authoritative for identity,
// dimensions, materials metadata, etc.).
//
// Part descriptor:
//   { shape: "box"|"cyl", dx, dy, dz, w, h, d, color?, glow?, rotX? }
//   dx,dz: center offset from the piece center, in inches (plan space)
//   dy:    center height above the floor, in inches
//   w,d:   footprint in inches (diameter for "cyl"); h: height in inches
//   color: optional per-part color override (defaults to the piece color)
//   glow:  part is a light source shade (warm emissive in the renderer)
//   rotX:  optional extra X rotation in radians (e.g. front-facing discs)
//
// Unknown catalog ids fall back to a single box so nothing ever fails to
// render. Compositions are camera-agnostic (no baked view assumptions) so a
// future walkthrough mode can reuse them unchanged.

/** Multiply a #rrggbb color by a factor (0..1 darkens, >1 lightens). Pure. */
export function shade(hex, factor) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const mix = (c) => Math.max(0, Math.min(255, Math.round(c * factor)));
  const r = mix((n >> 16) & 255);
  const g = mix((n >> 8) & 255);
  const b = mix(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

const box = (dx, dy, dz, w, h, d, extra) => ({ shape: "box", dx, dy, dz, w, h, d, ...(extra || {}) });
const cyl = (dx, dy, dz, w, h, d, extra) => ({ shape: "cyl", dx, dy, dz, w, h, d, ...(extra || {}) });

// ---- builders (w,d,h = nominal piece dims, c = piece color) ----

function upholsteredSeat(w, d, h, c) {
  const armW = w > 48 ? 7 : 5;
  const seatTop = 19;
  return [
    box(0, 7, 0, w, 14, d), // base
    box(0, seatTop - 3, 2, w - armW * 2, 6, d - 10, { color: shade(c, 1.06) }), // cushion
    box(0, 14 + (h - 14) / 2, -(d / 2 - 4), w, h - 14, 8), // back
    box(-(w / 2 - armW / 2), (h - 8) / 2, 0, armW, h - 8, d, { color: shade(c, 0.94) }), // arms
    box(w / 2 - armW / 2, (h - 8) / 2, 0, armW, h - 8, d, { color: shade(c, 0.94) }),
  ];
}

function bed(w, d, h, c) {
  const mattressTop = 20;
  return [
    box(0, 5, 0, w, 10, d, { color: shade(c, 0.55) }), // frame
    box(0, 21, -(d / 2 - 2), w, 42, 4, { color: shade(c, 0.55) }), // headboard
    box(0, 15, 2, w - 4, 10, d - 8, { color: "#f2f4f7" }), // mattress
    box(-(w / 4 - 1), mattressTop + 2.5, -(d / 2 - 10), w / 2 - 6, 5, 14, { color: "#ffffff" }), // pillows
    box(w / 4 - 1, mattressTop + 2.5, -(d / 2 - 10), w / 2 - 6, 5, 14, { color: "#ffffff" }),
  ];
}

function tableWithLegs(w, d, h, c, leg = 3) {
  const topT = 2.5;
  const parts = [box(0, h - topT / 2, 0, w, topT, d, { color: shade(c, 1.05) })];
  const lx = w / 2 - leg;
  const lz = d / 2 - leg;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      parts.push(box(sx * lx, (h - topT) / 2, sz * lz, leg, h - topT, leg, { color: shade(c, 0.9) }));
    }
  }
  return parts;
}

function kitchenBox(w, d, h, c, { counter = false, door = false } = {}) {
  const bodyH = counter ? h - 2 : h;
  const parts = [box(0, bodyH / 2, 0, w - 1, bodyH, d - 1)];
  if (counter) parts.push(box(0, h - 1, 0, w, 2, d, { color: "#e9e7e1" }));
  if (door) parts.push(box(0, bodyH / 2, (d - 1) / 2 + 0.25, w - 3, bodyH - 8, 0.5, { color: shade(c, 1.08) }));
  return parts;
}

const COMPOSERS = {
  // seating
  "sofa-3seat": upholsteredSeat,
  loveseat: upholsteredSeat,
  armchair: upholsteredSeat,
  recliner: upholsteredSeat,
  "office-chair": (w, d, h, c) => [
    cyl(0, 19, 0, 24, 3, 24),
    box(0, 32, -11, 22, 20, 4, { color: shade(c, 0.9) }),
    cyl(0, 9, 0, 2, 16, 2, { color: "#3a3f47" }),
    cyl(0, 1, 0, 20, 2, 20, { color: "#3a3f47" }),
  ],
  "dining-chair": (w, d, h, c) => {
    const parts = [box(0, 18, 0, 18, 2.5, 18), box(0, 27, -8, 18, 18, 2)];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(box(sx * 7.5, 8.5, sz * 7.5, 2, 17, 2));
    return parts;
  },
  // tables
  "coffee-table": (w, d, h, c) => tableWithLegs(w, d, h, c, 2.5),
  "side-table": (w, d, h, c) => [
    cyl(0, h - 1, 0, w, 2, d, { color: shade(c, 1.05) }),
    cyl(0, (h - 2) / 2, 0, 4, h - 2, 4, { color: shade(c, 0.9) }),
    cyl(0, 0.75, 0, 14, 1.5, 14, { color: shade(c, 0.9) }),
  ],
  "dining-table-rect": (w, d, h, c) => tableWithLegs(w, d, h, c, 3),
  "dining-table-round": (w, d, h, c) => [
    cyl(0, h - 1.25, 0, w, 2.5, d, { color: shade(c, 1.05) }),
    cyl(0, (h - 2.5) / 2, 0, 6, h - 2.5, 6, { color: shade(c, 0.9) }),
    cyl(0, 1, 0, 24, 2, 24, { color: shade(c, 0.9) }),
  ],
  desk: (w, d, h, c) => [
    box(0, h - 1.25, 0, w, 2.5, d, { color: shade(c, 1.05) }),
    box(-(w / 2 - 1.25), (h - 2.5) / 2, 0, 2.5, h - 2.5, d - 2, { color: shade(c, 0.9) }),
    box(w / 2 - 1.25, (h - 2.5) / 2, 0, 2.5, h - 2.5, d - 2, { color: shade(c, 0.9) }),
  ],
  "kitchen-island": (w, d, h, c) => [
    box(0, (h - 2) / 2, 0, w - 2, h - 2, d - 2),
    box(0, h - 1, 0, w, 2, d, { color: "#eceae4" }),
  ],
  // bedroom
  "bed-twin": bed,
  "bed-full": bed,
  "bed-queen": bed,
  "bed-king": bed,
  nightstand: (w, d, h, c) => [box(0, (h - 2) / 2, 0, w - 2, h - 2, d - 2), box(0, h - 1, 0, w, 2, d, { color: shade(c, 1.08) })],
  dresser: (w, d, h, c) => {
    const parts = [box(0, (h - 2) / 2, 0, w - 2, h - 2, d - 1), box(0, h - 1, 0, w, 2, d, { color: shade(c, 1.08) })];
    for (let i = 0; i < 3; i++) {
      parts.push(box(0, 8 + i * 9, (d - 1) / 2 + 0.25, w - 8, 7, 0.5, { color: shade(c, 1.12) }));
    }
    return parts;
  },
  // kitchen
  refrigerator: (w, d, h, c) => [
    box(0, h / 2, 0, w, h, d),
    box(0, h * 0.68, d / 2 + 0.25, w - 1, h * 0.3, 0.5, { color: shade(c, 1.07) }),
    box(0, h * 0.3, d / 2 + 0.25, w - 1, h * 0.52, 0.5, { color: shade(c, 1.07) }),
  ],
  range: (w, d, h, c) => [
    box(0, (h - 1) / 2, 0, w, h - 1, d),
    box(0, h - 0.5, 0, w - 1, 1, d - 1, { color: "#262b33" }),
    box(0, h * 0.42, d / 2 + 0.25, w - 4, h * 0.5, 0.5, { color: "#1d2127" }),
  ],
  dishwasher: (w, d, h, c) => kitchenBox(w, d, h, c, { door: true }),
  "microwave-cart": (w, d, h, c) => kitchenBox(w, d, h, c, { counter: true }),
  "cabinet-base-24": (w, d, h, c) => kitchenBox(w, d, h, c, { counter: true, door: true }),
  "cabinet-sink-36": (w, d, h, c) => [
    ...kitchenBox(w, d, h, c, { counter: true, door: true }),
    box(0, h - 0.5, 0, w - 10, 2, d - 10, { color: "#9aa2ac" }),
  ],
  "cabinet-wall-24": (w, d, h, c) => kitchenBox(w, d, h, c, { door: true }),
  "cabinet-pantry-24": (w, d, h, c) => kitchenBox(w, d, h, c, { door: true }),
  "sink-kitchen-33": (w, d, h, c) => [
    box(0, h / 2, 0, w, h, d),
    box(0, h - 1, 0, w - 6, 2, d - 6, { color: "#8f979f" }),
  ],
  // bath
  toilet: (w, d, h, c) => [
    box(0, h - 7, -(d / 2 - 3.5), 20, 14, 7), // tank
    box(0, 7, 2, 18, 14, 16), // bowl
    box(0, 15.25, 2, 19, 2.5, 17, { color: "#ffffff" }), // seat
  ],
  "vanity-single": (w, d, h, c) => [
    box(0, (h - 4) / 2, 0, w - 2, h - 4, d - 2),
    box(0, h - 1, 0, w, 2, d, { color: "#f4f6f8" }),
    cyl(0, h + 1.5, 0, 14, 5, 14, { color: "#ffffff" }),
  ],
  "vanity-double": (w, d, h, c) => [
    box(0, (h - 4) / 2, 0, w - 2, h - 4, d - 2),
    box(0, h - 1, 0, w, 2, d, { color: "#f4f6f8" }),
    cyl(-w / 4, h + 1.5, 0, 14, 5, 14, { color: "#ffffff" }),
    cyl(w / 4, h + 1.5, 0, 14, 5, 14, { color: "#ffffff" }),
  ],
  bathtub: (w, d, h, c) => [
    box(0, (h - 2) / 2, 0, w, h - 2, d),
    box(0, (h - 2) / 2 + 1, 0, w - 6, h - 6, d - 6, { color: "#dbe3ea" }),
  ],
  shower: (w, d, h, c) => [
    box(0, 2, 0, w, 4, d, { color: shade(c, 0.92) }), // pan
    box(0, h / 2, -(d / 2 - 1), w, h, 2), // back panel
    box(-(w / 2 - 1), h / 2, 0, 2, h, d), // side panel
  ],
  "shower-48x36": (w, d, h, c) => [
    box(0, 2, 0, w, 4, d, { color: shade(c, 0.92) }),
    box(0, h / 2, -(d / 2 - 1), w, h, 2),
    box(-(w / 2 - 1), h / 2, 0, 2, h, d),
  ],
  "sink-pedestal": (w, d, h, c) => [
    box(0, (h - 6) / 2, 0, 8, h - 6, 8),
    box(0, h - 3, 0, w - 2, 6, d - 2, { color: "#ffffff" }),
  ],
  "sink-bath-round": (w, d, h, c) => [cyl(0, h / 2, 0, w - 1, h, d - 1, { color: "#ffffff" })],
  // laundry
  washer: (w, d, h, c) => [
    box(0, (h - 2) / 2, 0, w, h - 2, d),
    box(0, h - 1, 0, w, 2, d, { color: shade(c, 1.06) }),
    cyl(0, h * 0.5, d / 2 + 0.5, 18, 1.5, 18, { color: "#2c313a", rotX: Math.PI / 2 }),
  ],
  dryer: (w, d, h, c) => [
    box(0, (h - 2) / 2, 0, w, h - 2, d),
    box(0, h - 1, 0, w, 2, d, { color: shade(c, 1.06) }),
    cyl(0, h * 0.5, d / 2 + 0.5, 18, 1.5, 18, { color: "#2c313a", rotX: Math.PI / 2 }),
  ],
  "water-heater": (w, d, h, c) => [cyl(0, h / 2, 0, w - 2, h, d - 2)],
  "utility-sink": (w, d, h, c) => [
    box(0, (h - 6) / 2, 0, w - 2, h - 6, d - 2),
    box(0, h - 3, 0, w - 4, 6, d - 4, { color: shade(c, 1.1) }),
  ],
  // storage
  bookshelf: (w, d, h, c) => {
    const parts = [
      box(-(w / 2 - 1), h / 2, 0, 2, h, d, { color: shade(c, 0.92) }),
      box(w / 2 - 1, h / 2, 0, 2, h, d, { color: shade(c, 0.92) }),
      box(0, h / 2, -(d / 2 - 0.5), w - 2, h, 1, { color: shade(c, 0.85) }),
      box(0, h - 1, 0, w, 2, d, { color: shade(c, 1.05) }),
    ];
    for (let i = 1; i <= 3; i++) parts.push(box(0, (h / 4) * i, 0, w - 4, 2, d - 2, { color: shade(c, 1.02) }));
    return parts;
  },
  "tv-stand": (w, d, h, c) => [
    box(0, (h - 2) / 2, 0, w - 2, h - 2, d - 1),
    box(0, h - 1, 0, w, 2, d, { color: shade(c, 1.06) }),
    box(0, h + 15, -d / 2 + 3, w - 8, 30, 1.5, { color: "#14181f" }), // screen
  ],
  wardrobe: (w, d, h, c) => [
    box(0, h / 2, 0, w - 2, h, d - 1),
    box(-w / 4 + 0.5, h / 2, (d - 1) / 2 + 0.25, w / 2 - 3, h - 8, 0.5, { color: shade(c, 1.07) }),
    box(w / 4 - 0.5, h / 2, (d - 1) / 2 + 0.25, w / 2 - 3, h - 8, 0.5, { color: shade(c, 1.07) }),
  ],
  "storage-chest": (w, d, h, c) => [
    box(0, (h - 3) / 2, 0, w - 2, h - 3, d - 1),
    box(0, h - 1.5, 0, w, 3, d, { color: shade(c, 1.06) }),
  ],
  // lighting
  "floor-lamp": (w, d, h, c) => [
    cyl(0, 1, 0, 12, 2, 12, { color: "#4a4f58" }),
    cyl(0, h / 2, 0, 1.5, h - 18, 1.5, { color: "#4a4f58" }),
    cyl(0, h - 8, 0, 14, 16, 14, { color: c, glow: true }),
  ],
  "table-lamp": (w, d, h, c) => [
    cyl(0, 0.75, 0, 7, 1.5, 7, { color: "#4a4f58" }),
    cyl(0, 6.5, 0, 1, 10, 1, { color: "#4a4f58" }),
    cyl(0, h - 4.5, 0, 9, 9, 9, { color: c, glow: true }),
  ],
};

/**
 * Compose a furniture piece into simple visual primitives.
 * @param {string} catalogId
 * @param {{widthIn:number, depthIn:number, heightIn:number, color:string}} dims
 * @returns {Array} part descriptors (plain JSON; see file header)
 */
export function furnitureParts(catalogId, dims) {
  const { widthIn: w, depthIn: d, heightIn: h, color } = dims || {};
  const composer = COMPOSERS[catalogId];
  if (typeof composer !== "function" || !(w > 0) || !(d > 0) || !(h > 0)) {
    return [box(0, (h || 30) / 2, 0, w || 24, h || 30, d || 24)];
  }
  return composer(w, d, h, color || "#9aa2ad");
}

/** Catalog ids with a dedicated composition (everything else uses the box fallback). */
export function composedCatalogIds() {
  return Object.keys(COMPOSERS);
}
