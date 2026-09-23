// Procedural canvas textures for the Designer 3D view (component layer —
// DOM-dependent, not unit-tested). Zero image assets, zero licensing risk.
//
// Lifetime ownership (final review: safe with multiple viewports alive):
// - The module cache is reference-counted. Each DesignerViewport3D effect
//   cycle calls acquireTextureCaches() on setup and releaseTextureCaches()
//   on teardown. Textures are disposed only when the LAST consumer releases.
// - Cached textures are immutable after creation. Every repeat variant gets
//   its own cache entry (key includes quantized repeat), so no call ever
//   mutates a texture another viewport is using.
//
// Per arch review constraints:
// - color maps set texture.colorSpace = SRGBColorSpace explicitly
// - wrapS/wrapT = RepeatWrapping with explicit repeat values; never generate
//   a giant canvas sized to the whole floor (one fixed-size tile, repeated)
// - generated textures are cached module-wide: never one texture per object

import * as THREE from "three";

const cache = new Map();
let consumerCount = 0;

export function acquireTextureCaches() {
  consumerCount += 1;
}

function disposeAll() {
  for (const tex of cache.values()) tex.dispose();
  cache.clear();
}

export function releaseTextureCaches() {
  consumerCount = Math.max(0, consumerCount - 1);
  if (consumerCount === 0) disposeAll();
}

function makeCanvas(size) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  return [canvas, canvas.getContext("2d")];
}

function toTexture(canvas, { srgb = true, repeatX = 1, repeatY = 1 } = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = 4;
  return tex;
}

// 512px tile = 96" x 96" of wood plank flooring at repeat 1.
function buildWoodFloor() {
  const [canvas, ctx] = makeCanvas(512);
  const plankPx = 64; // 12" planks
  const tones = ["#b08d5f", "#a9855a", "#b79568", "#a37f52", "#ad8a5c"];
  let row = 0;
  for (let y = 0; y < 512; y += plankPx, row++) {
    // staggered butt joints
    const joints = [((row * 197) % 512 + 512) % 512, ((row * 197 + 256) % 512 + 512) % 512];
    for (let x = 0; x < 512; x += 8) {
      ctx.fillStyle = tones[(x / 8 + row * 3) % tones.length];
      ctx.fillRect(x, y, 8, plankPx);
    }
    // grain streaks
    ctx.strokeStyle = "rgba(90, 62, 35, 0.18)";
    ctx.lineWidth = 1;
    for (let gLine = 0; gLine < 5; gLine++) {
      const gy = y + 8 + ((gLine * 37 + row * 11) % (plankPx - 16));
      ctx.beginPath();
      ctx.moveTo(0, gy);
      for (let x = 0; x <= 512; x += 64) ctx.lineTo(x, gy + Math.sin(x / 90 + row) * 3);
      ctx.stroke();
    }
    // plank seams + butt joints
    ctx.fillStyle = "rgba(60, 40, 22, 0.55)";
    ctx.fillRect(0, y, 512, 2);
    for (const jx of joints) ctx.fillRect(jx, y, 2, plankPx);
  }
  return canvas;
}

// 256px subtle plaster tile for walls.
function buildPlaster() {
  const [canvas, ctx] = makeCanvas(256);
  ctx.fillStyle = "#ece8dc";
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2600; i++) {
    const x = (i * 137) % 256;
    const y = (i * 241) % 256;
    const v = 228 + ((i * 53) % 24);
    ctx.fillStyle = `rgba(${v},${v - 4},${v - 12},0.5)`;
    ctx.fillRect(x, y, 2, 2);
  }
  return canvas;
}

// 16x256 vertical sky gradient used as the scene background.
function buildSky() {
  const canvas = document.createElement("canvas");
  canvas.width = 16;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, "#9ec7e8");
  grad.addColorStop(0.55, "#cfe2f0");
  grad.addColorStop(0.8, "#f2ecdd");
  grad.addColorStop(1, "#e9e2d0");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 16, 256);
  return canvas;
}

export function woodFloorTexture(repeatX, repeatY) {
  const key = repeatKey("wood", repeatX, repeatY);
  if (!cache.has(key)) cache.set(key, toTexture(buildWoodFloor(), { repeatX, repeatY }));
  return cache.get(key);
}

export function plasterTexture(repeatX = 3, repeatY = 1.5) {
  const key = repeatKey("plaster", repeatX, repeatY);
  if (!cache.has(key)) cache.set(key, toTexture(buildPlaster(), { repeatX, repeatY }));
  return cache.get(key);
}

export function skyTexture() {
  const key = "sky:1.0000:1.0000";
  if (!cache.has(key)) {
    const tex = toTexture(buildSky());
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    cache.set(key, tex);
  }
  return cache.get(key);
}

// Repeat is baked into the cache key (quantized to 4 decimals): the stored
// texture is never mutated after creation, so two viewports with different
// repeat values each get their own immutable texture instead of fighting
// over one shared object's repeat state.
function repeatKey(base, repeatX, repeatY) {
  return `${base}:${Number(repeatX).toFixed(4)}:${Number(repeatY).toFixed(4)}`;
}
