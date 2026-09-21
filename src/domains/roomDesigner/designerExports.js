// Clean data seam for future consumers (scheduler, cost tools).
//
// This module is the ONLY sanctioned way for other apps to read a room
// design: it projects the document down to plain estimating facts —
// rooms with areas, total wall length, openings count — with no editor
// internals leaking through. Nothing here imports from /forge.

import { polygonArea } from "./designerGeometry";
import { totalRoomAreaSqFt, totalWallLengthIn } from "./designerDocument";
import { pipeLengthByDiameter, pipeRunLengthIn } from "./pipingGeometry";

/**
 * Estimating summary of a design, safe to hand to the scheduling or cost
 * modules later. All areas in square feet, lengths in inches.
 */
export function summarizeDesignForEstimating(design) {
  if (!design || !Array.isArray(design.walls)) {
    throw new Error("Not a room-designer document.");
  }
  const rooms = (design.rooms || []).map((room) => ({
    id: room.id,
    label: room.label,
    areaSqFt: Math.round((polygonArea(room.polygon) / 144) * 100) / 100,
  }));
  const openings = (design.openings || []).map((opening) => ({
    id: opening.id,
    type: opening.type,
    widthIn: opening.widthIn,
  }));
  // Piping (Phase 2): runs with lengths derived from geometry, grouped by
  // nominal diameter for material takeoffs — plain data, no editor state.
  const pipeRuns = (design.pipes || []).map((run) => ({
    id: run.id,
    diameterIn: run.diameterIn,
    material: run.material || null,
    service: run.service || null,
    layer: run.layer,
    lengthIn: Math.round(pipeRunLengthIn(run.points) * 100) / 100,
  }));
  const pipeLengthByDiameterIn = {};
  for (const [diameter, lengthIn] of Object.entries(pipeLengthByDiameter(design.pipes))) {
    pipeLengthByDiameterIn[diameter] = Math.round(lengthIn * 100) / 100;
  }
  return {
    designName: design.name,
    version: design.version,
    wallHeightIn: design.settings?.wallHeightIn ?? 108,
    wallThicknessIn: design.settings?.wallThicknessIn ?? 4.5,
    rooms,
    roomCount: rooms.length,
    totalRoomAreaSqFt: Math.round(totalRoomAreaSqFt(design) * 100) / 100,
    totalWallLengthIn: Math.round(totalWallLengthIn(design) * 100) / 100,
    wallCount: design.walls.length,
    openings,
    openingCount: openings.length,
    doorCount: openings.filter((o) => o.type === "door").length,
    windowCount: openings.filter((o) => o.type === "window").length,
    furnitureCount: (design.furniture || []).length,
    pipeRuns,
    pipeRunCount: pipeRuns.length,
    pipeLengthByDiameterIn,
    pipingSymbolCount: (design.symbols || []).length,
  };
}
