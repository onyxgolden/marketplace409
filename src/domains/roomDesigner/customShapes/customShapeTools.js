/**
 * Bridge: saved shapes → left-palette tools.
 *
 * designerToolbar.js already anticipated this ("future slices (custom
 * reusable shapes …) register their own categories at runtime via
 * registerToolCategory()"), so custom shapes join the palette the documented
 * way instead of the palette learning about shapes.
 *
 * The payoff is that they are ordinary tools: the existing Favorites
 * category, the star button, the collapse state and the keyboard handling all
 * work on them with no special cases. The only thing added is `customShapeId`
 * on the tool def, which the screen reads to arm placement — exactly how
 * `roomTemplate` already works for the room presets.
 */

import { registerToolCategory } from "../designerToolbar";
import { listShapesForDisplay } from "./customShapeLibrary";

export const CUSTOM_SHAPE_CATEGORY_ID = "custom";
export const CUSTOM_SHAPE_CATEGORY_LABEL = "My shapes";

/** Palette tool id for a shape. Stable, so favorites survive reloads. */
export function customShapeToolId(shapeId) {
  return `custom-shape-${shapeId}`;
}

/** The shape id inside a palette tool id, or null when it is not one. */
export function shapeIdFromToolId(toolId) {
  if (typeof toolId !== "string") return null;
  const prefix = "custom-shape-";
  return toolId.startsWith(prefix) ? toolId.slice(prefix.length) : null;
}

function sizeHint(shape) {
  const w = shape.bounds?.widthIn || 0;
  const h = shape.bounds?.heightIn || 0;
  if (!(w > 0) && !(h > 0)) return "";
  return ` (${feet(w)} × ${feet(h)})`;
}

function feet(inches) {
  const ft = inches / 12;
  return Number.isInteger(ft) ? `${ft}'` : `${ft.toFixed(1)}'`;
}

/**
 * Tool defs for every saved shape, favorites first (listShapesForDisplay's
 * order). `icon` is supplied by the caller so this module stays free of React
 * and renders in Node tests.
 */
export function customShapeToolDefs(library, icon) {
  return listShapesForDisplay(library).map((shape) => ({
    id: customShapeToolId(shape.id),
    label: shape.name,
    icon,
    hint: `Click the plan to place "${shape.name}"${sizeHint(shape)}`,
    customShapeId: shape.id,
    // The palette's star reads this so a shape starred in the library shows
    // as starred in the palette without a second source of truth.
    favorite: shape.favorite === true,
  }));
}

/**
 * Register (or refresh) the "My shapes" category so the palette shows the
 * current library. Registering the same id again replaces the previous
 * registration, which is what makes this safe to call on every change.
 */
export function registerCustomShapeCategory(library) {
  const toolIds = listShapesForDisplay(library).map((shape) => customShapeToolId(shape.id));
  registerToolCategory({
    id: CUSTOM_SHAPE_CATEGORY_ID,
    label: CUSTOM_SHAPE_CATEGORY_LABEL,
    toolIds,
  });
  return toolIds;
}
