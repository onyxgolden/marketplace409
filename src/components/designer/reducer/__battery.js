// Shared action battery for the reducer-slice regression test.
const wall0 = (s) => s.design.walls[s.design.walls.length - 1].id;
const room0 = (s) => s.design.rooms[s.design.rooms.length - 1].id;
const furn0 = (s) => s.design.furniture[s.design.furniture.length - 1].id;
const opening0 = (s) => s.design.openings[s.design.openings.length - 1].id;
const pipe0 = (s) => s.design.pipes[s.design.pipes.length - 1].id;
const sym0 = (s) => s.design.symbols[s.design.symbols.length - 1].id;
const chart0 = (s) => s.design.orgCharts[s.design.orgCharts.length - 1].id;
const sheet0 = (s) => s.design.sheets[s.design.sheets.length - 1].id;
const deck0 = (s) => s.design.decks[s.design.decks.length - 1].id;


export const tool_slice_actions_steps = [
      { type: "SET_TOOL", tool: "wall" },
      { type: "SET_TOOL", tool: "nope" },
      { type: "SET_PENDING_CATALOG", catalogId: "sofa-3seat" },
      { type: "SET_PENDING_ROOM", templateId: "bedroom" },
      { type: "SET_PENDING_PIPE", pipe: { diameterIn: 3 } },
      { type: "SET_PENDING_PIPE", pipe: { diameterIn: 99 } },
      { type: "SET_PENDING_CUSTOM_SHAPE", shape: { entities: [], name: "x" } },
      { type: "SET_PENDING_CUSTOM_SHAPE", shape: null },
      { type: "OPEN_OBJECT_LIBRARY", domain: "furniture" },
      { type: "OPEN_OBJECT_LIBRARY", domain: "nope" },
      { type: "SET_PENDING_SYMBOL", domain: "furniture", symbolId: "sofa-3seat" },
      { type: "SET_PENDING_SYMBOL", domain: "furniture", symbolId: "nope" },
      { type: "TOGGLE_ORTHO_SNAP" },
      { type: "TOGGLE_LAYER", layer: "piping" },
      { type: "TOGGLE_LAYER", layer: "nope" },
      { type: "SET_VIEW", view: "3d" },
      { type: "SET_VIEW", view: "split" },
      { type: "SET_VIEW", view: "bogus" },
];

export const selection_slice_actions_steps = [
      { type: "SET_TOOL", tool: "wall" },
      { type: "SELECT_HOUSE" },
      { type: "SELECT", selection: { kind: "wall", id: "w1" } },
      { type: "CLEAR_SELECTION" },
      { type: "TOGGLE_MULTI_SELECT", target: { kind: "furniture", id: "f1" } },
      { type: "TOGGLE_MULTI_SELECT", target: { kind: "furniture", id: "f1" } },
      { type: "TOGGLE_MULTI_SELECT", target: { kind: "wall", id: "w1" } },
      { type: "TOGGLE_MULTI_SELECT", target: null },
];

export const history_slice_actions_steps = [
      { type: "TOUCH" },
      { type: "UNDO" },
      { type: "UNDO" },
      { type: "REDO" },
      { type: "REDO" },
      { type: "MARK_SAVED", savedRevision: 999 },
      (s) => ({ type: "MARK_SAVED", savedRevision: s.designRevision }),
      (s) => ({ type: "LOAD_DESIGN", design: s.design }),
];

export const wall_opening_door_actions_steps = [
      { type: "ADD_WALL", a: { x: 0, y: 0 }, b: { x: 120, y: 0 } },
      { type: "ADD_WALL_RECT", a: { x: 200, y: 0 }, b: { x: 320, y: 96 } },
      (s) => ({ type: "MOVE_WALL_ENDPOINT", wallId: wall0(s), end: "b", point: { x: 130, y: 10 } }),
      (s) => ({ type: "MOVE_WALL", wallId: wall0(s), dx: 5, dy: 5 }),
      (s) => ({ type: "MOVE_WALL", wallId: "nope", dx: 5, dy: 5 }),
      (s) => ({ type: "ADD_OPENING", wallId: wall0(s), openingType: "door", offsetIn: 24, widthIn: 36 }),
      (s) => ({ type: "MOVE_OPENING", openingId: opening0(s), offsetIn: 30 }),
      (s) => ({ type: "MOVE_OPENING_START", openingId: opening0(s), offsetIn: 28 }),
      (s) => ({ type: "RESIZE_OPENING", openingId: opening0(s), widthIn: 40 }),
      (s) => ({ type: "FLIP_DOOR", openingId: opening0(s), part: "hinge" }),
      (s) => ({ type: "FLIP_DOOR", openingId: opening0(s), part: "swing" }),
      (s) => ({ type: "FLIP_DOOR", openingId: opening0(s), part: "bogus" }),
      (s) => ({ type: "FLIP_DOOR", openingId: "nope", part: "hinge" }),
      (s) => ({ type: "SET_WALL_MATERIAL", wallId: wall0(s), material: "Brick" }),
      (s) => ({ type: "SET_WALL_COVERING", wallId: wall0(s), wallCovering: { url: "y" } }),
];

export const room_deck_actions_steps = [
      { type: "ADD_ROOM", templateId: "bedroom", at: { x: 400, y: 400 } },
      (s) => ({ type: "MOVE_ROOM", roomId: room0(s), dx: 10, dy: 0 }),
      (s) => ({ type: "MOVE_ROOM", roomId: "nope", dx: 10, dy: 0 }),
      (s) => ({ type: "RENAME_ROOM", roomId: room0(s), label: "Primary" }),
      (s) => ({ type: "RENAME_ROOM", roomId: "nope", label: "X" }),
      (s) => ({ type: "SET_ROOM_FINISH", roomId: room0(s), finish: "Carpet" }),
      (s) => ({ type: "SET_ROOM_FLOOR_IMAGE", roomId: room0(s), floorImage: { url: "f" } }),
      (s) => ({ type: "DELETE_ROOM", roomId: room0(s) }),
      { type: "ADD_DECK", a: { x: 0, y: 0 }, b: { x: 60, y: 40 } },
      (s) => ({ type: "SET_DECK_MATERIAL", deckId: deck0(s), material: "Wood" }),
      (s) => ({ type: "SET_DECK_DROP", deckId: deck0(s), dropIn: 6 }),
];

export const furniture_actions_steps = [
      { type: "PLACE_FURNITURE", catalogId: "sofa-3seat", x: 50, y: 50, rotationDeg: 0 },
      (s) => ({ type: "MOVE_FURNITURE", furnitureId: furn0(s), x: 60, y: 60 }),
      (s) => ({ type: "ROTATE_FURNITURE", furnitureId: furn0(s), rotationDeg: 90 }),
      (s) => ({ type: "RESIZE_FURNITURE", furnitureId: furn0(s), widthIn: 90, depthIn: 40, heightIn: 36 }),
      (s) => ({ type: "SET_FURNITURE_MOUNT", furnitureId: furn0(s), mountIn: 2 }),
      (s) => ({ type: "RESET_FURNITURE_SIZE", furnitureId: furn0(s) }),
      (s) => ({ type: "SET_FURNITURE_COST", furnitureId: furn0(s), costPerUnit: 19999 }),
      { type: "SAVE_CABINET_ESTIMATE", snapshot: { id: "e1", total: 100 } },
      { type: "DELETE_CABINET_ESTIMATE", snapshotId: "e1" },
      { type: "DELETE_CABINET_ESTIMATE", snapshotId: "nope" },
      { type: "SAVE_CABINET_ESTIMATE", snapshot: null },
];

export const multi_select_align_distribute_steps = [
      { type: "PLACE_FURNITURE", catalogId: "sofa-3seat", x: 10, y: 10 },
      { type: "PLACE_FURNITURE", catalogId: "loveseat", x: 120, y: 10 },
      { type: "PLACE_FURNITURE", catalogId: "armchair", x: 230, y: 10 },
      (s) => ({ type: "TOGGLE_MULTI_SELECT", target: { kind: "furniture", id: s.design.furniture[0].id } }),
      (s) => ({ type: "TOGGLE_MULTI_SELECT", target: { kind: "furniture", id: s.design.furniture[1].id } }),
      { type: "ALIGN_FURNITURE", mode: "left" },
      (s) => ({ type: "TOGGLE_MULTI_SELECT", target: { kind: "furniture", id: s.design.furniture[2].id } }),
      { type: "DISTRIBUTE_FURNITURE" },
      { type: "CLEAR_SELECTION" },
      { type: "ALIGN_FURNITURE", mode: "left" },
];

export const piping_symbol_actions_steps = [
      { type: "ADD_PIPE_RUN", points: [{ x: 0, y: 0 }, { x: 50, y: 50 }] },
      (s) => ({ type: "SET_PIPE_FIELDS", pipeId: pipe0(s), fields: { diameterIn: 3 } }),
      (s) => ({ type: "SET_PIPE_FIELDS", pipeId: "nope", fields: {} }),
      (s) => ({ type: "MOVE_PIPE_VERTEX", pipeId: pipe0(s), index: 1, point: { x: 60, y: 60 } }),
      (s) => ({ type: "MOVE_PIPE_VERTEX", pipeId: "nope", index: 1, point: { x: 1, y: 1 } }),
      { type: "SET_PENDING_SYMBOL", domain: "furniture", symbolId: "sofa-3seat" },
      { type: "PLACE_SYMBOL", x: 100, y: 100 },
      (s) => ({ type: "MOVE_SYMBOL", symbolId: sym0(s), x: 110, y: 110 }),
      (s) => ({ type: "MOVE_SYMBOL", symbolId: "nope", x: 1, y: 1 }),
      (s) => ({ type: "ROTATE_SYMBOL", symbolId: sym0(s), rotationDeg: 45 }),
      (s) => ({ type: "SET_SYMBOL_TAG", symbolId: sym0(s), tag: "P-101" }),
      (s) => ({ type: "SET_SYMBOL_LAYER", symbolId: sym0(s), layer: "equipment" }),
      (s) => ({ type: "SET_SYMBOL_TEMA", symbolId: "nope", config: {} }),
      (s) => ({ type: "SET_SYMBOL_DRAWING_MODE", symbolId: "nope", mode: "detailed" }),
      (s) => ({ type: "SET_SYMBOL_SIZE", symbolId: "nope", widthIn: 10, depthIn: 10 }),
      (s) => ({ type: "REPLACE_WITH_DETAILED", symbolId: "nope" }),
];

export const org_chart_people_actions_steps = [
      { type: "ADD_ORG_CHART", name: "Ops", x: 10, y: 10 },
      (s) => ({ type: "MOVE_ORG_CHART", chartId: chart0(s), x: 20, y: 20 }),
      (s) => ({ type: "MOVE_ORG_CHART", chartId: "nope", x: 1, y: 1 }),
      (s) => ({ type: "RENAME_ORG_CHART", chartId: chart0(s), name: "Ops2" }),
      (s) => ({ type: "ADD_PERSON", chartId: chart0(s), person: { name: "Jane", title: "Mgr" } }),
      (s) => ({ type: "ADD_PERSON", chartId: "nope", person: { name: "X" } }),
      (s) => ({
        type: "UPDATE_PERSON",
        chartId: chart0(s),
        personId: s.design.orgCharts[s.design.orgCharts.length - 1].nodes[0].id,
        fields: { title: "Sr Mgr" },
      }),
      (s) => ({
        type: "SET_PERSON_MANAGER",
        chartId: chart0(s),
        personId: s.design.orgCharts[s.design.orgCharts.length - 1].nodes[0].id,
        managerId: null,
      }),
      (s) => ({
        type: "DELETE_PERSON",
        chartId: chart0(s),
        personId: s.design.orgCharts[s.design.orgCharts.length - 1].nodes[0].id,
      }),
];

export const underlay_calibration_actions_steps = [
      { type: "SET_UNDERLAY", underlay: { name: "u.png", mimeType: "image/png", dataUrl: "data:image/png;base64,AAAA", widthPx: 100, heightPx: 100 } },
      { type: "ADD_CALIBRATION_POINT", point: { x: 1, y: 1 } },
      { type: "ADD_CALIBRATION_POINT", point: { x: 2, y: 2 } },
      { type: "ADD_CALIBRATION_POINT", point: { x: 3, y: 3 } },
      { type: "CLEAR_CALIBRATION" },
      { type: "ADD_CALIBRATION_POINT", point: { x: 1, y: 1 } },
      { type: "ADD_CALIBRATION_POINT", point: { x: 5, y: 5 } },
      { type: "APPLY_CALIBRATION", realDistanceIn: 12 },
      { type: "APPLY_CALIBRATION", realDistanceIn: 12 },
      { type: "UPDATE_UNDERLAY", patch: { opacity: 0.5 } },
      { type: "MOVE_UNDERLAY", x: 5, y: 5 },
      { type: "SET_TOOL", tool: "calibrate" },
      { type: "REMOVE_UNDERLAY" },
      { type: "ADD_CALIBRATION_POINT", point: { x: 1, y: 1 } },
];

export const sheet_actions_steps = [
      { type: "ADD_SHEET", sizeId: "letter", orientation: "landscape", x: 0, y: 0 },
      (s) => ({ type: "MOVE_SHEET", sheetId: sheet0(s), x: 10, y: 10 }),
      (s) => ({ type: "MOVE_SHEET", sheetId: "nope", x: 1, y: 1 }),
      (s) => ({ type: "UPDATE_SHEET_FORMAT", sheetId: sheet0(s), sizeId: "tabloid", orientation: "portrait" }),
      (s) => ({ type: "UPDATE_SHEET", sheetId: sheet0(s), patch: { header: "H" } }),
      (s) => ({ type: "UPDATE_SHEET", sheetId: "nope", patch: {} }),
      { type: "SET_CAMERA_VIEWS", views: [{ id: "v1", name: "Front" }] },
      (s) => ({ type: "DELETE_SHEET", sheetId: sheet0(s) }),
      (s) => ({ type: "DELETE_SHEET", sheetId: "nope" }),
];

export const copy_paste_nudge_delete_flows_steps = [
      { type: "ADD_WALL", a: { x: 0, y: 0 }, b: { x: 120, y: 0 } },
      { type: "PLACE_FURNITURE", catalogId: "sofa-3seat", x: 50, y: 50 },
      (s) => ({ type: "SELECT", selection: { kind: "furniture", id: furn0(s) } }),
      { type: "COPY_SELECTION" },
      { type: "PASTE_CLIPBOARD" },
      { type: "PASTE_CLIPBOARD" },
      { type: "DUPLICATE_SELECTION" },
      { type: "FLIP_SELECTION", axis: "horizontal" },
      { type: "FLIP_SELECTION", axis: "bogus" },
      { type: "NUDGE_SELECTION", dx: 1, dy: 0 },
      { type: "SELECT_HOUSE" },
      { type: "TRANSLATE_HOUSE", dx: 10, dy: 10 },
      { type: "NUDGE_SELECTION", dx: 0, dy: 1 },
      { type: "COPY_SELECTION" },
      { type: "DELETE_SELECTION" },
      { type: "DELETE_SELECTION" },
      (s) => ({ type: "DELETE_OBJECT", target: { kind: "wall", id: s.design.walls[0]?.id } }),
      { type: "DELETE_OBJECT", target: null },
      { type: "DELETE_OBJECT", target: { kind: "bogus", id: "x" } },
      { type: "UNDO" },
      { type: "REDO" },
];

export const custom_shape_import_actions_steps = [
      {
        type: "PLACE_CUSTOM_SHAPE",
        shape: { entities: [{ kind: "note", text: "hi" }], name: "s" },
        x: 10,
        y: 10,
        selectPlaced: true,
      },
      { type: "PLACE_CUSTOM_SHAPE", shape: null, x: 0, y: 0 },
      { type: "IMPORT_VSDX_RESULT", importResult: { records: { walls: [] } } },
      { type: "IMPORT_DXF_RESULT", importResult: { records: { walls: [] } } },
      { type: "IMPORT_DXF_RESULT", importResult: {} },
      { type: "IMPORT_PDF_RESULT", importResult: { mode: "raster", image: { name: "p.png", mimeType: "image/png", dataUrl: "data:image/png;base64,AAAA", widthPx: 10, heightPx: 10 } } },
      { type: "IMPORT_PDF_RESULT", importResult: { mode: "vector", records: { walls: [] } } },
      { type: "IMPORT_PDF_RESULT", importResult: { mode: "raster" } },
      { type: "IMPORT_PDF_RESULT", importResult: null },
      { type: "RENAME", name: "My plan" },
      { type: "UPDATE_SETTINGS", settings: { gridIn: 12 } },
      { type: "UNKNOWN_ACTION_TYPE" },
];

export const BATTERY = [
  ["tool slice actions", tool_slice_actions_steps],
  ["selection slice actions", selection_slice_actions_steps],
  ["history slice actions", history_slice_actions_steps],
  ["wall / opening / door actions", wall_opening_door_actions_steps],
  ["room / deck actions", room_deck_actions_steps],
  ["furniture actions", furniture_actions_steps],
  ["multi-select align / distribute", multi_select_align_distribute_steps],
  ["piping / symbol actions", piping_symbol_actions_steps],
  ["org chart / people actions", org_chart_people_actions_steps],
  ["underlay / calibration actions", underlay_calibration_actions_steps],
  ["sheet actions", sheet_actions_steps],
  ["copy / paste / nudge / delete flows", copy_paste_nudge_delete_flows_steps],
  ["custom shape / import actions", custom_shape_import_actions_steps],
];
