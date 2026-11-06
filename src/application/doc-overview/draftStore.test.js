// FORGE Doc-to-Overview — slice A: private draft storage tests.
// Real filesystem, temp directory, deterministic assertions on content.
// The store is identity-bound: tests construct it with a principal
// ({ ownerId }) and never pass an ownerId per call.

import { chmodSync, mkdtempSync, readdirSync, statSync, symlinkSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
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

  it("round-trips content-addressed audio sidecars next to the draft, and lists only JSON drafts", () => {
    const root = tempRoot();
    const store = createDraftStore(root, { ownerId: "owner-1" });
    store.saveDraft(artifact);
    const bytes = Buffer.from("RIFF....WAVEfake-audio-bytes");
    expect(store.getAudio("artifact_1", null)).toBeNull();
    const saved = store.saveAudio("artifact_1", bytes);
    expect(saved.bytes).toBe(bytes.length);
    expect(saved.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(store.getAudio("artifact_1", saved)).toEqual(bytes);
    // The sidecar must not pollute the draft listing.
    expect(store.listDrafts()).toEqual(["artifact_1"]);
    // Reload preserves the sidecar across store instances.
    const second = createDraftStore(root, { ownerId: "owner-1" });
    expect(second.getAudio("artifact_1", saved)).toEqual(bytes);
    // Delete removes it; a second delete is quiet.
    store.deleteAudio("artifact_1", saved.sha256);
    expect(store.getAudio("artifact_1", saved)).toBeNull();
    expect(() => store.deleteAudio("artifact_1", saved.sha256)).not.toThrow();
  });

  it("sidecars are content-addressed and immutable: same bytes, same file; new bytes, new file, old intact", () => {
    const root = tempRoot();
    const store = createDraftStore(root, { ownerId: "owner-1" });
    store.saveDraft(artifact);
    const first = Buffer.from("first-recording");
    const second = Buffer.from("second-recording");
    const savedFirst = store.saveAudio("artifact_1", first);
    expect(store.saveAudio("artifact_1", first)).toEqual(savedFirst);
    const savedSecond = store.saveAudio("artifact_1", second);
    expect(savedSecond.sha256).not.toBe(savedFirst.sha256);
    expect(store.getAudio("artifact_1", savedFirst)).toEqual(first);
    expect(store.getAudio("artifact_1", savedSecond)).toEqual(second);
    // Both files coexist on disk; neither publish disturbed the other.
    const dir = path.join(root, "owner-1", "drafts");
    expect(readdirSync(dir).filter((name) => name.endsWith(".wav")).sort()).toEqual([
      `artifact_1.${savedFirst.sha256}.wav`,
      `artifact_1.${savedSecond.sha256}.wav`,
    ].sort());
  });

  it("getAudio verifies bytes against the recorded SHA-256 and size, and fails closed on mismatch", () => {
    const root = tempRoot();
    const store = createDraftStore(root, { ownerId: "owner-1" });
    store.saveDraft(artifact);
    const bytes = Buffer.from("RIFF....WAVEfake-audio-bytes");
    const saved = store.saveAudio("artifact_1", bytes);
    const sidecar = path.join(root, "owner-1", "drafts", `artifact_1.${saved.sha256}.wav`);
    // One flipped byte: same length, wrong hash.
    const tampered = Buffer.from(bytes);
    tampered[10] ^= 0xff;
    writeFileSync(sidecar, tampered);
    expect(store.getAudio("artifact_1", saved)).toBeNull();
    // Restored bytes verify again: the check is on content, not a flag.
    writeFileSync(sidecar, bytes);
    expect(store.getAudio("artifact_1", saved)).toEqual(bytes);
    // Replaced with shorter garbage: wrong length and wrong hash.
    writeFileSync(sidecar, Buffer.from("garbage"));
    expect(store.getAudio("artifact_1", saved)).toBeNull();
    writeFileSync(sidecar, bytes);
    // A descriptor for bytes that were never published: no file.
    expect(store.getAudio("artifact_1", { sha256: "b".repeat(64), bytes: bytes.length })).toBeNull();
    // Malformed descriptors fail closed, never throw.
    expect(store.getAudio("artifact_1", { sha256: "not-a-digest", bytes: bytes.length })).toBeNull();
    expect(store.getAudio("artifact_1", { sha256: saved.sha256, bytes: -1 })).toBeNull();
    expect(store.getAudio("artifact_1", { sha256: saved.sha256, bytes: bytes.length + 1 })).toBeNull();
    expect(store.getAudio("artifact_1", undefined)).toBeNull();
  });

  it("deleteAudio removes only the named sidecar", () => {
    const root = tempRoot();
    const store = createDraftStore(root, { ownerId: "owner-1" });
    store.saveDraft(artifact);
    const savedFirst = store.saveAudio("artifact_1", Buffer.from("first-recording"));
    const savedSecond = store.saveAudio("artifact_1", Buffer.from("second-recording"));
    store.deleteAudio("artifact_1", savedFirst.sha256);
    expect(store.getAudio("artifact_1", savedFirst)).toBeNull();
    expect(store.getAudio("artifact_1", savedSecond)).toEqual(Buffer.from("second-recording"));
    expect(() => store.deleteAudio("artifact_1", savedFirst.sha256)).not.toThrow();
    expect(() => store.deleteAudio("artifact_1", "not-a-digest")).toThrow(/sha256/);
  });

  it("deleteUnreferencedAudio keeps the committed sidecar and sweeps orphans", () => {
    const root = tempRoot();
    const store = createDraftStore(root, { ownerId: "owner-1" });
    store.saveDraft(artifact);
    const savedFirst = store.saveAudio("artifact_1", Buffer.from("first-recording"));
    const savedSecond = store.saveAudio("artifact_1", Buffer.from("second-recording"));
    expect(store.deleteUnreferencedAudio("artifact_1", savedFirst.sha256)).toBe(1);
    expect(store.getAudio("artifact_1", savedFirst)).toEqual(Buffer.from("first-recording"));
    expect(store.getAudio("artifact_1", savedSecond)).toBeNull();
    expect(store.deleteUnreferencedAudio("artifact_1", null)).toBe(1);
    expect(store.getAudio("artifact_1", savedFirst)).toBeNull();
    expect(store.deleteUnreferencedAudio("artifact_1", null)).toBe(0);
    expect(() => store.deleteUnreferencedAudio("artifact_1", "not-a-digest")).toThrow(/sha256/);
  });

  it("audio sidecars are owner-scoped: another bound owner hears nothing", () => {
    const root = tempRoot();
    const owner1 = createDraftStore(root, { ownerId: "owner-1" });
    owner1.saveDraft(artifact);
    const saved = owner1.saveAudio("artifact_1", Buffer.from("owner-1 audio"));
    const owner2 = createDraftStore(root, { ownerId: "owner-2" });
    expect(owner2.getAudio("artifact_1", saved)).toBeNull();
    expect(owner2.getDraft("artifact_1")).toBeNull();
  });

  it("refuses traversal in audio record IDs before touching the filesystem", () => {
    const root = tempRoot();
    const store = createDraftStore(root, { ownerId: "owner-1" });
    expect(() => store.saveAudio("../escape", Buffer.from("x"))).toThrow(/safe path segment/);
    expect(() => store.getAudio("../escape", null)).toThrow(/safe path segment/);
    expect(() => store.deleteAudio("../escape", "a".repeat(64))).toThrow(/safe path segment/);
    expect(() => store.deleteUnreferencedAudio("../escape", null)).toThrow(/safe path segment/);
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

  it("refuses to publish when the owner directory is adversarially writable", () => {
    const root = tempRoot();
    const ownerDir = path.join(root, "owner-1");
    mkdirSync(ownerDir, { mode: 0o700 });
    chmodSync(ownerDir, 0o770);
    const store = createDraftStore(root, { ownerId: "owner-1" });
    expect(() => store.saveDraft(artifact)).toThrow(/adversarially mutable/);
    // No record bytes anywhere: the write refused before temp creation.
    expect(() => statSync(path.join(ownerDir, "drafts", "artifact_1.json"))).toThrow(/ENOENT/);
  });

  it("refuses to construct a store under an adversarially writable parent", () => {
    const base = tempRoot();
    const parent = path.join(base, "parent");
    mkdirSync(parent, { mode: 0o700 });
    chmodSync(parent, 0o770);
    expect(() => createDraftStore(path.join(parent, "store"), { ownerId: "owner-1" })).toThrow(
      /adversarially mutable/,
    );
  });

  it("allows saves under a sticky other-writable parent", () => {
    const base = tempRoot();
    const sticky = path.join(base, "sticky");
    mkdirSync(sticky, { mode: 0o700 });
    chmodSync(sticky, 0o1777);
    const store = createDraftStore(path.join(sticky, "store"), { ownerId: "owner-1" });
    store.saveDraft(artifact);
    expect(store.getDraft("artifact_1")).toEqual(artifact);
  });

  it("creates a fresh store root 0700, satisfying its own boundary under any umask", () => {
    const base = tempRoot();
    const root = path.join(base, "fresh-root");
    const store = createDraftStore(root, { ownerId: "owner-1" });
    store.saveDraft(artifact);
    expect(statSync(root).mode & 0o777).toBe(0o700);
    expect(store.getDraft("artifact_1")).toEqual(artifact);
  });
});
