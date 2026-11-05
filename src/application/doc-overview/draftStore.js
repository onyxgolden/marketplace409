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
// - RACE-RESISTANT PATHS (verifiedFs.js). Owner directories are
//   attacker-writable in the threat model, so no operation trusts a
//   path spelling that was checked a moment ago: every file and
//   directory is opened with O_NOFOLLOW and the open descriptor is
//   verified against its intended absolute path via /proc/self/fd.
//   A component swapped for a symlink at any point before the open
//   makes the descriptor's true location differ from the intended one
//   and the operation is refused; a swap after the open cannot
//   redirect the descriptor. Listings read through the held directory
//   descriptor and the publish rename resolves both names through it,
//   so neither step follows a swapped path. A record that exists
//   anywhere but its intended location is never served; a missing
//   record under a swapped directory reads as absent (null), which
//   discloses nothing.
// - Owner/kind directories the store creates get mode 0700; temp files
//   get mode 0600.
// - Writes are atomic (fresh temp file with O_EXCL + rename inside the
//   verified kind directory), so a crash cannot leave a half-written
//   manifest or draft behind. The rename replaces the destination
//   entry, as before, but both names resolve through the held
//   directory descriptor, so the publish cannot land in another tree.
// - Platform: descriptor verification needs Linux /proc/self/fd (see
//   verifiedFs.js). Without it the store fails closed, loudly, rather
//   than operating unverified.
// - No network, no memory/knowledge store, no external service: this
//   store only ever touches the local directory it was given.

import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { isSafePathSegment } from "@/domains/doc-overview/sanitize.js";
import {
  canonicalRootFor,
  createVerifiedTemp,
  ensureRoot,
  ensureVerifiedDirChain,
  openVerifiedDir,
  openVerifiedFd,
  openVerifiedFile,
  readdirVerifiedDir,
  renameWithinDir,
  unlinkWithinDirQuiet,
} from "./verifiedFs.js";

const { O_RDONLY } = fsConstants;

function fail(message) {
  throw new Error(`draftStore: ${message}`);
}

function assertRecordId(recordId) {
  if (!isSafePathSegment(recordId)) {
    fail(`record id must be a safe path segment, got ${JSON.stringify(recordId)}.`);
  }
}

function atomicWriteJson(resolvedRoot, parts, fileName, value) {
  const canonical = ensureRoot(resolvedRoot);
  const { dirFd, dirPath } = ensureVerifiedDirChain(canonical, parts);
  try {
    const tmpName = `.tmp-${process.pid}-${randomUUID()}`;
    const tmpFd = createVerifiedTemp(dirFd, dirPath, tmpName);
    try {
      writeFileSync(tmpFd, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    } catch (error) {
      closeSync(tmpFd);
      unlinkWithinDirQuiet(dirFd, tmpName);
      throw error;
    }
    closeSync(tmpFd);
    try {
      renameWithinDir(dirFd, tmpName, fileName);
    } catch (error) {
      unlinkWithinDirQuiet(dirFd, tmpName);
      throw error;
    }
    // Post-rename landing check: the destination, opened fresh, must be
    // exactly the intended record path. The rename already resolved
    // through the held directory descriptor, so this cannot misland;
    // it is belt-and-braces against any future refactor that reopens
    // the rename by path.
    const destFd = openVerifiedFile(path.join(dirPath, fileName), O_RDONLY);
    closeSync(destFd);
  } finally {
    closeSync(dirFd);
  }
}

function readJson(resolvedRoot, parts, fileName) {
  const canonical = canonicalRootFor(resolvedRoot);
  const dirPath = path.join(canonical, ...parts);
  const filePath = path.join(dirPath, fileName);
  let fd;
  try {
    fd = openVerifiedFile(filePath, O_RDONLY);
  } catch (error) {
    if (error && error.code === "ENOENT") return null;
    throw error;
  }
  try {
    return JSON.parse(readFileSync(fd, "utf8"));
  } catch (error) {
    throw new Error(`draftStore: unreadable record at ${filePath}: ${error.message}`);
  } finally {
    closeSync(fd);
  }
}

function listIds(resolvedRoot, parts) {
  const canonical = canonicalRootFor(resolvedRoot);
  const dirPath = path.join(canonical, ...parts);
  let dirFd;
  try {
    dirFd = openVerifiedDir(dirPath);
  } catch (error) {
    if (error && error.code === "ENOENT") return [];
    throw error;
  }
  try {
    const names = readdirVerifiedDir(dirFd);
    const ids = [];
    for (const name of names) {
      if (!name.endsWith(".json") || name.startsWith(".")) continue;
      const entryPath = path.join(dirPath, name);
      let fd;
      try {
        fd = openVerifiedFd(entryPath, O_RDONLY);
      } catch (error) {
        if (error && error.code === "ENOENT") continue;
        throw error;
      }
      try {
        // A symlinked entry is refused by openVerifiedFd (ELOOP) or
        // by the descriptor-path check; a non-file entry is skipped,
        // as before.
        if (!fstatSync(fd).isFile()) continue;
      } finally {
        closeSync(fd);
      }
      ids.push(name.slice(0, -".json".length));
    }
    return ids.sort();
  } finally {
    closeSync(dirFd);
  }
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
      assertRecordId(manifest.id);
      atomicWriteJson(resolvedRoot, [boundOwner, "source-sets"], `${manifest.id}.json`, manifest);
      return manifest;
    },
    getSourceSet(manifestId) {
      assertRecordId(manifestId);
      return checkStoredOwner(readJson(resolvedRoot, [boundOwner, "source-sets"], `${manifestId}.json`));
    },
    listSourceSets() {
      return listIds(resolvedRoot, [boundOwner, "source-sets"]);
    },
    saveDraft(artifact) {
      if (!artifact || (artifact.ownerId !== undefined && artifact.ownerId !== boundOwner)) {
        fail("artifact.ownerId, when present, must equal the bound owner.");
      }
      assertRecordId(artifact.id);
      atomicWriteJson(resolvedRoot, [boundOwner, "drafts"], `${artifact.id}.json`, artifact);
      return artifact;
    },
    getDraft(artifactId) {
      assertRecordId(artifactId);
      return checkStoredOwner(readJson(resolvedRoot, [boundOwner, "drafts"], `${artifactId}.json`));
    },
    listDrafts() {
      return listIds(resolvedRoot, [boundOwner, "drafts"]);
    },
  };
}
