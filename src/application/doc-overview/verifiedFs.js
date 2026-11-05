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
// - CONTAINMENT INVARIANT (the actual guarantee for publication).
//   The publish rename additionally asserts, immediately before
//   renaming, that the held directory is still at its authorized
//   path — but that assert is defense-in-depth ONLY, not the
//   guarantee: it is one syscall before a separate rename syscall,
//   so a relocation interleaved between the two would still slip
//   through under an attacker-writable ancestry. A second check, or
//   a check moved closer to the rename, cannot close that window.
//   The guarantee is instead an enforced non-adversarial ancestry
//   boundary: every directory from the filesystem root down to the
//   kind directory must be rename-safe, meaning no untrusted
//   principal can rename any entry on the chain. Rename-safe for a
//   (parent, entry) pair means: if the parent is sticky, both the
//   parent's and the entry's owners are the process user or root;
//   if it is not sticky, the parent has no group/other write and
//   owner-write only by the process user or root. The boundary is
//   verified at store construction and re-verified on every
//   write-path chain build (managed levels from descriptor-pinned
//   stats, the ancestry above the root from a fresh walk), and it
//   fails closed on any adversarially mutable link. The boundary is
//   stable across the authorization-to-publication window because
//   only the owning user or root can change ownership or
//   permissions, and only a party with write on a parent can rename
//   — both ruled out for untrusted principals by the check itself.
//   With the boundary enforced, the check-before-rename window is
//   unreachable by an untrusted actor; without it, no check timing
//   would suffice. The post-rename landing check cannot undo a
//   publication, so it is belt-and-braces only.
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

// The held directory must still be at its authorized location. A
// descriptor names an inode, not a path: descriptor pinning preserves
// inode identity, NOT authorized path containment. If the directory
// was renamed out of the owner tree after verification, every
// descriptor-relative step below would still operate on that inode —
// and a rename through it would publish record bytes into the
// relocated directory. This check reads what the descriptor actually
// names, from the kernel, and refuses on any mismatch. Callers must
// invoke it at the publish boundary, immediately before the rename,
// so a relocation is refused BEFORE any bytes move: a post-rename
// check cannot undo a publication.
export function assertHeldDirAtPath(dirFd, intendedDirPath) {
  const actual = fdPath(dirFd);
  if (actual !== intendedDirPath) {
    fail(
      `refused publish: held directory is no longer at its authorized location (possible relocation): intended ${intendedDirPath}, resolved ${actual}.`,
    );
  }
}

// The process owner, from the kernel. Unavailable (non-POSIX) means
// the boundary below cannot be evaluated, so every operation that
// needs it fails closed rather than operating unverified.
function processEuid() {
  if (typeof process.geteuid !== "function") {
    fail("cannot determine the process owner (geteuid unavailable); refusing rather than operating unverified.");
  }
  return process.geteuid();
}

// A uid is trusted for boundary purposes when it is the process user
// or root. Root can rename anything regardless of permissions, so it
// is trusted by definition; every other uid must be the process user.
function trustedUid(uid) {
  const euid = processEuid();
  return uid === euid || uid === 0;
}

const S_ISVTX = 0o1000;

// Whether an untrusted principal could rename `entry` inside `parent`.
// This is the kernel's rule, not an approximation:
// - Sticky parent: only the entry's owner, the directory's owner, or
//   root can rename. Safe exactly when both owners are trusted; the
//   write bits are irrelevant to renaming (they gate creation, and a
//   sticky parent like /tmp is therefore safe for trusted-owned
//   entries despite being world-writable).
// - Non-sticky parent: anyone with write on the directory can rename,
//   so safety needs no group/other write and owner-write only by a
//   trusted owner.
function renameSafePair(parentMode, parentUid, entryUid) {
  const mode = parentMode & 0o7777;
  if (mode & S_ISVTX) {
    return trustedUid(entryUid) && trustedUid(parentUid);
  }
  if (mode & 0o020) return false;
  if (mode & 0o002) return false;
  if (mode & 0o200 && !trustedUid(parentUid)) return false;
  return true;
}

function assertRenameSafePair(parentStat, entryStat, parentPath, entryPath) {
  if (!renameSafePair(parentStat.mode, parentStat.uid, entryStat.uid)) {
    fail(
      `refused adversarially mutable ancestry: ${parentPath} is writable by untrusted principals, so ${entryPath} could be renamed out of the authorized tree (rename containment not enforced); refusing rather than publishing through a relocatable directory.`,
    );
  }
}

// Enforces the containment invariant for a store root: every
// (parent, entry) pair on the path from the filesystem root down to
// the target must be rename-safe (see renameSafePair), or the
// operation fails closed. The target itself may not exist yet: a
// not-yet-created trailing component is evaluated as a future
// directory owned by the process user (which is what the store
// creates: mode 0700), and its creation is gated by the pair above
// it. Symlinked components fail closed. The existing prefix is
// resolved to its real path first, so an operator symlink above the
// root is honored, not mistaken for an attack — but a symlink that
// appears mid-walk (a swap during the check) still fails closed.
// This check is what makes the authorization-to-publication window
// safe: once it passes, no untrusted principal holds rename rights
// anywhere on the chain, and only the owning user or root could
// change that — so no interleaving rename by an attacker is
// possible before the publish, regardless of how close any other
// check sits to the rename.
export function assertAncestryBoundary(targetPath) {
  const euid = processEuid();
  // Resolve the existing prefix to its real path; keep the
  // not-yet-created suffix literal.
  let base = path.resolve(targetPath);
  const suffix = [];
  for (;;) {
    try {
      base = realpathSync(base);
      break;
    } catch (error) {
      if (!error || error.code !== "ENOENT") throw error;
      const parent = path.dirname(base);
      if (parent === base) {
        fail(`cannot resolve a store ancestry with no existing ancestor at ${targetPath}.`);
      }
      suffix.unshift(path.basename(base));
      base = parent;
    }
  }
  const canonical = suffix.length > 0 ? path.join(base, ...suffix) : base;
  const segments = canonical.split(path.sep).filter((part) => part.length > 0);
  const chain = [path.sep];
  for (const part of segments) chain.push(path.join(chain[chain.length - 1], part));
  for (let i = 1; i < chain.length; i++) {
    const parentPath = chain[i - 1];
    const entryPath = chain[i];
    let parentStat = null;
    try {
      parentStat = lstatSync(parentPath);
    } catch (error) {
      if (!error || error.code !== "ENOENT") throw error;
      // Parent does not exist yet: its own creation is gated by the
      // pair above it, evaluated with the future entry owned by the
      // process user. Skip this pair; do not treat absence as safe.
      continue;
    }
    if (parentStat.isSymbolicLink()) {
      fail(`refused symlinked ancestor ${parentPath} in the store ancestry; refusing rather than operating through an unverified path.`);
    }
    let entryStat = null;
    try {
      entryStat = lstatSync(entryPath);
    } catch (error) {
      if (!error || error.code !== "ENOENT") throw error;
    }
    if (entryStat !== null && entryStat.isSymbolicLink()) {
      fail(`refused symlinked ancestor ${entryPath} in the store ancestry; refusing rather than operating through an unverified path.`);
    }
    const entryUid = entryStat !== null ? entryStat.uid : euid;
    assertRenameSafePair(parentStat, { uid: entryUid }, parentPath, entryPath);
  }
}

// Renames inside one verified directory, with both names resolved
// through the held descriptor: the rename cannot land in another tree
// no matter what happens to the directory's path spelling afterwards.
// Replaces the destination, as rename does; both endpoints are pinned.
// Before renaming, the held directory must still be at its intended
// (authorized) path: a directory renamed out of the owner tree after
// verification is refused here, before any bytes move.
export function renameWithinDir(dirFd, dirPath, fromName, toName) {
  for (const name of [fromName, toName]) {
    if (name.includes(path.sep) || name === "." || name === "..") {
      fail(`rename name must be a single path segment, got ${JSON.stringify(name)}.`);
    }
  }
  assertHeldDirAtPath(dirFd, dirPath);
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
// canonically. A newly created root is mode 0700, like every other
// directory the store creates: under a permissive umask a default
// mkdir would leave it group/other-writable and the store's own
// ancestry boundary would (correctly) refuse to publish under it.
export function ensureRoot(resolvedRoot) {
  try {
    mkdirSync(resolvedRoot, { mode: 0o700 });
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
//
// Containment is enforced here, on the write path, before any record
// bytes are created: the ancestry above the root must be rename-safe
// (assertAncestryBoundary), and every managed (parent, entry) pair
// must be rename-safe from descriptor-pinned stats — the root's stat
// from its own verified descriptor, each level's stat from the
// descriptor that was just verified at its intended path. A pair
// failure refuses the write with no temp file and no publication.
// This is the invariant that closes the check-before-rename window:
// with every link rename-safe, no untrusted principal can relocate
// the held directory between this enforcement and the publish.
export function ensureVerifiedDirChain(canonicalRoot, parts) {
  assertAncestryBoundary(canonicalRoot);
  let rootFd = null;
  let parentStat = null;
  let parentPath = canonicalRoot;
  try {
    rootFd = openVerifiedDir(canonicalRoot);
    parentStat = fstatSync(rootFd);
  } finally {
    if (rootFd !== null) closeSync(rootFd);
  }
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
    try {
      const levelStat = fstatSync(fd);
      assertRenameSafePair(parentStat, levelStat, parentPath, next);
      if (isLast) return { dirFd: fd, dirPath: next };
      parentStat = levelStat;
      parentPath = next;
    } catch (error) {
      closeSync(fd);
      throw error;
    }
    closeSync(fd);
    cur = next;
  }
  return { dirFd: null, dirPath: canonicalRoot };
}
