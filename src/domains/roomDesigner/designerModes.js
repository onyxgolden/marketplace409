// Home vs Industrial mode configuration for the FORGE designer.
//
// One mode per design project (design.mode, default "home"). Each mode is a
// clean workspace: the left tool palette shows only that mode's tool
// categories, and the object library dropdown shows only that mode's symbol
// domains. Shared editing machinery (canvas, 2D/3D view, undo/redo, levels,
// annotations, selection, save/open, DXF export) is identical in both modes.
//
// This module is pure data + predicates — no React, no registry imports —
// so the screen, the reducer, and tests can all share it. Category ids refer
// to designerToolbar TOOL_CATEGORIES; domain ids refer to symbolRegistry
// symbol sets. A trailing "*" on a category id is a prefix wildcard
// (covers the generated "house-<furniture category>" groups).

export const DESIGNER_MODE_HOME = "home";
export const DESIGNER_MODE_INDUSTRIAL = "industrial";

export const DESIGNER_MODES = Object.freeze({
  [DESIGNER_MODE_HOME]: Object.freeze({
    id: DESIGNER_MODE_HOME,
    label: "Home",
    // Left-palette tool categories: structure shell, home fixtures,
    // room presets, and the shared plan tools.
    toolCategories: Object.freeze(["house", "house-*", "rooms", "plan"]),
    // Object-library symbol domains: home furnishings, building shell,
    // site/outdoor, and residential MEP fixtures.
    libraryDomains: Object.freeze([
      "furniture",
      "buildingElements",
      "siteOutdoor",
      "mepFixtures",
    ]),
  }),
  [DESIGNER_MODE_INDUSTRIAL]: Object.freeze({
    id: DESIGNER_MODE_INDUSTRIAL,
    label: "Industrial",
    // Left-palette tool categories: site structures, piping/mechanical,
    // process equipment, and the shared plan tools.
    toolCategories: Object.freeze(["structures", "mechanical", "process", "plan"]),
    // Object-library symbol domains: process equipment, piping, plus the
    // shared building-shell and site/outdoor domains for plot context.
    libraryDomains: Object.freeze([
      "processEquipment",
      "piping",
      "buildingElements",
      "siteOutdoor",
    ]),
  }),
});

export const DESIGNER_MODE_IDS = Object.freeze([
  DESIGNER_MODE_HOME,
  DESIGNER_MODE_INDUSTRIAL,
]);

/** Unknown/missing modes fall back to home — existing projects saved before
 * modes existed open with zero behavior change. */
export function normalizeDesignMode(mode) {
  return mode === DESIGNER_MODE_INDUSTRIAL
    ? DESIGNER_MODE_INDUSTRIAL
    : DESIGNER_MODE_HOME;
}

export function modeConfig(mode) {
  return DESIGNER_MODES[normalizeDesignMode(mode)];
}

export function designModeOf(design) {
  return normalizeDesignMode(design?.mode);
}

/** Returns a new design document with the mode set (validated). */
export function setDesignMode(design, mode) {
  return { ...design, mode: normalizeDesignMode(mode) };
}

/** Category-id matching with trailing-"*" prefix wildcards. */
export function categoryVisibleInMode(categoryId, mode) {
  const patterns = modeConfig(mode).toolCategories;
  return patterns.some((pattern) =>
    pattern.endsWith("*")
      ? String(categoryId).startsWith(pattern.slice(0, -1))
      : categoryId === pattern,
  );
}

export function domainVisibleInMode(domain, mode) {
  return modeConfig(mode).libraryDomains.includes(domain);
}
