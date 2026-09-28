// tagSpriteCache.test.js — reference-counted tag-label texture/material cache.
// Runs on real Three.js objects with NO DOM and NO WebGL context; the canvas
// factory is stubbed because canvas drawing is injected.

import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createTagSpriteCache, DEFAULT_TAG_SPRITE_CACHE_CAP } from "./tagSpriteCache";

const stubCanvasFactory = (text) => ({
  canvas: { width: 100 + text.length * 10, height: 84 },
  aspect: 1.5,
});

const makeCache = (cap = DEFAULT_TAG_SPRITE_CACHE_CAP) =>
  createTagSpriteCache({ THREE, createLabelCanvas: stubCanvasFactory, cap });

// A sprite stand-in: the cache only touches userData.tagCacheKey.
const spriteFor = (acquired) => ({ userData: { tagCacheKey: acquired.key } });

function disposeCount(material) {
  let n = 0;
  material.addEventListener("dispose", () => { n += 1; });
  return () => n;
}

describe("tagSpriteCache", () => {
  it("shares one entry across sprites and refcounts each acquisition", () => {
    const cache = makeCache();
    const a = cache.acquire("P-101");
    const b = cache.acquire("P-101");
    expect(b.material).toBe(a.material);
    expect(cache.refCountOf("P-101")).toBe(2);
    expect(cache.size()).toBe(1);
  });

  it("returns null for blank tags", () => {
    const cache = makeCache();
    expect(cache.acquire("   ")).toBeNull();
    expect(cache.acquire(null)).toBeNull();
    expect(cache.size()).toBe(0);
  });

  it("release decrements and is idempotent", () => {
    const cache = makeCache();
    const acquired = cache.acquire("P-101");
    const disposed = disposeCount(acquired.material);
    const s = spriteFor(acquired);
    expect(cache.release(s)).toBe(true);
    expect(cache.refCountOf("P-101")).toBe(0);
    expect(cache.release(s)).toBe(false); // marker consumed: no double-decrement
    expect(cache.refCountOf("P-101")).toBe(0);
    expect(disposed()).toBe(0); // release alone never disposes
  });

  it("eviction disposes only the oldest UNREFERENCED entry, never live sprites' resources", () => {
    const cache = makeCache(3);
    const a = cache.acquire("P-101"); // held
    const aDisposed = disposeCount(a.material);
    const b = cache.acquire("P-102"); // released -> evictable
    const bDisposed = disposeCount(b.material);
    cache.release(spriteFor(b));
    const c = cache.acquire("P-103"); // held
    const cDisposed = disposeCount(c.material);

    cache.acquire("P-104"); // over cap: must evict P-102, the oldest unreferenced

    expect(bDisposed()).toBe(1);
    expect(aDisposed()).toBe(0);
    expect(cDisposed()).toBe(0);
    expect(cache.size()).toBe(3);
    expect(cache.refCountOf("P-101")).toBe(1); // live entry intact
  });

  it("skips eviction when every entry is live instead of disposing shared resources", () => {
    const cache = makeCache(2);
    const a = cache.acquire("P-101");
    const aDisposed = disposeCount(a.material);
    const b = cache.acquire("P-102");
    const bDisposed = disposeCount(b.material);

    cache.acquire("P-103"); // over cap but nothing evictable

    expect(aDisposed()).toBe(0);
    expect(bDisposed()).toBe(0);
    expect(cache.size()).toBe(3); // soft cap: grow rather than corrupt live labels
  });

  it("sweep disposes every unreferenced entry and keeps live ones", () => {
    const cache = makeCache();
    const live = cache.acquire("P-101");
    const liveDisposed = disposeCount(live.material);
    const dead = cache.acquire("P-102");
    const deadDisposed = disposeCount(dead.material);
    cache.release(spriteFor(dead));

    expect(cache.sweep()).toBe(1);
    expect(deadDisposed()).toBe(1);
    expect(liveDisposed()).toBe(0);
    expect(cache.size()).toBe(1);
    expect(cache.refCountOf("P-101")).toBe(1);
  });

  it("sweep on a fully released cache empties it (the unmount path)", () => {
    const cache = makeCache();
    const acquired = ["P-101", "P-102", "P-103"].map((t) => cache.acquire(t));
    const disposedFlags = acquired.map((a) => disposeCount(a.material));
    const sprites = acquired.map((a) => spriteFor(a));
    // release every sprite, as disposeContentGroup does on unmount
    for (const s of sprites) cache.release(s);
    expect(cache.sweep()).toBe(3);
    expect(cache.size()).toBe(0);
    expect(disposedFlags.every((d) => d() === 1)).toBe(true);
  });
});
