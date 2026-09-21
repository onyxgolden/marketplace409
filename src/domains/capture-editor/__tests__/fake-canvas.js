// Test-only software raster canvas + minimal PNG codec.
// Implements exactly the Canvas 2D subset the capture renderer uses, on a
// Uint8ClampedArray pixel buffer, so redaction proofs can assert on real
// pixels without a browser or node-canvas. NOT shipped — tests only.

function clampByte(v) {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

const NAMED_COLORS = {
  transparent: [0, 0, 0, 0],
  black: [0, 0, 0, 1],
  white: [255, 255, 255, 1],
  red: [255, 0, 0, 1],
  green: [0, 128, 0, 1],
  blue: [0, 0, 255, 1],
  yellow: [255, 255, 0, 1],
};

export function parseColor(css) {
  if (typeof css !== "string") return [0, 0, 0, 1];
  const s = css.trim().toLowerCase();
  if (NAMED_COLORS[s]) return NAMED_COLORS[s].slice();
  let m = /^#([0-9a-f]{3})$/.exec(s);
  if (m) {
    const h = m[1];
    return [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16), 1];
  }
  m = /^#([0-9a-f]{6})$/.exec(s);
  if (m) {
    const h = m[1];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1];
  }
  m = /^#([0-9a-f]{8})$/.exec(s);
  if (m) {
    const h = m[1];
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
      parseInt(h.slice(6, 8), 16) / 255,
    ];
  }
  m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(s);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])];
  return [0, 0, 0, 1];
}

function defaultState() {
  return {
    fillStyle: "#000000",
    strokeStyle: "#000000",
    lineWidth: 1,
    lineCap: "butt",
    lineJoin: "miter",
    globalAlpha: 1,
    font: "10px sans-serif",
    textBaseline: "alphabetic",
    textAlign: "start",
    imageSmoothingEnabled: true,
    imageSmoothingQuality: "low",
    transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
  };
}

class FakeContext2D {
  constructor(canvas) {
    this.canvas = canvas;
    this._state = defaultState();
    this._stack = [];
    this._path = [];
    this._current = null;
  }

  // --- state accessors -------------------------------------------------
  get fillStyle() { return this._state.fillStyle; }
  set fillStyle(v) { this._state.fillStyle = v; }
  get strokeStyle() { return this._state.strokeStyle; }
  set strokeStyle(v) { this._state.strokeStyle = v; }
  get lineWidth() { return this._state.lineWidth; }
  set lineWidth(v) { this._state.lineWidth = v; }
  get lineCap() { return this._state.lineCap; }
  set lineCap(v) { this._state.lineCap = v; }
  get lineJoin() { return this._state.lineJoin; }
  set lineJoin(v) { this._state.lineJoin = v; }
  get globalAlpha() { return this._state.globalAlpha; }
  set globalAlpha(v) { this._state.globalAlpha = v; }
  get font() { return this._state.font; }
  set font(v) { this._state.font = v; }
  get textBaseline() { return this._state.textBaseline; }
  set textBaseline(v) { this._state.textBaseline = v; }
  get textAlign() { return this._state.textAlign; }
  set textAlign(v) { this._state.textAlign = v; }
  get imageSmoothingEnabled() { return this._state.imageSmoothingEnabled; }
  set imageSmoothingEnabled(v) { this._state.imageSmoothingEnabled = v; }
  get imageSmoothingQuality() { return this._state.imageSmoothingQuality; }
  set imageSmoothingQuality(v) { this._state.imageSmoothingQuality = v; }

  save() {
    this._stack.push({ ...this._state, transform: { ...this._state.transform } });
  }

  restore() {
    const s = this._stack.pop();
    if (s) this._state = s;
  }

  setTransform(a, b, c, d, e, f) {
    this._state.transform = { a, b, c, d, e, f };
  }

  // User-space -> device-space. The renderer only ever uses scale+translate.
  _map(x, y) {
    const t = this._state.transform;
    return [x * t.a + y * t.c + t.e, x * t.b + y * t.d + t.f];
  }

  // Device-space -> user-space (inverse of the above for scale+translate).
  _unmap(px, py) {
    const t = this._state.transform;
    return [(px - t.e) / t.a, (py - t.f) / t.d];
  }

  // Source-over composite of one pixel, alpha in 0..1.
  _composite(px, py, r, g, b, alpha) {
    const { width, height, data } = this.canvas;
    if (px < 0 || py < 0 || px >= width || py >= height) return;
    const sa = Math.max(0, Math.min(1, alpha));
    if (sa === 0) return;
    const i = (py * width + px) * 4;
    const da = data[i + 3] / 255;
    const oa = sa + da * (1 - sa);
    if (oa <= 0) {
      data[i] = 0; data[i + 1] = 0; data[i + 2] = 0; data[i + 3] = 0;
      return;
    }
    data[i] = (r * sa + data[i] * da * (1 - sa)) / oa;
    data[i + 1] = (g * sa + data[i + 1] * da * (1 - sa)) / oa;
    data[i + 2] = (b * sa + data[i + 2] * da * (1 - sa)) / oa;
    data[i + 3] = oa * 255;
  }

  _fillDeviceRect(x0, y0, x1, y1, r, g, b, alpha) {
    const { width, height } = this.canvas;
    const loX = Math.max(0, Math.floor(Math.min(x0, x1)));
    const hiX = Math.min(width - 1, Math.ceil(Math.max(x0, x1)));
    const loY = Math.max(0, Math.floor(Math.min(y0, y1)));
    const hiY = Math.min(height - 1, Math.ceil(Math.max(y0, y1)));
    for (let py = loY; py <= hiY; py += 1) {
      for (let px = loX; px <= hiX; px += 1) this._composite(px, py, r, g, b, alpha);
    }
  }

  fillRect(x, y, w, h) {
    const [r, g, b, a] = parseColor(this._state.fillStyle);
    const [x0, y0] = this._map(x, y);
    const [x1, y1] = this._map(x + w, y + h);
    this._fillDeviceRect(x0, y0, x1, y1, r, g, b, a * this._state.globalAlpha);
  }

  // --- images ----------------------------------------------------------
  drawImage(...args) {
    const src = args[0];
    let sx, sy, sw, sh, dx, dy, dw, dh;
    if (args.length === 3) {
      [dx, dy] = [args[1], args[2]];
      sx = 0; sy = 0; sw = src.width; sh = src.height; dw = src.width; dh = src.height;
    } else if (args.length === 5) {
      [dx, dy, dw, dh] = args.slice(1);
      sx = 0; sy = 0; sw = src.width; sh = src.height;
    } else if (args.length === 9) {
      [sx, sy, sw, sh, dx, dy, dw, dh] = args.slice(1);
    } else {
      throw new Error(`drawImage: unsupported arity ${args.length}`);
    }
    if (!(sw > 0) || !(sh > 0) || dw === 0 || dh === 0) return;
    const dest = this.canvas;
    const corners = [
      this._map(dx, dy),
      this._map(dx + dw, dy),
      this._map(dx, dy + dh),
      this._map(dx + dw, dy + dh),
    ];
    const xs = corners.map((c) => c[0]);
    const ys = corners.map((c) => c[1]);
    const loX = Math.max(0, Math.floor(Math.min(...xs)));
    const hiX = Math.min(dest.width - 1, Math.ceil(Math.max(...xs)));
    const loY = Math.max(0, Math.floor(Math.min(...ys)));
    const hiY = Math.min(dest.height - 1, Math.ceil(Math.max(...ys)));
    const smooth = this._state.imageSmoothingEnabled;
    const srcData = src.data;
    const sample = (fx, fy) => {
      if (smooth) {
        const x0 = Math.floor(fx);
        const y0 = Math.floor(fy);
        const tx = fx - x0;
        const ty = fy - y0;
        const at = (xx, yy) => {
          const cx = Math.max(0, Math.min(src.width - 1, xx));
          const cy = Math.max(0, Math.min(src.height - 1, yy));
          const i = (cy * src.width + cx) * 4;
          return [srcData[i], srcData[i + 1], srcData[i + 2], srcData[i + 3] / 255];
        };
        const p00 = at(x0, y0);
        const p10 = at(x0 + 1, y0);
        const p01 = at(x0, y0 + 1);
        const p11 = at(x0 + 1, y0 + 1);
        const w = (pA, pB, pC, pD) => [
          pA[0] * (1 - tx) * (1 - ty) + pB[0] * tx * (1 - ty) + pC[0] * (1 - tx) * ty + pD[0] * tx * ty,
          pA[1] * (1 - tx) * (1 - ty) + pB[1] * tx * (1 - ty) + pC[1] * (1 - tx) * ty + pD[1] * tx * ty,
          pA[2] * (1 - tx) * (1 - ty) + pB[2] * tx * (1 - ty) + pC[2] * (1 - tx) * ty + pD[2] * tx * ty,
          pA[3] * (1 - tx) * (1 - ty) + pB[3] * tx * (1 - ty) + pC[3] * (1 - tx) * ty + pD[3] * tx * ty,
        ];
        return w(p00, p10, p01, p11);
      }
      const cx = Math.max(0, Math.min(src.width - 1, Math.round(fx)));
      const cy = Math.max(0, Math.min(src.height - 1, Math.round(fy)));
      const i = (cy * src.width + cx) * 4;
      return [srcData[i], srcData[i + 1], srcData[i + 2], srcData[i + 3] / 255];
    };
    for (let py = loY; py <= hiY; py += 1) {
      for (let px = loX; px <= hiX; px += 1) {
        const [ux, uy] = this._unmap(px + 0.5, py + 0.5);
        const fx = sx + ((ux - dx) / dw) * sw;
        const fy = sy + ((uy - dy) / dh) * sh;
        if (fx < 0 || fy < 0 || fx > src.width - 1 || fy > src.height - 1) continue;
        const [r, g, b, a] = sample(fx, fy);
        this._composite(px, py, r, g, b, a * this._state.globalAlpha);
      }
    }
  }

  // --- paths -----------------------------------------------------------
  beginPath() {
    this._path = [];
    this._current = null;
  }

  moveTo(x, y) {
    this._current = [[x, y]];
    this._path.push(this._current);
  }

  lineTo(x, y) {
    if (!this._current) {
      this.moveTo(x, y);
      return;
    }
    this._current.push([x, y]);
  }

  closePath() {
    if (this._current && this._current.length > 0) {
      const [fx, fy] = this._current[0];
      this._current.push([fx, fy]);
    }
  }

  rect(x, y, w, h) {
    this.moveTo(x, y);
    this.lineTo(x + w, y);
    this.lineTo(x + w, y + h);
    this.lineTo(x, y + h);
    this.closePath();
  }

  _arcPolyline(cx, cy, rx, ry, startAngle, endAngle) {
    let sweep = endAngle - startAngle;
    while (sweep < 0) sweep += Math.PI * 2;
    const full = sweep >= Math.PI * 2 - 1e-6;
    const steps = Math.max(8, Math.ceil(((full ? Math.PI * 2 : sweep) * Math.max(rx, ry)) / 2));
    const pts = [];
    const n = full ? steps : Math.max(1, steps);
    for (let i = 0; i <= n; i += 1) {
      const a = full ? (i / steps) * Math.PI * 2 : startAngle + (sweep * i) / n;
      pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
    }
    return { pts, full };
  }

  ellipse(x, y, radiusX, radiusY, _rotation, startAngle, endAngle) {
    const { pts, full } = this._arcPolyline(x, y, radiusX, radiusY, startAngle, endAngle);
    this._current = [pts[0]];
    this._path.push(this._current);
    for (let i = 1; i < pts.length; i += 1) this._current.push(pts[i]);
    if (full) this.closePath();
  }

  arc(x, y, radius, startAngle, endAngle) {
    this.ellipse(x, y, radius, radius, 0, startAngle, endAngle);
  }

  _devicePolyline(pts) {
    return pts.map(([x, y]) => this._map(x, y));
  }

  _stampDisc(cx, cy, radius, r, g, b, alpha) {
    const ri = Math.ceil(radius);
    for (let dy = -ri; dy <= ri; dy += 1) {
      const dx = Math.sqrt(Math.max(0, radius * radius - dy * dy));
      const x0 = Math.ceil(cx - dx - 0.5);
      const x1 = Math.floor(cx + dx - 0.5);
      const py = Math.floor(cy + dy);
      for (let px = x0; px <= x1; px += 1) this._composite(px, py, r, g, b, alpha);
    }
  }

  stroke() {
    const [r, g, b, a] = parseColor(this._state.strokeStyle);
    const alpha = a * this._state.globalAlpha;
    const radius = Math.max(0.5, this._state.lineWidth / 2);
    for (const sub of this._path) {
      if (sub.length === 0) continue;
      const dev = this._devicePolyline(sub);
      if (dev.length === 1) {
        this._stampDisc(dev[0][0], dev[0][1], radius, r, g, b, alpha);
        continue;
      }
      for (let i = 0; i + 1 < dev.length; i += 1) {
        const [x0, y0] = dev[i];
        const [x1, y1] = dev[i + 1];
        const len = Math.hypot(x1 - x0, y1 - y0);
        const steps = Math.max(1, Math.ceil(len / Math.max(0.75, radius / 2)));
        for (let sIdx = 0; sIdx <= steps; sIdx += 1) {
          const t = sIdx / steps;
          this._stampDisc(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, radius, r, g, b, alpha);
        }
      }
    }
  }

  fill() {
    const [r, g, b, a] = parseColor(this._state.fillStyle);
    const alpha = a * this._state.globalAlpha;
    const { height } = this.canvas;
    for (const sub of this._path) {
      if (sub.length < 3) continue;
      const dev = this._devicePolyline(sub);
      const ys = dev.map((p) => p[1]);
      const loY = Math.max(0, Math.floor(Math.min(...ys)));
      const hiY = Math.min(height - 1, Math.ceil(Math.max(...ys)));
      for (let py = loY; py <= hiY; py += 1) {
        const y = py + 0.5;
        const xs = [];
        for (let i = 0; i + 1 < dev.length; i += 1) {
          const [x0, y0] = dev[i];
          const [x1, y1] = dev[i + 1];
          if ((y0 <= y && y1 > y) || (y1 <= y && y0 > y)) {
            xs.push(x0 + ((y - y0) / (y1 - y0)) * (x1 - x0));
          }
        }
        xs.sort((p, q) => p - q);
        for (let k = 0; k + 1 < xs.length; k += 2) {
          const x0 = Math.max(0, Math.ceil(xs[k] - 0.5));
          const x1 = Math.floor(xs[k + 1] - 0.5);
          for (let px = x0; px <= x1; px += 1) this._composite(px, py, r, g, b, alpha);
        }
      }
    }
  }

  fillText(text, x, y) {
    const m = /([\d.]+)px/.exec(this._state.font);
    const fs = m ? Number(m[1]) : 10;
    const str = String(text);
    const w = str.length * fs * 0.6;
    let tx = x;
    let ty = y;
    if (this._state.textAlign === "center") tx = x - w / 2;
    if (this._state.textBaseline === "middle") ty = y - fs / 2;
    else if (this._state.textBaseline !== "top") ty = y - fs * 0.8;
    const lines = str.split("\n");
    lines.forEach((line, i) => {
      const lw = line.length * fs * 0.6;
      const lx = this._state.textAlign === "center" ? x - lw / 2 : tx;
      const [r, g, b, a] = parseColor(this._state.fillStyle);
      const [x0, y0] = this._map(lx, ty + i * fs * 1.25);
      const [x1, y1] = this._map(lx + lw, ty + i * fs * 1.25 + fs);
      this._fillDeviceRect(x0, y0, x1, y1, r, g, b, a * this._state.globalAlpha);
    });
  }

  getImageData(x, y, w, h) {
    const { width, height, data } = this.canvas;
    const out = new Uint8ClampedArray(w * h * 4);
    for (let row = 0; row < h; row += 1) {
      for (let col = 0; col < w; col += 1) {
        const sx = x + col;
        const sy = y + row;
        if (sx < 0 || sy < 0 || sx >= width || sy >= height) continue;
        const si = (sy * width + sx) * 4;
        const di = (row * w + col) * 4;
        out[di] = data[si];
        out[di + 1] = data[si + 1];
        out[di + 2] = data[si + 2];
        out[di + 3] = data[si + 3];
      }
    }
    return { width: w, height: h, data: out };
  }
}

export class FakeCanvas {
  constructor(width, height) {
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    this.data = new Uint8ClampedArray(this.width * this.height * 4);
    this._ctx = null;
  }

  getContext(kind) {
    if (kind !== "2d") return null;
    if (!this._ctx) this._ctx = new FakeContext2D(this);
    return this._ctx;
  }
}

export function fillCanvasSolid(canvas, r, g, b, a = 255) {
  const { width, height, data } = canvas;
  for (let i = 0; i < width * height; i += 1) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = a;
  }
}

export function pixelAt(canvas, x, y) {
  const i = (y * canvas.width + x) * 4;
  return [canvas.data[i], canvas.data[i + 1], canvas.data[i + 2], canvas.data[i + 3]];
}

// --- minimal PNG codec (test-only) ---------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = new Uint8Array(8 + data.length + 4);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function concat(arrays) {
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}

// Encodes RGBA (Uint8ClampedArray, row-major) as PNG with filter type 0.
export async function encodePNGviaNode(width, height, rgba) {
  const { deflateSync } = await import("node:zlib");
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * stride] = 0;
    for (let x = 0; x < width * 4; x += 1) raw[y * stride + 1 + x] = rgba[y * width * 4 + x];
  }
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  return concat([signature, chunk("IHDR", ihdr), chunk("IDAT", new Uint8Array(deflateSync(raw))), chunk("IEND", new Uint8Array(0))]);
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

// Independent decoder: parses PNG structure directly, supports filter types
// 0..4. Throws on anything it does not understand.
export async function decodePNGviaNode(bytes) {
  const { inflateSync } = await import("node:zlib");
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i += 1) {
    if (bytes[i] !== sig[i]) throw new Error("not a PNG");
  }
  let pos = 8;
  let width = 0;
  let height = 0;
  const idatParts = [];
  while (pos < bytes.length) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + pos, 12);
    const length = view.getUint32(0);
    const type = String.fromCharCode(bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7]);
    const data = bytes.subarray(pos + 8, pos + 8 + length);
    const crcView = new DataView(bytes.buffer, bytes.byteOffset + pos, 12 + length);
    const storedCrc = crcView.getUint32(8 + length);
    if (crc32(bytes.subarray(pos + 4, pos + 8 + length)) !== storedCrc) {
      throw new Error(`CRC mismatch in ${type}`);
    }
    if (type === "IHDR") {
      const iv = new DataView(data.buffer, data.byteOffset, 13);
      width = iv.getUint32(0);
      height = iv.getUint32(4);
      if (data[8] !== 8 || data[9] !== 6) throw new Error(`unsupported PNG format (depth ${data[8]}, type ${data[9]})`);
    } else if (type === "IDAT") {
      idatParts.push(data);
    } else if (type === "IEND") {
      break;
    }
    pos += 12 + length;
  }
  if (width <= 0 || height <= 0) throw new Error("missing IHDR");
  const raw = new Uint8Array(inflateSync(Buffer.from(concat(idatParts))));
  const stride = width * 4;
  const out = new Uint8ClampedArray(stride * height);
  let p = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[p];
    p += 1;
    for (let x = 0; x < stride; x += 1) {
      const a = x >= 4 ? out[y * stride + x - 4] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= 4 && y > 0 ? out[(y - 1) * stride + x - 4] : 0;
      let v = raw[p];
      p += 1;
      if (filter === 1) v = (v + a) & 0xff;
      else if (filter === 2) v = (v + b) & 0xff;
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) v = (v + paeth(a, b, c)) & 0xff;
      else if (filter !== 0) throw new Error(`unsupported PNG filter ${filter}`);
      out[y * stride + x] = v;
    }
  }
  return { width, height, data: out };
}
