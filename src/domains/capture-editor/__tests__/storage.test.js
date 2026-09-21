import { describe, expect, it } from "vitest";
import {
  StorageError,
  clearDraft,
  createProjectStore,
  deleteProject,
  listProjects,
  loadProject,
  recoverDraft,
  saveDraft,
  saveProject,
} from "../storage.js";
import { CorruptProjectError } from "../schema.js";
import { addAnnotation, createDocument } from "../document.js";
import { createAnnotation } from "../annotations.js";

function memoryAdapter() {
  const mem = new Map();
  return {
    getItem: (key) => (mem.has(key) ? mem.get(key) : null),
    setItem: (key, value) => {
      mem.set(key, String(value));
    },
    removeItem: (key) => {
      mem.delete(key);
    },
    keys: () => [...mem.keys()],
    _mem: mem,
  };
}

function makeDoc(id = "store-doc-1") {
  let doc = createDocument({
    id,
    width: 64,
    height: 64,
    source: { kind: "embedded", mime: "image/png", bytes: "aGVsbG8=" },
  });
  doc = addAnnotation(doc, createAnnotation("rectangle", { x: 1, y: 2, w: 8, h: 8 }));
  return doc;
}

describe("createProjectStore", () => {
  it("rejects adapters that do not implement the contract", () => {
    expect(() => createProjectStore(null)).toThrow(StorageError);
    expect(() => createProjectStore({})).toThrow(StorageError);
    expect(() => createProjectStore({ getItem() {}, setItem() {}, removeItem() {} })).toThrow(StorageError);
  });

  it("wraps adapter failures as StorageError", () => {
    const failing = {
      getItem: () => { throw new Error("denied"); },
      setItem: () => { throw new Error("denied"); },
      removeItem: () => { throw new Error("denied"); },
      keys: () => { throw new Error("denied"); },
    };
    const store = createProjectStore(failing);
    const doc = makeDoc();
    expect(() => saveProject(store, doc)).toThrow(StorageError);
    expect(() => loadProject(store, "x")).toThrow(StorageError);
    expect(() => listProjects(store)).toThrow(StorageError);
    expect(() => deleteProject(store, "x")).toThrow(StorageError);
  });
});

describe("save/load/delete/list", () => {
  it("round-trips a document deterministically", () => {
    const adapter = memoryAdapter();
    const store = createProjectStore(adapter);
    const doc = makeDoc();
    expect(saveProject(store, doc)).toBe(doc.id);
    const loaded = loadProject(store, doc.id);
    expect(loaded.id).toBe(doc.id);
    expect(loaded.annotations).toHaveLength(1);
    expect(loaded.annotations[0].geometry).toEqual({ x: 1, y: 2, w: 8, h: 8 });
    // Deterministic: the same document always persists the same bytes.
    const before = adapter._mem.get(`forge.capture.project.${doc.id}`);
    saveProject(store, doc);
    expect(adapter._mem.get(`forge.capture.project.${doc.id}`)).toBe(before);
  });

  it("returns null for a missing project", () => {
    const store = createProjectStore(memoryAdapter());
    expect(loadProject(store, "nope")).toBeNull();
  });

  it("lists and deletes projects", () => {
    const adapter = memoryAdapter();
    const store = createProjectStore(adapter);
    adapter.setItem("unrelated-key", "x");
    saveProject(store, makeDoc("a"));
    saveProject(store, makeDoc("b"));
    expect(listProjects(store)).toEqual(["a", "b"]);
    deleteProject(store, "a");
    expect(listProjects(store)).toEqual(["b"]);
    expect(loadProject(store, "a")).toBeNull();
  });

  it("rejects empty project ids", () => {
    const store = createProjectStore(memoryAdapter());
    expect(() => loadProject(store, "")).toThrow(StorageError);
  });

  it("never partially returns a corrupt saved project", () => {
    const adapter = memoryAdapter();
    const store = createProjectStore(adapter);
    const doc = makeDoc();
    saveProject(store, doc);
    adapter.setItem(
      `forge.capture.project.${doc.id}`,
      JSON.stringify({
        schemaVersion: 1,
        kind: "forge-capture-project",
        id: doc.id,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
        canvas: { width: 64, height: 64 },
        source: doc.source,
        annotations: [
          { id: "ok", type: "rectangle", z: 0, geometry: { x: 1, y: 1, w: 4, h: 4 }, style: {}, locked: false },
          { id: "bad", type: "mystery", z: 1, geometry: {}, style: {}, locked: false },
        ],
      }),
    );
    expect(() => loadProject(store, doc.id)).toThrow(CorruptProjectError);
  });
});

describe("recoverable draft", () => {
  it("saves and recovers a draft", () => {
    const store = createProjectStore(memoryAdapter());
    const doc = makeDoc();
    saveDraft(store, doc);
    const result = recoverDraft(store);
    expect(result.status).toBe("ok");
    expect(result.doc.id).toBe(doc.id);
    expect(result.doc.annotations).toHaveLength(1);
  });

  it("reports missing when there is no draft", () => {
    const store = createProjectStore(memoryAdapter());
    expect(recoverDraft(store)).toEqual({ status: "missing" });
  });

  it("reports corrupt instead of throwing — and never hands back a partial doc", () => {
    const adapter = memoryAdapter();
    const store = createProjectStore(adapter);
    const doc = makeDoc();
    saveDraft(store, doc);
    adapter.setItem("forge.capture.draft", '{"schemaVersion": 1, "kind": "forge-capture-project", "broken": ');
    const result = recoverDraft(store);
    expect(result.status).toBe("corrupt");
    expect(result.error).toBeDefined();
    expect(result.doc).toBeUndefined();
    // The caller's document is untouched by construction.
    expect(doc.annotations).toHaveLength(1);
    // The corrupt draft is left in place, never silently deleted.
    expect(adapter.getItem("forge.capture.draft")).not.toBeNull();
  });

  it("rejects a draft whose body fails validation", () => {
    const adapter = memoryAdapter();
    const store = createProjectStore(adapter);
    adapter.setItem(
      "forge.capture.draft",
      JSON.stringify({ schemaVersion: 1, kind: "forge-capture-project", id: "x" }),
    );
    expect(recoverDraft(store).status).toBe("corrupt");
  });

  it("clears the draft", () => {
    const adapter = memoryAdapter();
    const store = createProjectStore(adapter);
    saveDraft(store, makeDoc());
    clearDraft(store);
    expect(recoverDraft(store).status).toBe("missing");
  });

  it("reports adapter read errors as status error, never throws", () => {
    const store = createProjectStore({
      getItem: () => { throw new Error("denied"); },
      setItem: () => {},
      removeItem: () => {},
      keys: () => [],
    });
    const result = recoverDraft(store);
    expect(result.status).toBe("error");
  });
});
