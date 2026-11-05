// FORGE Doc-to-Overview — slice A: private draft storage tests.
// Real filesystem, temp directory, deterministic assertions on content.
// The store is identity-bound: tests construct it with a principal
// ({ ownerId }) and never pass an ownerId per call.

import { mkdtempSync, statSync, symlinkSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
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
    const first = createDraftStore(root, { ownerId: "owner-1" });
    first.saveSourceSet(manifest);
    first.saveDraft(artifact);
    expect(first.getSourceSet("manifest_1")).toEqual(manifest);
    expect(first.getDraft("artifact_1")).toEqual(artifact);
    expect(first.listSourceSets()).toEqual(["manifest_1"]);
    expect(first.listDrafts()).toEqual(["artifact_1"]);

    const second = createDraftStore(root, { ownerId: "owner-1" });
    expect(second.getSourceSet("manifest_1")).toEqual(manifest);
    expect(second.getDraft("artifact_1")).toEqual(artifact);
  });

  it("is owner-scoped and non-disclosing: another bound owner sees nothing", () => {
    const root = tempRoot();
    const owner1 = createDraftStore(root, { ownerId: "owner-1" });
    owner1.saveSourceSet(manifest);
    owner1.saveDraft(artifact);
    const owner2 = createDraftStore(root, { ownerId: "owner-2" });
    expect(owner2.getSourceSet("manifest_1")).toBeNull();
    expect(owner2.getDraft("artifact_1")).toBeNull();
    expect(owner2.listSourceSets()).toEqual([]);
    expect(owner2.listDrafts()).toEqual([]);
    expect(owner1.getSourceSet("missing")).toBeNull();
  });

  it("refuses saves whose stored owner differs from the bound owner", () => {
    const root = tempRoot();
    const owner2 = createDraftStore(root, { ownerId: "owner-2" });
    expect(() => owner2.saveSourceSet(manifest)).toThrow(/must equal the bound owner/);
    expect(() => owner2.saveSourceSet({ ...manifest, ownerId: undefined })).toThrow(/must equal the bound owner/);
    expect(() => owner2.saveDraft({ ...artifact, ownerId: "owner-1" })).toThrow(/must equal the bound owner/);
    // A draft shell carries no ownerId field; the bound directory is its
    // owner, so saving it under the bound owner is fine.
    expect(owner2.saveDraft(artifact)).toEqual(artifact);
  });

  it("returns null for a record whose stored owner was tampered after save", () => {
    const root = tempRoot();
    const owner1 = createDraftStore(root, { ownerId: "owner-1" });
    owner1.saveSourceSet(manifest);
    // Tamper the stored record in place (simulating a pre-fix or corrupt
    // row): the bound store must not serve it to anyone.
    writeFileSync(
      path.join(root, "owner-1", "source-sets", "manifest_1.json"),
      `${JSON.stringify({ ...manifest, ownerId: "owner-9" }, null, 2)}\n`,
      "utf8",
    );
    expect(owner1.getSourceSet("manifest_1")).toBeNull();
  });

  it("requires a root directory and an authenticated principal", () => {
    expect(() => createDraftStore("")).toThrow();
    expect(() => createDraftStore(tempRoot())).toThrow(/principal/);
    expect(() => createDraftStore(tempRoot(), {})).toThrow(/principal/);
    expect(() => createDraftStore(tempRoot(), { ownerId: "../evil" })).toThrow(/principal/);
    expect(() => createDraftStore(tempRoot(), { ownerId: ".hidden" })).toThrow(/principal/);
  });

  it("refuses traversal in record IDs before touching the filesystem", () => {
    const root = tempRoot();
    const store = createDraftStore(root, { ownerId: "owner-1" });
    expect(() => store.getDraft("../../etc/passwd")).toThrow();
    expect(() => store.saveDraft({ ...artifact, id: ".hidden" })).toThrow();
  });

  it("fails loud on a malformed record instead of returning partial data", () => {
    const root = tempRoot();
    const store = createDraftStore(root, { ownerId: "owner-1" });
    const dir = path.join(root, "owner-1", "drafts");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "artifact_1.json"), "{not json", "utf8");
    expect(() => store.getDraft("artifact_1")).toThrow(/unreadable record/);
  });

  it("refuses symlinked directories and record files (escape fixture)", () => {
    const root = tempRoot();
    const outside = tempRoot();
    const store = createDraftStore(root, { ownerId: "owner-1" });
    store.saveDraft(artifact);
    // (a) Symlink the whole kind directory to an outside directory.
    const draftsDir = path.join(root, "owner-1", "drafts");
    const saved = path.join(outside, "artifact_1.json");
    writeFileSync(saved, `${JSON.stringify({ ...artifact, id: "artifact_1", planted: true }, null, 2)}\n`, "utf8");
    renameSync(draftsDir, path.join(outside, "drafts-real"));
    symlinkSync(outside, draftsDir, "dir");
    expect(() => store.getDraft("artifact_1")).toThrow(/symlink/);
    expect(() => store.listDrafts()).toThrow(/symlink/);
    expect(() => store.saveDraft({ ...artifact, id: "artifact_2" })).toThrow(/symlink/);
  });

  it("refuses a symlinked record file on read", () => {
    const root = tempRoot();
    const outside = tempRoot();
    const store = createDraftStore(root, { ownerId: "owner-1" });
    const dir = path.join(root, "owner-1", "drafts");
    mkdirSync(dir, { recursive: true });
    const target = path.join(outside, "secret.json");
    writeFileSync(target, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
    symlinkSync(target, path.join(dir, "artifact_1.json"));
    expect(() => store.getDraft("artifact_1")).toThrow(/symlink/);
  });

  it("refuses a symlinked owner directory on any access", () => {
    const root = tempRoot();
    const outside = tempRoot();
    const store = createDraftStore(root, { ownerId: "owner-1" });
    const ownerDir = path.join(root, "owner-1");
    mkdirSync(path.join(outside, "drafts"), { recursive: true });
    symlinkSync(outside, ownerDir, "dir");
    expect(() => store.listDrafts()).toThrow(/symlink/);
    expect(() => store.saveDraft(artifact)).toThrow(/symlink/);
  });

  it("never serves another owner's record when the kind directory is swapped for a symlink", () => {
    const root = tempRoot();
    const victimRoot = tempRoot();
    const store = createDraftStore(root, { ownerId: "owner-1" });
    store.saveDraft(artifact);
    // Victim tree holding a same-id record with planted content,
    // placed where the swapped path spelling resolves: the drafts
    // directory itself is the symlink target.
    const planted = { ...artifact, planted: true };
    writeFileSync(path.join(victimRoot, "artifact_1.json"), `${JSON.stringify(planted, null, 2)}\n`, "utf8");
    // Swap the kind directory for a symlink to the victim tree.
    const draftsDir = path.join(root, "owner-1", "drafts");
    renameSync(draftsDir, path.join(victimRoot, "drafts-real"));
    symlinkSync(victimRoot, draftsDir, "dir");
    // No operation may serve the planted record or write into the
    // victim tree: reads and lists refuse, saves refuse.
    expect(() => store.getDraft("artifact_1")).toThrow(/symlink/);
    expect(() => store.listDrafts()).toThrow(/symlink/);
    expect(() => store.saveDraft({ ...artifact, id: "artifact_2" })).toThrow(/symlink/);
  });

  it("a swapped owner directory cannot redirect a save", () => {
    const root = tempRoot();
    const victimRoot = tempRoot();
    const store = createDraftStore(root, { ownerId: "owner-1" });
    store.saveDraft(artifact);
    mkdirSync(path.join(victimRoot, "drafts"), { recursive: true });
    const ownerDir = path.join(root, "owner-1");
    renameSync(ownerDir, path.join(victimRoot, "owner-1-real"));
    symlinkSync(victimRoot, ownerDir, "dir");
    expect(() => store.saveDraft({ ...artifact, id: "artifact_2" })).toThrow(/symlink/);
    // The victim tree gained nothing.
    expect(() => statSync(path.join(victimRoot, "drafts", "artifact_2.json"))).toThrow(/ENOENT/);
  });

  it("a missing record under a swapped directory reads as absent, never victim data", () => {
    const root = tempRoot();
    const victimRoot = tempRoot();
    const store = createDraftStore(root, { ownerId: "owner-1" });
    store.saveDraft(artifact);
    // Victim tree holds a DIFFERENT id only, placed where the swapped
    // path spelling resolves (directly under the symlink target); the
    // requested id is absent in both trees, so the read must be null,
    // not victim content.
    writeFileSync(path.join(victimRoot, "other.json"), `${JSON.stringify({ id: "other" }, null, 2)}\n`, "utf8");
    const draftsDir = path.join(root, "owner-1", "drafts");
    renameSync(draftsDir, path.join(victimRoot, "drafts-real"));
    symlinkSync(victimRoot, draftsDir, "dir");
    expect(store.getDraft("missing-id")).toBeNull();
    // ...while an id that DOES exist in the victim tree still refuses.
    expect(() => store.getDraft("other")).toThrow(/symlink/);
  });

  it("upsert still replaces its own record (rename-publish semantics preserved)", () => {
    const root = tempRoot();
    const store = createDraftStore(root, { ownerId: "owner-1" });
    store.saveDraft(artifact);
    const updated = { ...artifact, status: "approved" };
    store.saveDraft(updated);
    expect(store.getDraft("artifact_1")).toEqual(updated);
  });
});
