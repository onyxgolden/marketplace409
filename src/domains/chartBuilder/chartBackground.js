// FORGE Chart Builder — PowerPoint-style canvas background catalog (slice 2).
// Framework-neutral: presets are pure data. The chart document stores only
// the preset id; CSS rendering is a UI concern in src/components/chartBuilder.
// Backgrounds travel with the document so future export slices can reproduce
// them exactly. Preset ids are never invented: unknown ids are rejected.

export const CHART_BACKGROUND_CATEGORIES = Object.freeze([
  "solid",
  "gradient",
  "pattern",
]);

export const CHART_BACKGROUNDS = Object.freeze([
  Object.freeze({
    id: "white",
    name: "White",
    category: "solid",
    css: "#ffffff",
    ink: "dark",
  }),
  Object.freeze({
    id: "warm-paper",
    name: "Warm paper",
    category: "solid",
    css: "#faf6ee",
    ink: "dark",
  }),
  Object.freeze({
    id: "slate",
    name: "Slate",
    category: "solid",
    css: "#0f172a",
    ink: "light",
  }),
  Object.freeze({
    id: "sunrise",
    name: "Sunrise",
    category: "gradient",
    css: "linear-gradient(135deg, #fef3c7 0%, #fdba74 55%, #f472b6 100%)",
    ink: "dark",
  }),
  Object.freeze({
    id: "ocean",
    name: "Ocean",
    category: "gradient",
    css: "linear-gradient(135deg, #0c4a6e 0%, #0284c7 60%, #7dd3fc 100%)",
    ink: "light",
  }),
  Object.freeze({
    id: "evergreen",
    name: "Evergreen",
    category: "gradient",
    css: "linear-gradient(135deg, #052e16 0%, #166534 60%, #4ade80 100%)",
    ink: "light",
  }),
  Object.freeze({
    id: "graphite",
    name: "Graphite",
    category: "gradient",
    css: "linear-gradient(135deg, #1e293b 0%, #020617 100%)",
    ink: "light",
  }),
  Object.freeze({
    id: "dot-grid",
    name: "Dot grid",
    category: "pattern",
    css: "radial-gradient(rgba(15,23,42,0.16) 1.2px, transparent 1.2px), #f8fafc",
    backgroundSize: "24px 24px",
    ink: "dark",
  }),
  Object.freeze({
    id: "blueprint",
    name: "Blueprint",
    category: "pattern",
    css: "repeating-linear-gradient(0deg, rgba(255,255,255,0.09) 0 1px, transparent 1px 26px), repeating-linear-gradient(90deg, rgba(255,255,255,0.09) 0 1px, transparent 1px 26px), #1d4ed8",
    ink: "light",
  }),
]);

export const DEFAULT_CHART_BACKGROUND = "white";

export function getChartBackground(id) {
  return CHART_BACKGROUNDS.find((preset) => preset.id === id) ?? null;
}

export function isValidChartBackgroundId(id) {
  return typeof id === "string" && getChartBackground(id) !== null;
}

export function listChartBackgroundsByCategory(category) {
  return CHART_BACKGROUNDS.filter((preset) => preset.category === category);
}
