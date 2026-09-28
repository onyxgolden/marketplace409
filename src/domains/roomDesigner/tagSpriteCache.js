// Reference-counted cache of canvas tag-label textures/materials for the 3D
// viewport's floating equipment labels (P-101, E-102, …).
//
// One texture+material pair is shared by every sprite showing the same tag.
// Each sprite acquired from the cache holds one reference; disposing a scene
// releases its sprites' references (see release()). GPU resources are disposed
// only when the last referencing sprite is gone:
//
// - Cache eviction (at `cap` entries) disposes only UNREFERENCED entries —
//   evicting a texture out from under live sprites would corrupt their labels
//   (and three.js would just re-upload it on the next render, defeating the
//   cap). When every entry is live, the cap is soft and eviction is skipped.
// - sweep() disposes every unreferenced entry; the viewport calls it on
//   unmount so module-scoped GPU resources don't outlive the viewport.
//
// Framework-free: THREE and the canvas factory are injected, so this is fully
// unit-testable in Node with no DOM and no WebGL context.

export const DEFAULT_TAG_SPRITE_CACHE_CAP = 250;

/**
 * createTagSpriteCache({ THREE, createLabelCanvas, cap })
 *
 * - THREE: the three.js module (CanvasTexture, SpriteMaterial).
 * - createLabelCanvas(text): returns { canvas, aspect } for a trimmed tag.
 * - cap: max entries before oldest-unreferenced eviction kicks in.
 *
 * Returns { acquire, release, sweep, size, refCountOf }.
 */
export function createTagSpriteCache({ THREE, createLabelCanvas, cap = DEFAULT_TAG_SPRITE_CACHE_CAP }) {
  // tag text -> { texture, material, aspect, refCount }. Insertion-ordered, so
  // the first unreferenced entry is the oldest one.
  const entries = new Map();

  function disposeEntry(key, entry) {
    entry.texture.dispose();
    entry.material.dispose();
    entries.delete(key);
  }

  // Oldest-first eviction, but never an entry live sprites still reference.
  function evictIfNeeded() {
    if (entries.size < cap) return;
    for (const [key, entry] of entries) {
      if (entry.refCount <= 0) {
        disposeEntry(key, entry);
        return;
      }
    }
    // Every entry is live: skip eviction rather than disposing shared
    // resources out from under rendered sprites.
  }

  /**
   * Acquire the shared { key, material, aspect } for a tag, bumping its
   * reference count. The caller stamps sprite.userData.tagCacheKey = key so
   * release() can find the entry later. Returns null for blank tags.
   */
  function acquire(rawText) {
    const text = String(rawText || "").trim();
    if (!text) return null;
    let entry = entries.get(text);
    if (!entry) {
      evictIfNeeded();
      const { canvas, aspect } = createLabelCanvas(text);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 4;
      const material = new THREE.SpriteMaterial({ map: texture, depthWrite: false, transparent: true });
      entry = { texture, material, aspect, refCount: 0 };
      entries.set(text, entry);
    }
    entry.refCount += 1;
    return { key: text, material: entry.material, aspect: entry.aspect };
  }

  /**
   * Release one sprite's reference. Idempotent: the userData marker is
   * consumed on the first call, so a second release (or a release after the
   * entry was swept) is a safe no-op. Returns true when a reference was held.
   */
  function release(sprite) {
    const key = sprite?.userData?.tagCacheKey;
    if (!key) return false;
    delete sprite.userData.tagCacheKey;
    const entry = entries.get(key);
    if (!entry) return false;
    entry.refCount = Math.max(0, entry.refCount - 1);
    return true;
  }

  /**
   * Dispose the GPU resources of every entry with no live references and drop
   * them from the cache. The viewport calls this on unmount (after its
   * sprites' references are released) so nothing module-scoped leaks.
   * Returns the number of entries disposed.
   */
  function sweep() {
    let disposed = 0;
    for (const [key, entry] of [...entries]) {
      if (entry.refCount <= 0) {
        disposeEntry(key, entry);
        disposed += 1;
      }
    }
    return disposed;
  }

  return {
    acquire,
    release,
    sweep,
    size: () => entries.size,
    refCountOf: (text) => entries.get(text)?.refCount ?? 0,
  };
}
