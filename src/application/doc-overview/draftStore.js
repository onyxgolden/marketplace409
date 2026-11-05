// FORGE Doc-to-Overview — slice A: private draft storage.
//
// Owner-scoped, filesystem-backed artifact storage for the side tool
// (the brief's allowed alternative to FORGE Documents storage when its
// access controls do not fit artifact types). Layout:
//
//   <root>/<ownerId>/source-sets/<manifestId>.json
//   <root>/<ownerId>/drafts/<artifactId>.json
//
// Access contract (enforced here, not hoped for upstream):
// - IDENTITY-BOUND. The store is constructed with a principal
//   ({ ownerId }) established by the trusted caller — the authenticated
//   session layer. Store methods take NO ownerId parameter, so no caller
//   can reach another owner's directory by passing a different ID.
//   The store cannot authenticate by itself: whoever constructs it must
//   hand it the authenticated identity, never a caller-supplied value
//   from an untrusted request. Wiring routes to this store without that
//   boundary is a defect, not a follow-up.
// - STORED-OWNER VERIFICATION. A saved manifest's ownerId must equal the
//   bound owner (a draft's ownerId, when present, must too); a mismatch
//   is refused on save. On read, a record whose stored ownerId differs
//   from the bound owner returns null, exactly like a missing record
//   (non-disclosing).
// - SYMLINK REFUSAL. Owner directories are attacker-writable in the
//   threat model (a malicious owner probing for other owners' records),
//   so every path component below the root is lstat-checked: a symlink
//   anywhere in the chain, or a symlinked record file, is refused
//   before any read, write, or listing follows it. path.resolve/prefix
//   checks alone do NOT stop this — resolve() normalizes the spelling
//   but the filesystem still follows the link.
// - Owner/kind directories the store creates get mode 0700.
// - Writes are atomic (fresh temp file with 'wx' + rename), so a crash
//   cannot leave a half-written manifest or draft behind. Rename
//   replaces the destination entry itself; a symlinked destination is
//   refused before the rename rather than silently replaced.
// - No network, no memory/knowledge store, no external service: this
//   store only ever touches the local directory it was given.

import {
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { isSafePathSegment } from "@/domains/doc-overview/sanitize.js";

function fail(message) {
  throw new Error(`draftStore: ${message}`);
}

function recordPath(ownerDir, kind, recordId) {
  if (!isSafePathSegment(recordId)) {
    fail(`record id must be a safe path segment, got ${JSON.stringify(recordId)}.`);
  }
  const dir = path.resolve(ownerDir, kind);
  const file = path.resolve(dir, `${recordId}.json`);
  // Containment: the resolved file must stay inside its kind directory
  // even if root or an ID contained something unexpected.
  if (!file.startsWith(`${dir}${path.sep}`)) {
    fail("resolved path escaped its owner directory.");
  }
  return { dir, file };
}

// Walks the path from root to dir, one component at a time. Any
// component that exists as a symlink, or as a non-directory, is refused.
// Missing components end the walk (the caller creates them with
// ensureDir, or treats the record as absent).
function assertChainNoSymlinks(root, dir) {
  const rel = path.relative(root, dir);
  if (rel.startsWith(`..${path.sep}`) || rel === ".." || path.isAbsolute(rel)) {
    fail("resolved path escaped its root directory.");
  }
  let cur = root;
  for (const part of rel.split(path.sep).filter((p) => p.length > 0)) {
    const next = path.join(cur, part);
    let stat;
    try {
      stat = lstatSync(next);
    } catch (error) {
      if (error && error.code === "ENOENT") return;
      throw error;
    }
    if (stat.isSymbolicLink()) {
      fail(`refused symlinked path component at ${next}.`);
    }
    if (!stat.isDirectory()) {
      fail(`path component at ${next} is not a directory.`);
    }
    cur = next;
  }
}

// Creates dir level by level (never mkdir -p through an unchecked
// chain): each existing component must be a real directory, never a
// symlink; each missing component is created mode 0700. The root
// itself is operator configuration (a symlink there is the operator's
// choice, not an owner escape), so it is created if missing.
function ensureDir(root, dir) {
  try {
    mkdirSync(root);
  } catch (error) {
    if (!error || error.code !== "EEXIST") throw error;
  }
  const rel = path.relative(root, dir);
  if (rel.startsWith(`..${path.sep}`) || rel === ".." || path.isAbsolute(rel)) {
    fail("resolved path escaped its root directory.");
  }
  let cur = root;
  for (const part of rel.split(path.sep).filter((p) => p.length > 0)) {
    const next = path.join(cur, part);
    let stat = null;
    try {
      stat = lstatSync(next);
    } catch (error) {
      if (!error || error.code !== "ENOENT") throw error;
    }
    if (stat === null) {
      mkdirSync(next, { mode: 0o700 });
    } else {
      if (stat.isSymbolicLink()) {
        fail(`refused symlinked path component at ${next}.`);
      }
      if (!stat.isDirectory()) {
        fail(`path component at ${next} is not a directory.`);
      }
    }
    cur = next;
  }
}

// A record file that exists must be a regular file, never a symlink
// (a read or rename through it would escape the owner directory).
// Missing is fine — the caller treats it as absent.
function assertRecordFileUsable(file) {
  let stat = null;
  try {
    stat = lstatSync(file);
  } catch (error) {
    if (error && error.code === "ENOENT") return;
    throw error;
  }
  if (stat.isSymbolicLink()) {
    fail(`refused symlinked record file at ${file}.`);
  }
  if (!stat.isFile()) {
    fail(`record path at ${file} is not a regular file.`);
  }
}

function atomicWriteJson(root, file, dir, value) {
  ensureDir(root, dir);
  assertRecordFileUsable(file);
  const tmp = path.join(dir, `.tmp-${process.pid}-${randomUUID()}`);
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  renameSync(tmp, file);
}

function readJson(root, file, dir) {
  assertChainNoSymlinks(root, dir);
  assertRecordFileUsable(file);
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    if (error && error.code === "ENOENT") return null;
    throw new Error(`draftStore: unreadable record at ${file}: ${error.message}`);
  }
}

function listIds(root, dir) {
  assertChainNoSymlinks(root, dir);
  let names;
  try {
    names = readdirSync(dir);
  } catch (error) {
    if (error && error.code === "ENOENT") return [];
    throw error;
  }
  const ids = [];
  for (const name of names) {
    if (!name.endsWith(".json") || name.startsWith(".")) continue;
    const entryPath = path.join(dir, name);
    let stat;
    try {
      stat = lstatSync(entryPath);
    } catch (error) {
      if (error && error.code === "ENOENT") continue;
      throw error;
    }
    if (stat.isSymbolicLink()) {
      fail(`refused symlinked record file at ${entryPath}.`);
    }
    if (!stat.isFile()) continue;
    ids.push(name.slice(0, -".json".length));
  }
  return ids.sort();
}

// Creates an identity-bound store. `principal` is the authenticated
// identity ({ ownerId }) established by the trusted caller — the auth
// layer, never a value taken from an untrusted request. All methods
// operate under that owner only; there is no ownerId parameter to abuse.
export function createDraftStore(root, principal) {
  if (typeof root !== "string" || root.length === 0) {
    fail("root directory is required.");
  }
  if (!principal || !isSafePathSegment(principal.ownerId)) {
    fail("principal.ownerId is required and must be a safe path segment (the authenticated identity).");
  }
  const resolvedRoot = path.resolve(root);
  const boundOwner = principal.ownerId;
  const ownerDirPath = path.resolve(resolvedRoot, boundOwner);

  function checkStoredOwner(record) {
    if (record !== null && record.ownerId !== undefined && record.ownerId !== boundOwner) {
      return null;
    }
    return record;
  }

  return {
    // The bound owner, for callers that need to confirm which identity
    // this store was constructed with. Read-only; it cannot be changed
    // after construction.
    get boundOwner() {
      return boundOwner;
    },
    saveSourceSet(manifest) {
      if (!manifest || manifest.ownerId !== boundOwner) {
        fail("manifest.ownerId must equal the bound owner.");
      }
      const { dir, file } = recordPath(ownerDirPath, "source-sets", manifest.id);
      atomicWriteJson(resolvedRoot, file, dir, manifest);
      return manifest;
    },
    getSourceSet(manifestId) {
      const { dir, file } = recordPath(ownerDirPath, "source-sets", manifestId);
      return checkStoredOwner(readJson(resolvedRoot, file, dir));
    },
    listSourceSets() {
      const dir = path.resolve(ownerDirPath, "source-sets");
      return listIds(resolvedRoot, dir);
    },
    saveDraft(artifact) {
      if (!artifact || (artifact.ownerId !== undefined && artifact.ownerId !== boundOwner)) {
        fail("artifact.ownerId, when present, must equal the bound owner.");
      }
      const { dir, file } = recordPath(ownerDirPath, "drafts", artifact.id);
      atomicWriteJson(resolvedRoot, file, dir, artifact);
      return artifact;
    },
    getDraft(artifactId) {
      const { dir, file } = recordPath(ownerDirPath, "drafts", artifactId);
      return checkStoredOwner(readJson(resolvedRoot, file, dir));
    },
    listDrafts() {
      const dir = path.resolve(ownerDirPath, "drafts");
      return listIds(resolvedRoot, dir);
    },
  };
}
