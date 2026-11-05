// FORGE Doc-to-Overview — slice A: private draft storage.
//
// Owner-scoped, filesystem-backed artifact storage for the side tool
// (the brief's allowed alternative to FORGE Documents storage when its
// access controls do not fit artifact types). Layout:
//
//   <root>/<ownerId>/source-sets/<manifestId>.json
//   <root>/<ownerId>/drafts/<artifactId>.json
//
// Rules enforced here, not hoped for upstream:
// - Owner IDs and record IDs must be safe single path segments; anything
//   else is refused before any filesystem access (no traversal).
// - Every resolved path is verified to stay inside its owner directory.
// - Writes are atomic (temp file in the same directory + rename), so a
//   crash cannot leave a half-written manifest or draft behind.
// - Reads are owner-scoped and non-disclosing: asking for another
//   owner's record returns null, exactly like asking for a missing one.
// - No network, no memory/knowledge store, no external service: this
//   store only ever touches the local directory it was given.

import { mkdirSync, readFileSync, renameSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { isSafePathSegment } from "@/domains/doc-overview/sanitize.js";

function ownerDir(root, ownerId) {
  if (!isSafePathSegment(ownerId)) {
    throw new Error(`draftStore: ownerId must be a safe path segment, got ${JSON.stringify(ownerId)}.`);
  }
  return path.resolve(root, ownerId);
}

function recordPath(root, ownerId, kind, recordId) {
  if (!isSafePathSegment(recordId)) {
    throw new Error(`draftStore: record id must be a safe path segment, got ${JSON.stringify(recordId)}.`);
  }
  const dir = path.resolve(ownerDir(root, ownerId), kind);
  const file = path.resolve(dir, `${recordId}.json`);
  // Containment: the resolved file must stay inside its owner directory
  // even if root or an ID contained something unexpected.
  if (!file.startsWith(`${dir}${path.sep}`)) {
    throw new Error("draftStore: resolved path escaped its owner directory.");
  }
  return { dir, file };
}

function atomicWriteJson(file, dir, value) {
  mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.tmp-${process.pid}-${randomUUID()}`);
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(tmp, file);
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    if (error && error.code === "ENOENT") return null;
    throw new Error(`draftStore: unreadable record at ${file}: ${error.message}`);
  }
}

function listIds(root, ownerId, kind) {
  const dir = path.resolve(ownerDir(root, ownerId), kind);
  try {
    return readdirSync(dir)
      .filter((name) => name.endsWith(".json") && !name.startsWith("."))
      .map((name) => name.slice(0, -".json".length))
      .sort();
  } catch (error) {
    if (error && error.code === "ENOENT") return [];
    throw error;
  }
}

export function createDraftStore(root) {
  if (typeof root !== "string" || root.length === 0) {
    throw new Error("draftStore: root directory is required.");
  }
  const resolvedRoot = path.resolve(root);
  return {
    saveSourceSet(ownerId, manifest) {
      const { dir, file } = recordPath(resolvedRoot, ownerId, "source-sets", manifest.id);
      atomicWriteJson(file, dir, manifest);
      return manifest;
    },
    getSourceSet(ownerId, manifestId) {
      const { file } = recordPath(resolvedRoot, ownerId, "source-sets", manifestId);
      return readJson(file);
    },
    listSourceSets(ownerId) {
      return listIds(resolvedRoot, ownerId, "source-sets");
    },
    saveDraft(ownerId, artifact) {
      const { dir, file } = recordPath(resolvedRoot, ownerId, "drafts", artifact.id);
      atomicWriteJson(file, dir, artifact);
      return artifact;
    },
    getDraft(ownerId, artifactId) {
      const { file } = recordPath(resolvedRoot, ownerId, "drafts", artifactId);
      return readJson(file);
    },
    listDrafts(ownerId) {
      return listIds(resolvedRoot, ownerId, "drafts");
    },
  };
}
