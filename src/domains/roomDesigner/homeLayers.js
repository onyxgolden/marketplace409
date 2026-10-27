// Home layer masks (H0 — FORGE Designer home parity, brief §3/§5).
//
// One shared selector feeds canvas, hit-testing, and print: the base plan,
// the reference underlay, furniture, and the three residential trade layers
// (electrical, plumbing, HVAC) are each independently visible. This module
// is pure data + selectors — no React, no canvas, no print code — so the
// screen, the canvas, the print views, and tests all resolve visibility
// from the same contract.
//
// A mask is view preference, NOT document state: toggling a layer never
// dirties the document, never enters undo history, and never changes
// estimates. The mask itself is frozen; set/toggle return new masks.
//
// The 8 trade masks are the 2^3 on/off combinations of the three trades.
// Crossed with base-plan on/off they give the 16 render states the
// mask-matrix acceptance covers. Underlay visibility is independent and
// explicit, and it is gated on an underlay actually existing — a mask can
// ask for the underlay, but with nothing imported there is nothing to show.
// Furniture has no availability gate: an empty furniture list renders
// nothing either way.
//
// Home-only gating: in industrial mode every home-layer flag resolves to
// false. Industrial rendering keeps its existing path untouched; the mask
// simply does not apply there.

import { DESIGNER_MODE_HOME, normalizeDesignMode } from "./designerModes";
import { HOME_OVERLAY_TRADES } from "./homeOverlays";

export const HOME_LAYER_BASE = "base";
export const HOME_LAYER_UNDERLAY = "underlay";
export const HOME_LAYER_FURNITURE = "furniture";

export const HOME_LAYER_KEYS = Object.freeze([
  HOME_LAYER_BASE,
  HOME_LAYER_UNDERLAY,
  HOME_LAYER_FURNITURE,
  ...HOME_OVERLAY_TRADES,
]);

const TRADE_LABELS = Object.freeze({
  electrical: "Electrical",
  plumbing: "Plumbing",
  hvac: "HVAC",
});

/** Default mask: base visible, trades hidden. New home designs begin with
 * the base visible and trade collections empty; authoring a trade shows
 * that trade without toggling unrelated trades (a later slice's job).
 *
 * Boolean-only contract (H679-003, tightened H679-003A, H679-003B): a
 * supplied value must be a primitive boolean — strings, numbers,
 * objects, and null are rejected, never coerced with Boolean() or ??.
 * Defaults apply on absence only, where a key missing or explicitly
 * undefined counts as absent. Validation reads the exact values
 * construction consumes, through ordinary lookup — so an INHERITED
 * string/object/null is refused exactly like an own one, while an
 * inherited boolean is consumed as a boolean and an inherited undefined
 * counts as absent. Unknown-key rejection stays own-keys-only: an
 * inherited key construction never reads is treated as absent.
 *
 * Single-read capture (H679-003B): each accepted key is read EXACTLY
 * ONCE into a detached local; validation and construction both use the
 * captured value, never a second read. A changing getter therefore
 * cannot make construction consume a different value than the one
 * validated — the mask holds only the originally validated booleans
 * (or defaults for absence). Captured values are primitives, so the
 * frozen mask can hold no mutable alias. Every mask a caller can hold
 * is therefore boolean-only, detached, and frozen. */
export function createHomeLayerMask(partial = {}) {
  if (!partial || typeof partial !== "object" || Array.isArray(partial)) {
    throw new Error("Layer mask overrides must be an object.");
  }
  for (const key of Object.keys(partial)) {
    if (!HOME_LAYER_KEYS.includes(key)) {
      throw new Error(`Unknown home layer "${key}".`);
    }
  }
  const captured = {};
  for (const key of HOME_LAYER_KEYS) {
    const value = partial[key];
    if (value !== undefined && typeof value !== "boolean") {
      throw new Error(`Home layer "${key}" must be a boolean.`);
    }
    captured[key] = value;
  }
  return Object.freeze({
    base: captured.base ?? true,
    underlay: captured.underlay ?? true,
    furniture: captured.furniture ?? true,
    electrical: captured.electrical ?? false,
    plumbing: captured.plumbing ?? false,
    hvac: captured.hvac ?? false,
  });
}

/** The default mask (base visible, trades hidden). */
export function defaultHomeLayerMask() {
  return createHomeLayerMask();
}

/** Set one layer's visibility; returns a new frozen mask. The visibility
 * must be a primitive boolean — no truthiness coercion (H679-003). */
export function setHomeLayer(mask, layer, visible) {
  if (!HOME_LAYER_KEYS.includes(layer)) {
    throw new Error(`Unknown home layer "${layer}".`);
  }
  if (typeof visible !== "boolean") {
    throw new Error(`Home layer "${layer}" visibility must be a boolean.`);
  }
  return createHomeLayerMask({ ...mask, [layer]: visible });
}

/** Flip one layer's visibility; returns a new frozen mask. */
export function toggleHomeLayer(mask, layer) {
  if (!HOME_LAYER_KEYS.includes(layer)) {
    throw new Error(`Unknown home layer "${layer}".`);
  }
  return setHomeLayer(mask, layer, !mask[layer]);
}

/** All 8 trade on/off combinations, in fixed trade order. */
export const HOME_TRADE_MASKS = Object.freeze(
  [false, true].flatMap((electrical) =>
    [false, true].flatMap((plumbing) =>
      [false, true].map((hvac) =>
        Object.freeze({ electrical, plumbing, hvac }),
      ),
    ),
  ),
);

/**
 * Resolve a mask into what renders, for one mode.
 *
 * options: { mode (default "home"), hasUnderlay (default false) }.
 * Industrial mode resolves every home flag to false — the mask does not
 * apply there and legacy rendering is untouched.
 *
 * Returns a frozen descriptor:
 *   { mode, base, underlay, furniture,
 *     trades: { electrical, plumbing, hvac },
 *     tradeOnly (base off, at least one trade on),
 *     visibleTradeIds }
 */
export function resolveHomeLayers(mask, options = {}) {
  const mode = normalizeDesignMode(options.mode);
  const isHome = mode === DESIGNER_MODE_HOME;
  const trades = Object.freeze({
    electrical: Boolean(isHome && mask.electrical),
    plumbing: Boolean(isHome && mask.plumbing),
    hvac: Boolean(isHome && mask.hvac),
  });
  const visibleTradeIds = Object.freeze(
    HOME_OVERLAY_TRADES.filter((trade) => trades[trade]),
  );
  return Object.freeze({
    mode,
    base: Boolean(isHome && mask.base),
    underlay: Boolean(isHome && mask.underlay && options.hasUnderlay === true),
    furniture: Boolean(isHome && mask.furniture),
    trades,
    tradeOnly: Boolean(!mask.base && isHome && visibleTradeIds.length > 0),
    visibleTradeIds,
  });
}

/**
 * Visible sheet title for a mask (brief §5: printed masks are reflected in
 * a visible sheet title). Base + trades only — underlay and furniture do
 * not change the title. Trade-only prints omit base geometry unless the
 * base is explicitly selected; that omission is the print slice's job and
 * is signaled by resolveHomeLayers' tradeOnly flag.
 */
export function printMaskTitle(mask) {
  const parts = HOME_OVERLAY_TRADES.filter((trade) => mask[trade]).map(
    (trade) => TRADE_LABELS[trade],
  );
  if (mask.base && parts.length > 0) return `Base + ${parts.join(" + ")}`;
  if (mask.base) return "Base plan";
  if (parts.length === 1) return `${parts[0]} only`;
  if (parts.length > 1) return parts.join(" + ");
  return "No layers selected";
}

/**
 * Freeze a mask for print: a snapshot detached from later screen toggles,
 * carrying its sheet title. Screen toggles after opening the preview
 * cannot silently alter the frozen mask (later set/toggle calls build new
 * mask objects; this snapshot keeps the old values). The snapshot is
 * rebuilt through createHomeLayerMask, so a non-boolean mask is refused
 * here too — a frozen snapshot can never carry a coerced object value
 * that later mutation could change (H679-003).
 */
export function freezeHomePrintMask(mask) {
  const snapshot = createHomeLayerMask({ ...mask });
  return Object.freeze({ mask: snapshot, title: printMaskTitle(snapshot) });
}
