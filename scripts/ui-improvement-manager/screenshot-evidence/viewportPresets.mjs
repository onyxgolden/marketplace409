// Fixed, deterministic viewport set for FB-UI-1 (FORGE_BRAIN_AUTONOMOUS_REPAIR_DESIGN.md-style
// checkpoint FB-UI-1: "smallest deterministic screenshot-evidence foundation"). Named presets only --
// never an arbitrary caller-supplied width/height -- so two capture runs of the same route always
// produce the same three viewports, and a manifest's `viewport` field is always one of these three
// stable names, never a raw pixel pair that could silently drift between runs.

export const VIEWPORT_PRESETS = Object.freeze({
  desktop: Object.freeze({ name: "desktop", width: 1440, height: 900, deviceScaleFactor: 1 }),
  tablet: Object.freeze({ name: "tablet", width: 834, height: 1194, deviceScaleFactor: 1 }),
  mobile: Object.freeze({ name: "mobile", width: 390, height: 844, deviceScaleFactor: 1 }),
});

export const VIEWPORT_NAMES = Object.freeze(Object.keys(VIEWPORT_PRESETS));

export function getViewportPreset(name) {
  const preset = VIEWPORT_PRESETS[name];
  if (!preset) throw new Error(`Unknown viewport preset "${name}" -- must be one of ${VIEWPORT_NAMES.join(", ")}`);
  return preset;
}
