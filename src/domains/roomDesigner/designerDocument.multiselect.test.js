
import {
  addOpening,
  addPipeRun,
  addRoomFromTemplate,
  addWall,
  createEmptyDesign,
  groupDragMembers,
  moveDesignObjects,
  movePipeRun,
  moveWall,
  placeFurniture,
  placeSymbol,
  resetDesignerIds,
} from "./designerDocument";
import "./pipingCatalog"; // registers the piping symbol set

beforeEach(() => resetDesignerIds());

describe("designerDocument — moveWall", () => {
  it("translates both endpoints and lets openings ride along", () => {
    let d = createEmptyDesign("Test");
    d = addWall(d, { x: 0, y: 0 }, { x: 144, y: 0 });
    const wallId = d.walls[0].id;
    d = addOpening(d, wallId, { type: "door", offsetIn: 30, widthIn: 36 });
    d = moveWall(d, wallId, 10, 20);
    const wall = d.walls[0];
    expect(wall.a).toEqual({ x: 10, y: 20 });
    expect(wall.b).toEqual({ x: 154, y: 20 });
    // Openings are stored as along-wall offsets, so they ride untouched.
    expect(d.openings[0].offsetIn).toBe(30);
    expect(d.openings[0].widthIn).toBe(36);
  });

  it("rejects unknown walls and non-finite deltas", () => {
    const d = createEmptyDesign("Test");
    expect(() => moveWall(d, "wall_nope", 1, 1)).toThrow(/Unknown wall/);
    let d2 = addWall(d, { x: 0, y: 0 }, { x: 144, y: 0 });
    expect(() => moveWall(d2, d2.walls[0].id, NaN, 1)).toThrow(/finite/);
  });
});

describe("designerDocument — movePipeRun", () => {
  it("translates every vertex of the run", () => {
    let d = createEmptyDesign("Test");
    d = addPipeRun(d, [
      { x: 0, y: 0 },
      { x: 120, y: 0 },
      { x: 120, y: 60 },
    ]);
    const runId = d.pipes[0].id;
    d = movePipeRun(d, runId, 5, -10);
    expect(d.pipes[0].points).toEqual([
      { x: 5, y: -10 },
      { x: 125, y: -10 },
      { x: 125, y: 50 },
    ]);
  });

  it("rejects unknown runs", () => {
    const d = createEmptyDesign("Test");
    expect(() => movePipeRun(d, "pipe_nope", 1, 1)).toThrow(/Unknown pipe run/);
  });
});

describe("designerDocument — groupDragMembers", () => {
  function mixedDesign() {
    let d = createEmptyDesign("Test");
    d = addRoomFromTemplate(d, "bedroom", { x: 0, y: 0 }); // 144x144 at origin
    d = addWall(d, { x: 300, y: 0 }, { x: 444, y: 0 });
    return d;
  }

  it("skips walls carried by a selected room", () => {
    const d = mixedDesign();
    const roomId = d.rooms[0].id;
    const wallId = d.rooms[0].wallIds[0];
    const group = [
      { kind: "room", id: roomId },
      { kind: "wall", id: wallId },
    ];
    expect(groupDragMembers(d, group)).toEqual([{ kind: "room", id: roomId }]);
  });

  it("skips openings on a wall that moves with the group", () => {
    let d = mixedDesign();
    const wallId = d.walls[d.walls.length - 1].id;
    d = addOpening(d, wallId, { type: "window", offsetIn: 24, widthIn: 48 });
    const openingId = d.openings[0].id;
    // Opening + its wall: the opening rides the wall.
    expect(
      groupDragMembers(d, [
        { kind: "wall", id: wallId },
        { kind: "opening", id: openingId },
      ]),
    ).toEqual([{ kind: "wall", id: wallId }]);
    // Opening on a room-carried wall: the room move carries it too.
    const roomWallId = d.rooms[0].wallIds[0];
    d = addOpening(d, roomWallId, { type: "door", offsetIn: 30, widthIn: 36 });
    const roomOpeningId = d.openings[1].id;
    expect(
      groupDragMembers(d, [
        { kind: "room", id: d.rooms[0].id },
        { kind: "opening", id: roomOpeningId },
      ]),
    ).toEqual([{ kind: "room", id: d.rooms[0].id }]);
  });

  it("keeps an opening whose wall is not in the group", () => {
    let d = mixedDesign();
    const wallId = d.walls[d.walls.length - 1].id;
    d = addOpening(d, wallId, { type: "window", offsetIn: 24, widthIn: 48 });
    const openingId = d.openings[0].id;
    d = placeFurniture(d, "desk", 500, 500);
    const furnitureId = d.furniture[0].id;
    expect(
      groupDragMembers(d, [
        { kind: "opening", id: openingId },
        { kind: "furniture", id: furnitureId },
      ]),
    ).toEqual([
      { kind: "opening", id: openingId },
      { kind: "furniture", id: furnitureId },
    ]);
  });
});

describe("designerDocument — moveDesignObjects (group drag)", () => {
  function groupDesign() {
    let d = createEmptyDesign("Test");
    d = placeFurniture(d, "desk", 100, 100);
    d = placeSymbol(d, "piping", "gate-valve", 200, 100);
    d = addWall(d, { x: 300, y: 0 }, { x: 444, y: 0 });
    d = addPipeRun(d, [
      { x: 0, y: 300 },
      { x: 120, y: 300 },
    ]);
    return d;
  }

  it("translates every member by the same delta, preserving relative offsets", () => {
    let d = groupDesign();
    const [furniture] = d.furniture;
    const [symbol] = d.symbols;
    const [wall] = d.walls;
    const [run] = d.pipes;
    d = moveDesignObjects(d, [
      { kind: "furniture", id: furniture.id, dx: 12, dy: 24 },
      { kind: "symbol", id: symbol.id, dx: 12, dy: 24 },
      { kind: "wall", id: wall.id, dx: 12, dy: 24 },
      { kind: "pipe", id: run.id, dx: 12, dy: 24 },
    ]);
    expect(d.furniture[0].x).toBe(112);
    expect(d.furniture[0].y).toBe(124);
    expect(d.symbols[0].x).toBe(212);
    expect(d.symbols[0].y).toBe(124);
    expect(d.walls[0].a).toEqual({ x: 312, y: 24 });
    expect(d.walls[0].b).toEqual({ x: 456, y: 24 });
    expect(d.pipes[0].points).toEqual([
      { x: 12, y: 324 },
      { x: 132, y: 324 },
    ]);
    // Relative offsets are unchanged.
    expect(d.symbols[0].x - d.furniture[0].x).toBe(100);
    expect(d.walls[0].a.x - d.furniture[0].x).toBe(200);
  });

  it("slides an opening along its wall by the delta's wall-axis projection", () => {
    let d = createEmptyDesign("Test");
    d = addWall(d, { x: 0, y: 0 }, { x: 144, y: 0 });
    const wallId = d.walls[0].id;
    d = addOpening(d, wallId, { type: "door", offsetIn: 30, widthIn: 36 });
    const openingId = d.openings[0].id;
    // A diagonal group delta moves the opening only along the wall.
    d = moveDesignObjects(d, [{ kind: "opening", id: openingId, dx: 12, dy: 24 }]);
    expect(d.openings[0].offsetIn).toBe(42);
    // The wall itself did not move.
    expect(d.walls[0].a).toEqual({ x: 0, y: 0 });
  });

  it("moves a room with its walls exactly once (no double translation)", () => {
    let d = createEmptyDesign("Test");
    d = addRoomFromTemplate(d, "bedroom", { x: 0, y: 0 });
    const roomId = d.rooms[0].id;
    const wallId = d.rooms[0].wallIds[0];
    const moves = groupDragMembers(d, [
      { kind: "room", id: roomId },
      { kind: "wall", id: wallId },
    ]);
    d = moveDesignObjects(
      d,
      moves.map((m) => ({ ...m, dx: 10, dy: 10 })),
    );
    expect(d.walls.find((w) => w.id === wallId).a).toEqual({ x: 10, y: 10 });
    expect(d.rooms[0].polygon[0]).toEqual({ x: 10, y: 10 });
  });

  it("moves a wall shared by two selected rooms only once", () => {
    let d = createEmptyDesign("Test");
    d = addWall(d, { x: 0, y: 0 }, { x: 100, y: 0 }, { id: "shared" });
    d = addRoomFromTemplate(d, "bedroom", { x: 200, y: 200 });
    const roomA = d.rooms[0].id;
    // Both rooms genuinely reference the shared wall, so a group drag
    // contributes its delta twice — the wall must still move exactly once.
    d = {
      ...d,
      rooms: [
        { ...d.rooms[0], wallIds: [...(d.rooms[0].wallIds || []), "shared"] },
        { id: `room_shared`, label: "Extra", wallIds: ["shared"], polygon: [] },
      ],
    };
    const roomB = `room_shared`;
    d = moveDesignObjects(d, [
      { kind: "room", id: roomA, dx: 10, dy: 0 },
      { kind: "room", id: roomB, dx: 10, dy: 0 },
    ]);
    // Not (20, 0): the shared wall translates once per gesture.
    expect(d.walls.find((w) => w.id === "shared").a).toEqual({ x: 10, y: 0 });
    expect(d.walls.find((w) => w.id === "shared").b).toEqual({ x: 110, y: 0 });
  });

  it("rejects unknown members, unknown kinds, and non-finite deltas", () => {
    const d = createEmptyDesign("Test");
    expect(() => moveDesignObjects(d, [{ kind: "furniture", id: "nope", dx: 1, dy: 1 }])).toThrow(
      /Unknown furniture/,
    );
    expect(() => moveDesignObjects(d, [{ kind: "ufo", id: "x", dx: 1, dy: 1 }])).toThrow(
      /Cannot group-move/,
    );
    expect(() => moveDesignObjects(d, "nope")).toThrow(/array/);
  });

  it("ignores zero deltas and empty move lists", () => {
    let d = groupDesign();
    const before = d;
    d = moveDesignObjects(d, []);
    expect(d).toBe(before);
    const furnitureId = d.furniture[0].id;
    d = moveDesignObjects(d, [{ kind: "furniture", id: furnitureId, dx: 0, dy: 0 }]);
    expect(d.furniture[0].x).toBe(100);
  });
});
