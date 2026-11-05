// FORGE Doc-to-Overview — slice A: private draft storage tests.
// Real filesystem, temp directory, deterministic assertions on content.

import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createDraftStore } from "./draftStore.js";

function tempRoot() {
  return mkdtempSync(path.join(tmpdir(), "doc-overview-store-"));
}

const manifest = {
  id: "manifest_1",
  name: "Biology primers",
  version: 1,
  ownerId: "owner-1",
  documents: [],
  sourceSetHash: "c".repeat(64),
  humanClassifications: [],
};

const artifact = {
  id: "artifact_1",
  sourceSetId: "manifest_1",
  type: "explainer",
  status: "draft",
  version: 1,
};

describe("createDraftStore", () => {
  it("round-trips manifests and drafts, and reload preserves them across instances", () => {
    const root = tempRoot();
    const first = createDraftStore(root);
    first.saveSourceSet("owner-1", manifest);
    first.saveDraft("owner-1", artifact);
    expect(first.getSourceSet("owner-1", "manifest_1")).toEqual(manifest);
    expect(first.getDraft("owner-1", "artifact_1")).toEqual(artifact);
    expect(first.listSourceSets("owner-1")).toEqual(["manifest_1"]);
    expect(first.listDrafts("owner-1")).toEqual(["artifact_1"]);

    const second = createDraftStore(root);
    expect(second.getSourceSet("owner-1", "manifest_1")).toEqual(manifest);
    expect(second.getDraft("owner-1", "artifact_1")).toEqual(artifact);
  });

  it("is owner-scoped and non-disclosing: another owner sees nothing", () => {
    const root = tempRoot();
    const store = createDraftStore(root);
    store.saveSourceSet("owner-1", manifest);
    store.saveDraft("owner-1", artifact);
    expect(store.getSourceSet("owner-2", "manifest_1")).toBeNull();
    expect(store.getDraft("owner-2", "artifact_1")).toBeNull();
    expect(store.listSourceSets("owner-2")).toEqual([]);
    expect(store.listDrafts("owner-2")).toEqual([]);
    expect(store.getSourceSet("owner-1", "missing")).toBeNull();
  });

  it("refuses traversal in owner and record IDs before touching the filesystem", () => {
    const root = tempRoot();
    const store = createDraftStore(root);
    expect(() => store.saveSourceSet("../evil", manifest)).toThrow();
    expect(() => store.getDraft("owner-1", "../../etc/passwd")).toThrow();
    expect(() => store.saveDraft("owner-1", { ...artifact, id: ".hidden" })).toThrow();
  });

  it("fails loud on a malformed record instead of returning partial data", () => {
    const root = tempRoot();
    const store = createDraftStore(root);
    const dir = path.join(root, "owner-1", "drafts");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "artifact_1.json"), "{not json", "utf8");
    expect(() => store.getDraft("owner-1", "artifact_1")).toThrow(/unreadable record/);
  });

  it("requires a root directory", () => {
    expect(() => createDraftStore("")).toThrow();
  });
});
