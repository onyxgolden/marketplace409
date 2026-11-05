// FORGE Doc-to-Overview — race-resistant filesystem primitives for the draft
// store.
//
// Why this module exists: the previous draftStore checked each path
// component with lstatSync and then operated on the path by name. Under
// the store's threat model (owner-writable directories), an owner able
// to mutate directory entries concurrently could replace a checked
// component with a symlink between the check and the use, and the
// following read/write/list would follow the new component outside the
// owner tree. A check followed by a pathname operation is not
// sufficient when the checked path can be renamed.
//
// The fix is descriptor-relative operation with verified handles, not
// another check:
// - Every file is opened with O_NOFOLLOW and read/written through the
//   returned descriptor. A descriptor names an inode, not a path: once
//   opened, later renames or symlink swaps of the path cannot redirect
//   the descriptor to different content.
// - Every opened file and directory is verified against its intended
//   absolute path via /proc/self/fd/<fd>. If any component of the path
//   was swapped before the open, the descriptor's true location differs
//   from the intended location and the operation is refused. This is
//   what closes the race: the verification reads what was actually
//   opened, not what the path spelled at check time.
// - Directory listings read through the held directory descriptor
//   (/proc/self/fd/<fd>), and temp-file creation plus the publish
//   rename resolve both names through the held kind-directory
//   descriptor, so neither step can be redirected by a path swap after
//   the directory was verified.
// - The one residual: ensureVerifiedDirChain can create an empty
//   directory in the wrong tree if a parent component is swapped
//   between its verification and the mkdir. The follow-up verification
//   refuses the operation, so the stray directory is empty, mode 0700,
//   and holds no data. It is not cleaned up (removing it would itself
//   be a pathname operation against an unverified tree).
//
// Platform requirement: fd-path verification needs Linux
// /proc/self/fd. On a platform without it, every operation fails
// closed with a loud error rather than silently operating unverified.
// The deployment target is Linux; the store refuses to guess elsewhere.

import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import path from "node:path";

const { O_CREAT, O_DIRECTORY, O_EXCL, O_NOFOLLOW, O_RDONLY, O_WRONLY } = fsConstants;

function fail(message) {
  throw new Error(`draftStore: ${message}`);
}

// The true location of an open descriptor, from the kernel. A "(deleted)"
// suffix means the path no longer names this file (unlinked and possibly
// replaced after open) — that is a mismatch, not a location.
export function fdPath(fd) {
  let actual;
  try {
    actual = readlinkSync(`/proc/self/fd/${fd}`);
  } catch (error) {
    fail(
      `fd path verification unavailable on this platform (${error?.code ?? error?.message}); refusing rather than operating unverified.`,
    );
  }
  if (actual.endsWith(" (deleted)")) {
    fail(`refused descriptor whose path no longer names a live file (${actual}).`);
  }
  return actual;
}

function checkFdPath(fd, intended, what) {
  const actual = fdPath(fd);
  if (actual !== intended) {
    fail(
      `refused ${what} whose resolved location differs from its intended location (possible symlink swap): intended ${intended}, resolved ${actual}.`,
    );
  }
}

// Opens a path with O_NOFOLLOW and verifies the descriptor is what the
// path was supposed to name. Raw ENOENT/ENOTDIR propagate so callers can
// treat a missing entry as absent; a symlink final component (ELOOP) is
// refused, never followed. The caller owns the returned descriptor.
export function openVerifiedFd(intended, flags, mode) {
  let fd;
  try {
    fd = openSync(intended, flags | O_NOFOLLOW, mode);
  } catch (error) {
    if (error && error.code === "ELOOP") {
      fail(`refused symlinked path at ${intended}.`);
    }
    throw error;
  }
  try {
    checkFdPath(fd, intended, "path");
  } catch (error) {
    closeSync(fd);
    throw error;
  }
  return fd;
}

// Like openVerifiedFd, but the target must be a regular file.
export function openVerifiedFile(intended, flags, mode) {
  const fd = openVerifiedFd(intended, flags, mode);
  try {
    if (!fstatSync(fd).isFile()) {
      fail(`record path at ${intended} is not a regular file.`);
    }
  } catch (error) {
    closeSync(fd);
    throw error;
  }
  return fd;
}

// Like openVerifiedFd, but the target must be a directory. Note the
// kernel reports ENOTDIR (not ELOOP) for O_NOFOLLOW|O_DIRECTORY on a
// symlink final component, so ENOTDIR is classified after the fact:
// the open already refused, so the lstat below only picks the message,
// never gates a follow.
export function openVerifiedDir(intended) {
  let fd;
  try {
    fd = openVerifiedFd(intended, O_RDONLY | O_DIRECTORY);
  } catch (error) {
    if (error && error.code === "ENOTDIR") {
      let stat = null;
      try {
        stat = lstatSync(intended);
      } catch {
        // Not stat-able: rethrow the original refusal below.
      }
      if (stat && stat.isSymbolicLink()) {
        fail(`refused symlinked directory at ${intended}.`);
      }
    }
    throw error;
  }
  try {
    if (!fstatSync(fd).isDirectory()) {
      fail(`path at ${intended} is not a directory.`);
    }
  } catch (error) {
    closeSync(fd);
    throw error;
  }
  return fd;
}

// Lists the directory a held descriptor names, not the path spelling:
// a swap of the path after the descriptor was verified cannot change
// which directory is listed.
export function readdirVerifiedDir(dirFd) {
  return readdirSync(`/proc/self/fd/${dirFd}`);
}

// Creates a fresh temp file inside a verified directory, resolved
// through the held descriptor so a path swap cannot redirect it.
// O_EXCL means the name must not already exist.
export function createVerifiedTemp(dirFd, dirPath, tmpName) {
  if (tmpName.includes(path.sep) || tmpName === "." || tmpName === "..") {
    fail(`temp name must be a single path segment, got ${JSON.stringify(tmpName)}.`);
  }
  const fd = openSync(`/proc/self/fd/${dirFd}/${tmpName}`, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600);
  try {
    if (!fstatSync(fd).isFile()) {
      fail(`temp path at ${path.join(dirPath, tmpName)} is not a regular file.`);
    }
    checkFdPath(fd, path.join(dirPath, tmpName), "temp file");
  } catch (error) {
    closeSync(fd);
    throw error;
  }
  return fd;
}

// Renames inside one verified directory, with both names resolved
// through the held descriptor: the rename cannot land in another tree
// no matter what happens to the directory's path spelling afterwards.
// Replaces the destination, as rename does; both endpoints are pinned.
export function renameWithinDir(dirFd, fromName, toName) {
  for (const name of [fromName, toName]) {
    if (name.includes(path.sep) || name === "." || name === "..") {
      fail(`rename name must be a single path segment, got ${JSON.stringify(name)}.`);
    }
  }
  renameSync(`/proc/self/fd/${dirFd}/${fromName}`, `/proc/self/fd/${dirFd}/${toName}`);
}

// Best-effort removal of a temp file through the held directory
// descriptor; used only to clean up after a failed write. Failures are
// swallowed: the temp file is uniquely named and holds no record.
export function unlinkWithinDirQuiet(dirFd, name) {
  try {
    unlinkSync(`/proc/self/fd/${dirFd}/${name}`);
  } catch {
    // Leave the uniquely-named temp file behind; it is never served.
  }
}

// The operator root, resolved once per operation: the root itself is
// operator configuration (a symlink there is the operator's choice),
// but everything below it must be addressed by its resolved spelling
// so descriptor verification can compare exact paths. Does not create
// the root — reads use this and treat a missing root as absent.
export function canonicalRootFor(resolvedRoot) {
  try {
    return realpathSync(resolvedRoot);
  } catch (error) {
    if (error && error.code === "ENOENT") return resolvedRoot;
    throw error;
  }
}

// Creates the operator root if missing, then returns its resolved
// spelling. Writes use this so the chain below it is always addressed
// canonically.
export function ensureRoot(resolvedRoot) {
  try {
    mkdirSync(resolvedRoot);
  } catch (error) {
    if (!error || error.code !== "EEXIST") throw error;
  }
  return realpathSync(resolvedRoot);
}

// Creates a directory chain level by level under a resolved root,
// verifying each level by descriptor before descending. Returns the
// held descriptor of the deepest directory plus its canonical path;
// the caller owns the descriptor and must close it. Intermediate
// descriptors are verified and closed: the deepest descriptor's path
// check already covers the whole chain, and the leaf checks in the
// caller cover any later swap. A swap between a level's verification
// and its mkdir can strand an empty 0700 directory in the wrong tree;
// the follow-up verification refuses the operation, so it holds no data.
export function ensureVerifiedDirChain(canonicalRoot, parts) {
  let cur = canonicalRoot;
  for (let i = 0; i < parts.length; i++) {
    const next = path.join(cur, parts[i]);
    const isLast = i === parts.length - 1;
    let fd = null;
    try {
      fd = openVerifiedDir(next);
    } catch (error) {
      if (error && error.code === "ENOENT") {
        try {
          mkdirSync(next, { mode: 0o700 });
        } catch (mkdirError) {
          if (!mkdirError || mkdirError.code !== "EEXIST") throw mkdirError;
        }
        fd = openVerifiedDir(next);
      } else {
        throw error;
      }
    }
    if (isLast) return { dirFd: fd, dirPath: next };
    closeSync(fd);
    cur = next;
  }
  return { dirFd: null, dirPath: canonicalRoot };
}
