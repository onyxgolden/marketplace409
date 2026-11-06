// FORGE Doc-to-Overview — slice A: private draft storage.
//
// Owner-scoped, filesystem-backed artifact storage for the side tool
// (the brief's allowed alternative to FORGE Documents storage when its
// access controls do not fit artifact types). Layout:
//
//   <root>/<ownerId>/source-sets/<manifestId>.json
//   <root>/<ownerId>/drafts/<artifactId>.json
//   <root>/<ownerId>/drafts/<artifactId>.<sha256>.wav  (synthesized audio, content-addressed)
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
//   entry, as before, and both names resolve through the held
//   directory descriptor, so the publish cannot land in another tree
//   by path swap. CONTAINMENT INVARIANT (the actual guarantee, not
//   a check): the store refuses to operate unless the whole
//   ancestry — every directory from the filesystem root down to the
//   kind directory — is rename-safe, meaning no untrusted principal
//   can rename any entry on the chain. Rename-safe means: for a
//   sticky parent, both the parent's and the entry's owners are the
//   process user or root; for a non-sticky parent, no group/other
//   write and owner-write only by the process user or root. The
//   boundary is verified at store construction and re-verified on
//   every write-path chain build, and it fails closed on any
//   adversarially mutable link. Because only the owning user or
//   root can change ownership or permissions, and only a party with
//   write on a parent can rename, a boundary that holds at
//   verification cannot be invalidated by an untrusted principal
//   before the rename — so the check-before-rename window the
//   previous rounds chased does not exist for untrusted actors.
//   The publish still asserts the held directory is at its
//   authorized path immediately before renaming, but that assert is
//   defense-in-depth only: it is NOT the containment invariant,
//   and a second check or a closer check would not be. The store
//   root itself is created 0700, like every directory the store
//   creates, so a store-created tree satisfies its own boundary
//   under any umask.
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
import { createHash, randomUUID } from "node:crypto";
import { isSafePathSegment } from "@/domains/doc-overview/sanitize.js";
import {
  assertAncestryBoundary,
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

// A recorded audio digest is a 64-character lowercase hex SHA-256.
// Anything else is never a sidecar name — it is a malformed record.
const SHA256_HEX = /^[0-9a-f]{64}$/;

function assertAudioSha256(sha256) {
  if (typeof sha256 !== "string" || !SHA256_HEX.test(sha256)) {
    fail("audio sha256 must be a 64-character lowercase hex digest.");
  }
}

function audioFileName(artifactId, sha256) {
  return `${artifactId}.${sha256}.wav`;
}

// The sidecar names belonging to one artifact, matched exactly:
// <artifactId>.<64-hex-sha256>.wav. The anchored pattern means an
// artifact id that is a prefix of another id can never claim its
// sibling's files.
function listAudioNames(resolvedRoot, parts, artifactId) {
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
    const pattern = new RegExp(`^${artifactId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.([0-9a-f]{64})\\.wav$`);
    return readdirVerifiedDir(dirFd).filter((name) => pattern.test(name)).sort();
  } finally {
    closeSync(dirFd);
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
      renameWithinDir(dirFd, dirPath, tmpName, fileName);
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

function readBytes(resolvedRoot, parts, fileName) {
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
    return readFileSync(fd);
  } catch (error) {
    throw new Error(`draftStore: unreadable record at ${filePath}: ${error.message}`);
  } finally {
    closeSync(fd);
  }
}

// Binary twin of atomicWriteJson: same verified directory chain,
// temp + rename, landing check. Used for synthesized audio bytes,
// which are too large to live inside the draft JSON record.
function atomicWriteBytes(resolvedRoot, parts, fileName, buffer) {
  if (!Buffer.isBuffer(buffer)) {
    fail("audio bytes must be a Buffer.");
  }
  const canonical = ensureRoot(resolvedRoot);
  const { dirFd, dirPath } = ensureVerifiedDirChain(canonical, parts);
  try {
    const tmpName = `.tmp-${process.pid}-${randomUUID()}`;
    const tmpFd = createVerifiedTemp(dirFd, dirPath, tmpName);
    try {
      writeFileSync(tmpFd, buffer);
    } catch (error) {
      closeSync(tmpFd);
      unlinkWithinDirQuiet(dirFd, tmpName);
      throw error;
    }
    closeSync(tmpFd);
    try {
      renameWithinDir(dirFd, dirPath, tmpName, fileName);
    } catch (error) {
      unlinkWithinDirQuiet(dirFd, tmpName);
      throw error;
    }
    const destFd = openVerifiedFile(path.join(dirPath, fileName), O_RDONLY);
    closeSync(destFd);
  } finally {
    closeSync(dirFd);
  }
}

function deleteFile(resolvedRoot, parts, fileName) {
  const canonical = ensureRoot(resolvedRoot);
  const { dirFd } = ensureVerifiedDirChain(canonical, parts);
  try {
    unlinkWithinDirQuiet(dirFd, fileName);
  } finally {
    closeSync(dirFd);
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
  // Construction-time containment gate: the ancestry above the root
  // must already be rename-safe (see verifiedFs.js). Managed levels
  // below the root are re-verified from descriptor-pinned stats on
  // every write; a misconfigured deployment fails here, before any
  // record is written, rather than at first publish.
  assertAncestryBoundary(canonicalRootFor(resolvedRoot));

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
    // Synthesized audio lives as a CONTENT-ADDRESSED sidecar next
    // to the draft JSON (<artifactId>.<sha256>.wav) so the record
    // stays small and the audio bytes are never base64-inflated
    // into JSON. Content addressing is the atomicity fix (slice C
    // fix round 1): a sidecar is immutable — the same bytes always
    // land under the same name, and new bytes never overwrite the
    // file a committed record points at. Publication is two steps
    // in a fixed order: the sidecar is written first (nothing
    // references it yet, so a crash leaves only an orphan), and
    // the JSON record naming its digest is the commit point. A
    // record therefore references only fully committed bytes, and
    // a failed record save leaves the previous committed audio
    // untouched. Reads verify the bytes against the recorded
    // digest and size and return null on any mismatch (fail
    // closed). Same owner binding as the draft itself: a foreign
    // store reads its own owner's directory and finds nothing.
    // `expected` is the recorded audio descriptor { sha256, bytes };
    // a missing or malformed descriptor reads as absent.
    saveAudio(artifactId, buffer) {
      assertRecordId(artifactId);
      if (!Buffer.isBuffer(buffer)) {
        fail("audio bytes must be a Buffer.");
      }
      const sha256 = createHash("sha256").update(buffer).digest("hex");
      atomicWriteBytes(resolvedRoot, [boundOwner, "drafts"], audioFileName(artifactId, sha256), buffer);
      return { sha256, bytes: buffer.length };
    },
    getAudio(artifactId, expected) {
      assertRecordId(artifactId);
      if (!expected || typeof expected.sha256 !== "string" || !SHA256_HEX.test(expected.sha256)
        || !Number.isInteger(expected.bytes) || expected.bytes < 0) {
        return null;
      }
      const bytes = readBytes(resolvedRoot, [boundOwner, "drafts"], audioFileName(artifactId, expected.sha256));
      if (bytes === null) return null;
      if (bytes.length !== expected.bytes) return null;
      if (createHash("sha256").update(bytes).digest("hex") !== expected.sha256) return null;
      return bytes;
    },
    // Deletes exactly one sidecar, named by its digest. Quiet when
    // it is already gone; a malformed digest is a caller bug and
    // fails loud.
    deleteAudio(artifactId, sha256) {
      assertRecordId(artifactId);
      assertAudioSha256(sha256);
      deleteFile(resolvedRoot, [boundOwner, "drafts"], audioFileName(artifactId, sha256));
    },
    // Deletes every sidecar for this artifact except the one named
    // by keepSha256 (null keeps nothing). Best effort: filesystem
    // failures are swallowed and the count of deletions is returned,
    // so cleanup can never fail the user-visible action it follows.
    // Callers pass the digest of the record they just committed, so
    // a crash orphan and a superseded recording are both swept while
    // the committed bytes survive.
    deleteUnreferencedAudio(artifactId, keepSha256) {
      assertRecordId(artifactId);
      if (keepSha256 !== null && keepSha256 !== undefined) {
        assertAudioSha256(keepSha256);
      }
      let names;
      try {
        names = listAudioNames(resolvedRoot, [boundOwner, "drafts"], artifactId);
      } catch {
        return 0;
      }
      if (names.length === 0) return 0;
      const keepName = keepSha256 ? audioFileName(artifactId, keepSha256) : null;
      let dirFd;
      try {
        const canonical = ensureRoot(resolvedRoot);
        ({ dirFd } = ensureVerifiedDirChain(canonical, [boundOwner, "drafts"]));
      } catch {
        return 0;
      }
      let deleted = 0;
      try {
        for (const name of names) {
          if (keepName !== null && name === keepName) continue;
          try {
            unlinkWithinDirQuiet(dirFd, name);
            deleted += 1;
          } catch {
            // Best effort: one stubborn file must not block the rest.
          }
        }
      } finally {
        closeSync(dirFd);
      }
      return deleted;
    },
  };
}
