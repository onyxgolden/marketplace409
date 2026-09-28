import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { buildThreeScene } from "./designerThreeModel";
import {
  IN_TO_M,
  exportDesignToGlb,
  glbFileName,
  sceneDescriptorsToThree,
  validateForGlb,
} from "./designerGlbModel";

// r186 GLTFExporter serializes the binary GLB through FileReader, which
// does not exist in the node test environment (browsers have it natively).
// Minimal polyfill: the exporter only uses readAsArrayBuffer + onloadend.
if (typeof FileReader === "undefined") {
  globalThis.FileReader = class {
    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then((buf) => {
        this.result = buf;
        if (this.onloadend) this.onloadend();
      });
    }
  };
}

const wall = (id, x1, y1, x2, y2) => ({ id, a: { x: x1, y: y1 }, b: { x: x2, y: y2 } });

const baseDesign = () => ({
  name: "Maplewood",
  version: 1,
  settings: { wallHeightIn: 108, wallThicknessIn: 4.5 },
  walls: [wall("wall_1", 0, 0, 120, 0), wall("wall_2", 0, 0, 0, 96)],
  openings: [{ id: "opening_1", wallId: "wall_1", type: "window", offsetIn: 24, widthIn: 36 }],
  furniture: [{ id: "furniture_1", catalogId: "sofa-3seat", x: 60, y: 48, rotationDeg: 0 }],
  rooms: [{ id: "room_1", label: "Living", wallIds: ["wall_1", "wall_2"] }],
});

const meshByName = (group, name) => {
  let found = null;
  group.traverse((o) => {
    if (o.name === name) found = o;
  });
  return found;
};

const allNames = (group) => {
  const names = [];
  group.traverse((o) => names.push(o.name));
  return names;
};

describe("designerGlbModel — descriptor to mesh mapping", () => {
  it("maps a wall segment to a BoxGeometry with the viewport's transform math", () => {
    const scene = buildThreeScene(baseDesign());
    const { group } = sceneDescriptorsToThree(scene, { includeFloor: false, includeFurniture: false });
    // wall_1 has a window at offset 24 width 36 -> first solid segment is [0,24].
    const mesh = meshByName(group, "forge_wall_wall_1_seg1");
    expect(mesh).not.toBeNull();
    expect(mesh.geometry).toBeInstanceOf(THREE.BoxGeometry);
    expect(mesh.geometry.parameters.width).toBe(24);
    expect(mesh.geometry.parameters.height).toBe(108);
    expect(mesh.geometry.parameters.depth).toBe(4.5);
    expect(mesh.position.x).toBe(12);
    expect(mesh.position.y).toBe(54);
    expect(mesh.position.z).toBe(0);
    // horizontal wall: atan2(0, 24) = 0 -> rotation.y = -0
    expect(mesh.rotation.y).toBe(-0);
  });

  it("keeps the -atan2 sign convention on vertical walls", () => {
    const scene = buildThreeScene(baseDesign());
    const { group } = sceneDescriptorsToThree(scene, { includeFloor: false, includeFurniture: false });
    const mesh = meshByName(group, "forge_wall_wall_2_seg1");
    expect(mesh).not.toBeNull();
    expect(mesh.geometry.parameters.width).toBe(96);
    // atan2(96, 0) = PI/2 -> rotation.y = -PI/2
    expect(mesh.rotation.y).toBeCloseTo(-Math.PI / 2, 10);
  });

  it("maps window glass to a plane with the wall transform", () => {
    const scene = buildThreeScene(baseDesign());
    const { group } = sceneDescriptorsToThree(scene, { includeFloor: false, includeFurniture: false });
    const glass = meshByName(group, "forge_opening_opening_1_glass");
    expect(glass).not.toBeNull();
    expect(glass.geometry).toBeInstanceOf(THREE.PlaneGeometry);
    expect(glass.geometry.parameters.width).toBe(36);
    expect(glass.position.x).toBe(42);
  });
});

describe("designerGlbModel — units and axes", () => {
  it("scales the export root by exactly 0.0254 (inches -> meters)", () => {
    const scene = buildThreeScene(baseDesign());
    const { group } = sceneDescriptorsToThree(scene, { includeFloor: false, includeFurniture: false });
    expect(group.scale.x).toBe(IN_TO_M);
    expect(group.scale.y).toBe(IN_TO_M);
    expect(group.scale.z).toBe(IN_TO_M);
    expect(IN_TO_M).toBe(0.0254);
  });

  it("measures a 120-inch wall as 3.048 m in the scaled scene", () => {
    const design = baseDesign();
    design.walls = [wall("wall_1", 0, 0, 120, 0)];
    design.openings = [];
    design.furniture = [];
    design.rooms = [];
    const scene = buildThreeScene(design);
    const { group } = sceneDescriptorsToThree(scene, { includeFloor: false, includeFurniture: false });
    const box = new THREE.Box3().setFromObject(group);
    const size = new THREE.Vector3();
    box.getSize(size);
    expect(size.x).toBeCloseTo(3.048, 6);
  });

  it("maps plan (x, y) to three.js (x, +z) with no flip", () => {
    const design = baseDesign();
    design.walls = [wall("wall_1", 10, 20, 30, 20)];
    design.openings = [];
    design.furniture = [];
    design.rooms = [];
    const scene = buildThreeScene(design);
    const { group } = sceneDescriptorsToThree(scene, { includeFloor: false, includeFurniture: false });
    const mesh = meshByName(group, "forge_wall_wall_1_seg1");
    expect(mesh.position.x).toBe(20);
    expect(mesh.position.z).toBe(20);
  });
});

describe("designerGlbModel — hierarchy and naming", () => {
  it("uses forge_<kind>_<id> names and keeps them unique", () => {
    const scene = buildThreeScene(baseDesign());
    const { group } = sceneDescriptorsToThree(scene, { rooms: baseDesign().rooms });
    const names = allNames(group).filter(Boolean);
    expect(names).toContain("forge_wall_wall_1_seg1");
    expect(names).toContain("forge_opening_opening_1_glass");
    expect(names).toContain("forge_furniture_furniture_1");
    expect(names).toContain("forge_floor");
    expect(names).toContain("forge_room_room_1");
    expect(new Set(names).size).toBe(names.length);
  });

  it("exports rooms as empty groups carrying label and wallIds in userData", () => {
    const scene = buildThreeScene(baseDesign());
    const { group } = sceneDescriptorsToThree(scene, { rooms: baseDesign().rooms });
    const room = meshByName(group, "forge_room_room_1");
    expect(room).not.toBeNull();
    expect(room.isGroup).toBe(true);
    expect(room.children.length).toBe(0);
    expect(room.userData.label).toBe("Living");
    expect(room.userData.wallIds).toEqual(["wall_1", "wall_2"]);
  });

  it("omits empty geometry groups but keeps the rooms group", () => {
    const design = baseDesign();
    design.furniture = [];
    design.rooms = [];
    const scene = buildThreeScene(design);
    const { group } = sceneDescriptorsToThree(scene, { includeFurniture: false });
    const names = allNames(group);
    expect(names.some((n) => n === "furniture")).toBe(false);
    expect(names.some((n) => n === "rooms")).toBe(false);
    expect(names.some((n) => n === "walls")).toBe(true);
  });

  it("snapshots the hierarchy for a fixed fixture (renames break loudly)", () => {
    const scene = buildThreeScene(baseDesign());
    const { group } = sceneDescriptorsToThree(scene, { rooms: baseDesign().rooms });
    expect(allNames(group).filter(Boolean).sort()).toMatchSnapshot();
  });
});

describe("designerGlbModel — materials", () => {
  it("dedupes materials: 50 white walls produce 1 material", () => {
    const design = baseDesign();
    design.walls = Array.from({ length: 50 }, (_, i) => wall(`wall_${i}`, i * 200, 0, i * 200 + 120, 0));
    design.openings = [];
    design.furniture = [];
    design.rooms = [];
    const scene = buildThreeScene(design);
    const { group, stats } = sceneDescriptorsToThree(scene, { includeFloor: false, includeFurniture: false });
    expect(stats.materials).toBe(1);
    const mats = new Set();
    group.traverse((o) => {
      if (o.isMesh) mats.add(o.material);
    });
    expect(mats.size).toBe(1);
  });

  it("marks window glass transparent", () => {
    const scene = buildThreeScene(baseDesign());
    const { group } = sceneDescriptorsToThree(scene, { includeFloor: false, includeFurniture: false });
    const glass = meshByName(group, "forge_opening_opening_1_glass");
    expect(glass.material.transparent).toBe(true);
    expect(glass.material.opacity).toBeCloseTo(0.22, 5);
  });
});

describe("designerGlbModel — validation", () => {
  it("rejects non-documents", () => {
    expect(validateForGlb(null)).toEqual(["Not a room-designer document."]);
    expect(validateForGlb({})).toEqual(["Not a room-designer document."]);
  });

  it("rejects an empty design", () => {
    expect(validateForGlb({ walls: [], furniture: [], equipment: [] })).toEqual([
      "Nothing to export — add walls or furniture first.",
    ]);
  });

  it("rejects non-finite coordinates", () => {
    const design = baseDesign();
    design.walls = [wall("wall_1", NaN, 0, 120, 0)];
    expect(validateForGlb(design)).toEqual([
      "Design contains invalid coordinates — fix them and try again.",
    ]);
  });

  it("rejects non-positive wall height or thickness", () => {
    const design = baseDesign();
    design.settings = { wallHeightIn: 0, wallThicknessIn: 4.5 };
    expect(validateForGlb(design)).toEqual([
      "Wall height and thickness must be positive (check Settings).",
    ]);
  });

  it("accepts a valid design", () => {
    expect(validateForGlb(baseDesign())).toEqual([]);
  });
});

describe("designerGlbModel — file naming", () => {
  const when = new Date(2026, 8, 28); // months are 0-based

  it("sanitizes like dxfFileName and appends .glb", () => {
    expect(glbFileName("a/b", when)).toBe("a-b-20260928.glb");
  });

  it("falls back to 'design' for a blank name", () => {
    expect(glbFileName("", when)).toBe("design-20260928.glb");
    expect(glbFileName(null, when)).toBe("design-20260928.glb");
  });
});

describe("designerGlbModel — skip accounting", () => {
  it("counts unknown-catalog furniture as skipped and still succeeds", async () => {
    const design = baseDesign();
    design.furniture = [{ id: "furniture_x", catalogId: "nope-not-real", x: 10, y: 10, rotationDeg: 0 }];
    const res = await exportDesignToGlb(design);
    expect(res.ok).toBe(true);
    expect(res.stats.skipped).toBeGreaterThanOrEqual(1);
    expect(res.stats.furniture).toBe(0);
  });

  it("skips degenerate wall segments without erroring", () => {
    // A segment that reaches the builder but measures under 0.5" is
    // skipped and counted, never thrown.
    const scene = {
      walls: [
        { a: { x: 0, y: 0 }, b: { x: 0.1, y: 0 }, y0In: 0, y1In: 108, thicknessIn: 4.5, wallId: "w1", kind: "wall" },
        { a: { x: 0, y: 0 }, b: { x: 120, y: 0 }, y0In: 0, y1In: 108, thicknessIn: 4.5, wallId: "w2", kind: "wall" },
      ],
      glass: [],
      furniture: [],
    };
    const { group, stats } = sceneDescriptorsToThree(scene);
    expect(stats.skipped).toBe(1);
    expect(stats.wallSegments).toBe(1);
    expect(meshByName(group, "forge_wall_w2_seg1")).not.toBeNull();
  });
});

describe("designerGlbModel — GLB integration", () => {
  it("serializes to a binary GLB with parseable JSON", async () => {
    const res = await exportDesignToGlb(baseDesign());
    expect(res.ok).toBe(true);
    expect(res.glb).toBeInstanceOf(ArrayBuffer);
    // magic bytes "glTF"
    expect(String.fromCharCode(...new Uint8Array(res.glb.slice(0, 4)))).toBe("glTF");
    const view = new DataView(res.glb);
    const jsonLength = view.getUint32(12, true);
    const json = JSON.parse(
      new TextDecoder().decode(new Uint8Array(res.glb.slice(20, 20 + jsonLength))),
    );
    const names = (json.nodes || []).map((n) => n.name);
    expect(names).toContain("forge_wall_wall_1_seg1");
    expect(names).toContain("forge_furniture_furniture_1");
    // unit/axis convention travels on the root node extras
    const root = json.nodes.find((n) => n.name.startsWith("forge_design_"));
    expect(root.extras.forgeUnits).toBe("m");
    expect(root.extras.forgeSourceUnits).toBe("in");
    // glass serializes with alpha blending
    const glassMat = (json.materials || []).find((m) => m.alphaMode === "BLEND");
    expect(glassMat).toBeDefined();
    expect(res.stats.bytes).toBe(res.glb.byteLength);
    expect(res.stats.meshes).toBeGreaterThan(0);
  });

  it("returns the first validation problem instead of throwing", async () => {
    const res = await exportDesignToGlb({ walls: [] });
    expect(res.ok).toBe(false);
    expect(res.error).toBe("Nothing to export — add walls or furniture first.");
  });
});
