//! FORGE Capture Phase 2 — app-owned bounded SOP workspace (build slice
//! C2-P1): real filesystem confinement (symlink defeat), atomic
//! crash-safe writes with optimistic-concurrency (stale-revision)
//! rejection, the DPAPI vault adapter, and log redaction.
//!
//! Plan: `results/chatgpt/capture-ai-caption-pipeline-implementation-brief-2026-10-26.md`.
//! Pairs with [`forge_capture_core::sop_session`] (pure session/edit-event
//! contract) and [`forge_capture_core::sop_ipc`] (pure lexical path
//! confinement + IPC framing) the same way `main.rs`'s existing
//! `atomic_write` pairs with [`forge_capture_core::annotations`]: this
//! module is the one place that actually touches `std::fs` and Windows
//! crypto APIs for the SOP session workspace, so every other module
//! describing that workspace's contract stays pure and portable.
//!
//! **Why symlink defeat needs real filesystem access** (and so can't live
//! in [`forge_capture_core::sop_ipc::confine_relative_path`]'s lexical
//! check alone): a lexically clean relative path like `frames/f1.png` can
//! still resolve outside the session root if `frames` (or any ancestor
//! component actually on disk) is itself a symlink/junction pointing
//! elsewhere. The only way to catch that is to resolve the real path and
//! compare it against the real, canonicalized root — which requires the
//! path, and therefore the root, to already exist on disk.

use std::fs::{self, File};
use std::io::Write as _;
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

use forge_capture_core::sop_ipc::{confine_relative_path, PathConfinementError};

/// The Win32 `FILE_ATTRIBUTE_REPARSE_POINT` bit. Hardcoded rather than
/// pulled from the `windows` crate: this value is part of the stable
/// public Win32 ABI (`winnt.h`), and keeping it a plain constant means
/// [`is_reparse_point`] needs no extra crate feature and stays next to
/// the one other platform-specific line it has (the `#[cfg(not(windows))]`
/// fallback), rather than pulling in a dependency for a single flag.
#[cfg(windows)]
const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;

/// True if `meta` describes a reparse point (Windows: symlink, junction,
/// or any other reparse tag) or, off Windows, a symlink. Checked via
/// [`fs::symlink_metadata`] (never [`fs::metadata`], which would itself
/// follow the link before this function ever saw it).
fn is_reparse_point(meta: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
    }
    #[cfg(not(windows))]
    {
        meta.file_type().is_symlink()
    }
}

/// C2P1-RR-004: opens `path` **without following** a reparse point at the
/// leaf (`FILE_FLAG_OPEN_REPARSE_POINT`), as a directory-capable handle
/// (`FILE_FLAG_BACKUP_SEMANTICS`, required by Win32 to open a directory
/// at all through `CreateFile`). Unlike [`fs::symlink_metadata`] (a bare
/// stat call), this returns a live handle — [`resolve_confined_path`]
/// reads the reparse-point check off *this exact handle's* metadata, not
/// a separate, later stat of the same path, which closes the gap between
/// "check" and "the object actually checked" for every existing
/// component: there is no second syscall that could resolve a
/// swapped-in reparse point differently from what was just verified.
///
/// C2P1-RR-004B: opened with `share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)`
/// — explicitly **excluding only `FILE_SHARE_DELETE`** — rather than
/// `std`'s default share mode. Empirically verified on this app's target
/// platform (not assumed, and not a single pass/fail either — narrowed
/// by testing each combination):
///
/// - With the default share mode, another actor can delete *or rename*
///   this exact directory object while this process still holds an open
///   handle to it (`fs::remove_dir`/`fs::rename` both succeeded against
///   a held default-share handle).
/// - Excluding `FILE_SHARE_DELETE` (regardless of whether `FILE_SHARE_WRITE`
///   is also granted) makes both `fs::remove_dir` on the object itself
///   and creating a new object (e.g. a junction) at that same name fail
///   with `ERROR_SHARING_VIOLATION` for as long as the handle stays open
///   — the name is still occupied by the live object and nothing can
///   detach it.
/// - `FILE_SHARE_READ` *alone* (excluding `FILE_SHARE_WRITE` too) also
///   blocks renaming a **child** entry inside a held directory handle —
///   this module's own `atomic_write_with_fsync` renames a temp file
///   onto the final leaf path inside exactly such a directory, so that
///   combination would have silently broken every real write through a
///   confined path. Granting `FILE_SHARE_WRITE` back (keeping
///   `FILE_SHARE_DELETE` excluded) allows ordinary child renames to
///   succeed while still refusing deletion/replacement of the directory
///   object itself — confirmed by testing the exact rename-a-child
///   operation this module performs, not inferred from the delete/rename
///   case alone.
/// - Two of this process's own `FILE_SHARE_READ | FILE_SHARE_WRITE` opens
///   of the same object coexist without contention (also verified), so
///   this does not self-block legitimate concurrent reads within this
///   app.
///
/// This is what makes [`resolve_confined_path`]'s returned [`ConfinedPath`]
/// an actual capability rather than just a validated string: as long as
/// the caller keeps the `ConfinedPath` (and therefore every ancestor
/// handle it holds) alive through its leaf mutation, no already-verified
/// ancestor can be deleted, renamed, or replaced by anything else for the
/// full span between verification and use — closing the cross-component
/// race this module's own prior doc comments named as fundamentally
/// requiring the undocumented `NtCreateFile` NT-native API. It never did:
/// `share_mode` is a plain, documented `std` option
/// (`std::os::windows::fs::OpenOptionsExt::share_mode`), not even a
/// `windows`-crate call, let alone a hand-declared unverified one.
#[cfg(windows)]
fn open_no_follow(path: &Path) -> std::io::Result<File> {
    use std::os::windows::fs::OpenOptionsExt;
    const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;
    const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
    const FILE_SHARE_READ: u32 = 0x0000_0001;
    const FILE_SHARE_WRITE: u32 = 0x0000_0002;
    fs::OpenOptions::new()
        .read(true)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
        .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)
        .open(path)
}

/// Like [`open_no_follow`], but read+write and creates the file if it
/// doesn't exist yet — used only for the cross-process lock sidecar
/// (C2P1-RR-005A), whose own existence must not be reachable through a
/// planted reparse point any more than a session file's can. If the leaf
/// already exists AND is a reparse point, `FILE_FLAG_OPEN_REPARSE_POINT`
/// means this opens the reparse point object itself (never its target),
/// and the subsequent `LockFileEx` call in the caller operates on that —
/// safe, since a reparse point object is not the attacker's real target
/// file; it's simply not usable as a normal lock, which the caller treats
/// as an ordinary I/O error on the later read/lock attempt rather than a
/// silent follow-through.
#[cfg(windows)]
fn open_or_create_no_follow(path: &Path) -> Result<File, String> {
    use std::os::windows::fs::OpenOptionsExt;
    const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;
    const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
    fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
        .open(path)
        .map_err(|e| format!("cannot open/create no-follow lock file: {e}"))
}

/// Returns `Some(metadata)` for a component that exists (verified without
/// following a reparse point), `None` for one that doesn't exist yet, or
/// `Err` for any other failure (permission denied, etc. — never silently
/// treated as "doesn't exist"). On Windows this opens a no-follow handle
/// ([`open_no_follow`]) and reads metadata off that handle; off Windows it
/// falls back to [`fs::symlink_metadata`], which is already non-following
/// and sufficient there (the handle-based strengthening in this fix round
/// is specifically for Windows' `FILE_FLAG_OPEN_REPARSE_POINT` semantics,
/// per the C2P1-RR-004 finding, on this Windows-first app).
fn existing_component_metadata(candidate: &Path) -> Result<Option<fs::Metadata>, WorkspacePathError> {
    #[cfg(windows)]
    {
        match open_no_follow(candidate) {
            Ok(handle) => {
                let meta = handle.metadata().map_err(|_| WorkspacePathError::EscapesRoot)?;
                drop(handle);
                Ok(Some(meta))
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(_) => Err(WorkspacePathError::EscapesRoot),
        }
    }
    #[cfg(not(windows))]
    {
        match fs::symlink_metadata(candidate) {
            Ok(meta) => Ok(Some(meta)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(_) => Err(WorkspacePathError::EscapesRoot),
        }
    }
}

/// Reasons a candidate path is refused once real filesystem state is
/// available — a strict superset of what
/// [`forge_capture_core::sop_ipc::confine_relative_path`] alone can catch.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WorkspacePathError {
    Lexical(PathConfinementError),
    /// The resolved real path (following any symlinks on the way) is not
    /// inside the canonicalized workspace root.
    EscapesRoot,
    /// Canonicalizing the root itself failed (it doesn't exist, or isn't
    /// readable) — refused rather than silently falling back to a
    /// non-canonical comparison, which a symlink could defeat.
    RootNotResolvable,
    /// C2P1-RR-004A: an intermediate directory component of `relative`
    /// does not exist yet, and [`resolve_confined_path`] will not create
    /// one on an untrusted caller's behalf — see that function's doc
    /// comment. Establish the fixed, trusted subdirectory first via
    /// [`ensure_workspace_subdirectory`].
    IntermediateDirectoryMissing,
    /// [`ensure_workspace_subdirectory`]'s `name` argument was not
    /// exactly one path component (contained `/` or `\`) — that function
    /// creates exactly one hardcoded subdirectory directly under the
    /// root, never a nested path.
    NotASingleComponent,
    /// Opening or verifying the workspace root itself failed — see
    /// [`WorkspaceRoot::open`].
    RootNotOpenable,
}

/// A verified, **held-open** handle to a workspace's root directory —
/// the one external identity every [`resolve_confined_path`] call and
/// every [`CrossProcessSessionLock`] acquisition for that workspace is
/// bound to, in place of either the session file's own identity (which
/// this module's own writes replace on every rename — C2P1-RR-005B) or
/// any single accepted alias path for it (which a hard link in a
/// different directory still legitimately is — C2P1-RR-005C).
///
/// Opened with [`open_no_follow`]'s delete-excluding share mode and
/// kept alive for as long as this value lives: empirically, that means
/// nothing else can delete, rename, or recreate the root directory while
/// a `WorkspaceRoot` for it is open (see [`open_no_follow`]'s doc comment
/// for the verified mechanism). Callers open one fresh per logical
/// operation (a single confined-path resolution, or a single
/// `write_session_if_current` call) and let it drop when that operation
/// finishes — the same per-operation acquire/release shape
/// [`CrossProcessSessionLock`] already uses, not a long-lived cached
/// handle this module would need to invalidate.
#[cfg(windows)]
#[derive(Debug)]
pub struct WorkspaceRoot {
    _handle: File,
    canonical_path: PathBuf,
    stable_id: StableFileId,
}

#[cfg(windows)]
impl WorkspaceRoot {
    pub fn open(root: &Path) -> Result<Self, WorkspacePathError> {
        let canonical_path = fs::canonicalize(root).map_err(|_| WorkspacePathError::RootNotResolvable)?;
        let handle = open_no_follow(&canonical_path).map_err(|_| WorkspacePathError::RootNotOpenable)?;
        let meta = handle.metadata().map_err(|_| WorkspacePathError::RootNotOpenable)?;
        if is_reparse_point(&meta) || !meta.is_dir() {
            return Err(WorkspacePathError::RootNotOpenable);
        }
        let stable_id = query_stable_file_id(&handle).map_err(|_| WorkspacePathError::RootNotOpenable)?;
        Ok(Self { _handle: handle, canonical_path, stable_id })
    }

    pub fn canonical_path(&self) -> &Path {
        &self.canonical_path
    }
}

#[cfg(not(windows))]
#[derive(Debug)]
pub struct WorkspaceRoot {
    canonical_path: PathBuf,
}

#[cfg(not(windows))]
impl WorkspaceRoot {
    pub fn open(root: &Path) -> Result<Self, WorkspacePathError> {
        let canonical_path = fs::canonicalize(root).map_err(|_| WorkspacePathError::RootNotResolvable)?;
        Ok(Self { canonical_path })
    }

    pub fn canonical_path(&self) -> &Path {
        &self.canonical_path
    }
}

/// A path proven confined to a [`WorkspaceRoot`], returned by
/// [`resolve_confined_path`]. On Windows, also holds an open,
/// restrictively-shared handle for every *intermediate* ancestor
/// component the resolution walked through (never the leaf, and never
/// the root itself — the root's own handle lives in the [`WorkspaceRoot`]
/// the caller must keep alive alongside this value).
///
/// **C2P1-RR-004B fix:** keeping this value alive through the caller's
/// actual leaf mutation (see [`ConfinedPath::atomic_write_with_fsync`])
/// keeps every verified ancestor's handle open for that entire span —
/// per [`open_no_follow`]'s empirically-verified share mode, nothing else
/// can delete, rename, or replace any of them while this value hasn't
/// been dropped yet. A `ConfinedPath` dropped immediately after
/// resolution (never used to perform the mutation) provides no such
/// guarantee — the guarantee comes from the mutation happening *through*
/// this value, not merely after it was constructed.
///
/// **C2P1-RR-004C fix:** also carries the `workspace_root` it was
/// resolved against, as a precomputed lock path (see
/// [`CrossProcessSessionLock::lock_path_for`]) rather than a second,
/// separately-trusted argument. The RR-004B fix built a real capability
/// (this struct) but [`write_session_if_current`] did not originally
/// require it — it took a raw `session_path` and a `workspace_root` as
/// two unrelated arguments and mutated through the free, unguarded
/// `atomic_write_with_fsync`/`read_current_revision` functions, so the
/// capability existed but was optional, and nothing proved the two
/// arguments actually agreed with each other. [`write_session_if_current`]
/// now takes only a `&ConfinedPath` — there is no second root argument
/// left to be "unrelated", because there is no second argument.
///
/// **C2P1-RR-004D / RR-005D fix:** also borrows the originating
/// [`WorkspaceRoot`] itself (`'a`), not merely a path or id copied out of
/// it. Before this, nothing here kept that `WorkspaceRoot` (and the
/// delete-excluding handle on the root directory it holds) alive for
/// this value's own lifetime — a caller could write
/// `resolve_confined_path(&WorkspaceRoot::open(&root)?, "x")`, let the
/// temporary `WorkspaceRoot` drop at the end of that statement, and only
/// then perform the production mutation with the root's own handle
/// already closed and nothing left to stop the root directory itself
/// from being renamed or replaced — sharpest in the direct-leaf case,
/// where `_ancestor_guards` is empty and there was no held handle
/// anywhere in the capability. Holding `&'a WorkspaceRoot` fixes this
/// doubly: Rust's borrow checker now refuses to compile that exact
/// pattern (the temporary does not live long enough to satisfy `'a`),
/// and whenever it does compile, the caller's own live `WorkspaceRoot`
/// — share-mode handle included — is provably still open for as long as
/// this `ConfinedPath` is, which is what actually stops the rename.
#[derive(Debug)]
pub struct ConfinedPath<'a> {
    root: &'a WorkspaceRoot,
    path: PathBuf,
    lock_path: PathBuf,
    _ancestor_guards: Vec<File>,
}

impl<'a> ConfinedPath<'a> {
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// The live [`WorkspaceRoot`] this path was resolved against —
    /// the same object `'a` is borrowed from, never a copy of its
    /// canonical path or stable id.
    pub fn workspace_root(&self) -> &WorkspaceRoot {
        self.root
    }

    fn lock_path(&self) -> &Path {
        &self.lock_path
    }

    /// Performs [`atomic_write_with_fsync`] at this confined leaf path
    /// while every ancestor guard this value holds stays open for the
    /// full call — Rust's borrow checker keeps `self` (and therefore
    /// `_ancestor_guards`) alive until this call returns, which is the
    /// entire C2P1-RR-004B fix: the mutation happens *through* the held
    /// capability, not merely after it was checked.
    pub fn atomic_write_with_fsync(&self, bytes: &[u8]) -> Result<(), String> {
        atomic_write_with_fsync(&self.path, bytes)
    }
}

/// Resolves `relative` against `workspace_root`, refusing anything that
/// would escape it either lexically (per
/// [`forge_capture_core::sop_ipc::confine_relative_path`]) or physically
/// (via a symlink/junction on disk). `relative`'s leaf does not need to
/// exist yet (a path being written for the first time) — but every
/// component *before* the leaf **must** already exist: this function
/// never creates an intermediate directory on an untrusted caller's
/// behalf. See [`ensure_workspace_subdirectory`] for the one,
/// trusted-only way to establish a fixed subdirectory (e.g. `"frames"`)
/// before calling this function for a leaf inside it.
///
/// Walks one path component at a time starting from
/// `workspace_root`'s canonical path, and for every component **before**
/// the leaf: opens it via [`open_no_follow`] and **keeps that handle
/// open** in the returned [`ConfinedPath`] rather than dropping it —
/// this is the C2P1-RR-004B fix. The prior version of this function
/// (C2P1-RR-004A) made itself read-only, which closed the narrower
/// "the resolver creates a directory outside root" counterexample, but
/// left the caller's later, separate leaf mutation exposed to exactly
/// the same ancestor-replacement race, just moved one step later: a
/// path returned as "confined" was still just a string by the time the
/// caller actually wrote through it, and an already-verified ancestor
/// could still be swapped in the gap between that check and that write.
///
/// Holding each intermediate's handle open for as long as the returned
/// [`ConfinedPath`] lives closes that gap for real, using only
/// `open_no_follow`'s documented, empirically-verified share mode (see
/// its doc comment) — not the undocumented, hand-declared `NtCreateFile`
/// NT-native API this module's prior rounds correctly declined to guess
/// at. This was never actually required: a *held* no-follow handle with
/// a restrictive share mode already prevents the object it points to
/// from being deleted, renamed, or replaced by anything else for as long
/// as it stays open — empirically confirmed, not assumed — which is a
/// capability strong enough to protect the whole span from verification
/// through mutation, with no relative-open primitive needed at all.
pub fn resolve_confined_path<'a>(workspace_root: &'a WorkspaceRoot, relative: &str) -> Result<ConfinedPath<'a>, WorkspacePathError> {
    confine_relative_path(relative).map_err(WorkspacePathError::Lexical)?;

    let canonical_root = workspace_root.canonical_path().to_path_buf();
    let components: Vec<&str> = relative.split(['/', '\\']).collect();
    let mut current = canonical_root.clone();
    let mut guards: Vec<File> = Vec::new();

    for (i, component) in components.iter().enumerate() {
        let candidate = current.join(component);
        let is_last = i == components.len() - 1;

        if is_last {
            // The leaf's own handling (existence optional, exclusive
            // no-follow create/replace) is the caller's separate,
            // already-reviewed concern (C2P1-RR-004's original scope) —
            // this just refuses a reparse point already sitting there.
            if let Some(meta) = existing_component_metadata(&candidate)? {
                if is_reparse_point(&meta) {
                    return Err(WorkspacePathError::EscapesRoot);
                }
            }
            current = candidate;
            continue;
        }

        #[cfg(windows)]
        {
            match open_no_follow(&candidate) {
                Ok(handle) => {
                    let meta = handle.metadata().map_err(|_| WorkspacePathError::EscapesRoot)?;
                    if is_reparse_point(&meta) || !meta.is_dir() {
                        return Err(WorkspacePathError::EscapesRoot);
                    }
                    // Retained, not dropped — see this function's and
                    // `ConfinedPath`'s doc comments for why.
                    guards.push(handle);
                }
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                    return Err(WorkspacePathError::IntermediateDirectoryMissing);
                }
                Err(_) => return Err(WorkspacePathError::EscapesRoot),
            }
        }
        #[cfg(not(windows))]
        {
            match existing_component_metadata(&candidate)? {
                Some(meta) => {
                    if is_reparse_point(&meta) || !meta.is_dir() {
                        return Err(WorkspacePathError::EscapesRoot);
                    }
                }
                None => return Err(WorkspacePathError::IntermediateDirectoryMissing),
            }
        }
        current = candidate;
    }

    // Final containment proof: canonicalize whatever portion of `current`
    // actually exists on disk (the leaf itself if it was already there,
    // otherwise its parent, which the loop above has already proven is
    // not a reparse point) and require it to still resolve under the
    // canonical root. Every intermediate walked above is still held open
    // in `guards` at this point, so this canonicalize cannot be racing
    // against a swap that could still happen after this check returns —
    // the swap itself is refused for as long as `guards` (returned to
    // the caller inside `ConfinedPath`) stays alive.
    let verify_target = if current.exists() { current.clone() } else { current.parent().unwrap_or(&canonical_root).to_path_buf() };
    let canonical_verify = fs::canonicalize(&verify_target).map_err(|_| WorkspacePathError::EscapesRoot)?;
    if !canonical_verify.starts_with(&canonical_root) {
        return Err(WorkspacePathError::EscapesRoot);
    }

    let lock_path = CrossProcessSessionLock::lock_path_for(workspace_root);
    Ok(ConfinedPath { root: workspace_root, path: current, lock_path, _ancestor_guards: guards })
}

/// Creates (idempotently) exactly one fixed subdirectory directly under
/// `workspace_root`, verifying it the same way [`resolve_confined_path`]
/// verifies every component it walks. This is the **only** place in this
/// module that creates a directory from a name — specifically so
/// creation never has to happen in response to untrusted, per-call
/// `relative` input. Callers must pass a single, hardcoded,
/// non-attacker-controlled component (e.g. `"frames"`) at workspace
/// setup time — never anything built from caption text, a filename a
/// user chose, or any other untrusted source.
///
/// `name` must be exactly one path component — this function is not a
/// nested-path creator, and accepting `/`/`\` in `name` would reopen
/// the same multi-hop surface [`resolve_confined_path`] closes.
///
/// Reuses `workspace_root`'s already-verified canonical path rather than
/// re-canonicalizing — the one child this call creates is a direct child
/// of a root already proven real and already held open by the caller,
/// so there is no earlier, separately-timed verification of an
/// intermediate for an attacker to race against, because there is no
/// intermediate: `name` is always a direct child of `workspace_root`.
pub fn ensure_workspace_subdirectory(workspace_root: &WorkspaceRoot, name: &str) -> Result<PathBuf, WorkspacePathError> {
    confine_relative_path(name).map_err(WorkspacePathError::Lexical)?;
    if name.contains('/') || name.contains('\\') {
        return Err(WorkspacePathError::NotASingleComponent);
    }

    let candidate = workspace_root.canonical_path().join(name);

    match existing_component_metadata(&candidate)? {
        Some(meta) => {
            if is_reparse_point(&meta) || !meta.is_dir() {
                return Err(WorkspacePathError::EscapesRoot);
            }
        }
        None => {
            fs::create_dir(&candidate).map_err(|_| WorkspacePathError::EscapesRoot)?;
            let meta = existing_component_metadata(&candidate)?.ok_or(WorkspacePathError::EscapesRoot)?;
            if is_reparse_point(&meta) || !meta.is_dir() {
                return Err(WorkspacePathError::EscapesRoot);
            }
        }
    }

    Ok(candidate)
}

/// Marker infix every temporary file this module creates carries, so a
/// crash-recovery sweep ([`cleanup_orphaned_temp_files`]) can recognize
/// its own orphans and nothing else.
const TEMP_INFIX: &str = ".tmp-";

/// Builds an unpredictable temp-file suffix from a process ID, a
/// monotonic per-process counter, a high-resolution timestamp, and the
/// address of a stack value, all folded through SHA-256. This is not a
/// CSPRNG — no `rand`/OS-RNG dependency is pulled in for it — but it does
/// not need to be: the actual escape-prevention guarantee comes from
/// [`File::create_new`]'s exclusivity (the create fails if anything,
/// attacker-planted or not, already occupies the name). Randomizing the
/// name on top of that just makes a pre-planted guess astronomically
/// unlikely to ever line up with a real write in the first place.
fn random_temp_suffix() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let counter = COUNTER.fetch_add(1, Ordering::Relaxed);
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let stack_addr = &counter as *const u64 as usize;

    let mut hasher = Sha256::new();
    hasher.update(std::process::id().to_le_bytes());
    hasher.update(counter.to_le_bytes());
    hasher.update(nanos.to_le_bytes());
    hasher.update(stack_addr.to_le_bytes());
    let digest = hasher.finalize();
    digest.iter().take(8).map(|b| format!("{b:02x}")).collect()
}

/// How many randomized names [`create_exclusive_temp_file`] will try
/// before giving up — collisions should never actually happen (64 bits
/// of entropy per attempt), this just bounds pathological retry loops.
const MAX_TEMP_CREATE_ATTEMPTS: u32 = 8;

/// Creates a new, empty file at `dir/{file_name}{TEMP_INFIX}{random}`
/// using an exclusive create (`create_new`, Windows' O_EXCL-equivalent —
/// fails rather than truncating or opening if anything already exists at
/// that exact name), retrying with a fresh random suffix on an
/// already-exists collision. Returns the path actually created.
fn create_exclusive_temp_file(dir: &Path, file_name: &str) -> Result<(PathBuf, File), String> {
    let mut last_err = None;
    for _ in 0..MAX_TEMP_CREATE_ATTEMPTS {
        let candidate = dir.join(format!("{file_name}{TEMP_INFIX}{}", random_temp_suffix()));
        match File::options().write(true).create_new(true).open(&candidate) {
            Ok(file) => return Ok((candidate, file)),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                last_err = Some(e);
                continue;
            }
            Err(e) => return Err(format!("cannot create temp file: {e}")),
        }
    }
    Err(format!(
        "cannot create a unique temp file after {MAX_TEMP_CREATE_ATTEMPTS} attempts: {}",
        last_err.map(|e| e.to_string()).unwrap_or_default()
    ))
}

/// Best-effort crash-recovery sweep: a prior write that crashed between
/// creating its temp file and renaming it over `path` leaves an orphaned
/// `{file_name}.tmp-*` sibling behind (the real file at `path`, if any,
/// was never touched — rename is the only step that mutates it). Called
/// while holding the session's lock (see [`write_session_if_current`])
/// so it never races a write actually in flight. Failures are swallowed:
/// this is tidiness, not correctness — a leftover temp file is inert and
/// never read by anything.
fn cleanup_orphaned_temp_files(path: &Path) {
    let (Some(dir), Some(file_name)) = (path.parent(), path.file_name().map(|n| n.to_string_lossy().into_owned())) else {
        return;
    };
    let prefix = format!("{file_name}{TEMP_INFIX}");
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        if entry.file_name().to_string_lossy().starts_with(&prefix) {
            let _ = fs::remove_file(entry.path());
        }
    }
}

/// Best-effort `FlushFileBuffers` on the directory containing `path`,
/// giving the rename below the same "durable before we report success"
/// property on Windows that an `fsync` gives the file's own data — not
/// every filesystem/driver supports flushing a directory handle, so a
/// failure here is swallowed rather than turned into a write failure.
#[cfg(windows)]
fn sync_containing_directory(path: &Path) {
    use windows::Win32::Storage::FileSystem::{
        CreateFileW, FlushFileBuffers, FILE_FLAG_BACKUP_SEMANTICS, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
    };
    use windows::Win32::Foundation::{CloseHandle, GENERIC_READ};
    use windows::core::HSTRING;

    let Some(dir) = path.parent() else { return };
    let wide = HSTRING::from(dir.as_os_str());
    // SAFETY: `wide` is a valid, NUL-terminated wide string for the call
    // duration; the returned handle is checked for validity and always
    // closed via `CloseHandle` before returning, on every path.
    unsafe {
        let Ok(handle) = CreateFileW(
            &wide,
            GENERIC_READ.0,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            None,
            OPEN_EXISTING,
            FILE_FLAG_BACKUP_SEMANTICS,
            None,
        ) else {
            return;
        };
        let _ = FlushFileBuffers(handle);
        let _ = CloseHandle(handle);
    }
}

#[cfg(not(windows))]
fn sync_containing_directory(_path: &Path) {}

/// Mirrors `main.rs`'s `atomic_write` (temp file in the same directory,
/// renamed over the target) but adds what the brief calls out
/// specifically for the SOP session: an explicit `fsync` before the
/// rename (brief §4: "Atomic write is temp + fsync + rename"), a
/// randomized *exclusive* temp name (see [`create_exclusive_temp_file`])
/// rather than a predictable PID-based one, a no-follow check on the
/// rename destination so a reparse point swapped in at `path` between
/// resolution and write is refused rather than replaced-through, and a
/// best-effort directory flush after the rename.
///
/// **C2P1-RR-004C:** not `pub` — the only sanctioned way to reach this is
/// [`ConfinedPath::atomic_write_with_fsync`], which keeps every verified
/// ancestor's guard handle alive for the call. A `pub` free function
/// taking a bare `&Path` was exactly the "raw-path mutation escape
/// hatch" the RR-004C finding named: nothing outside this module calls
/// it today (no Tauri wiring yet), and nothing should be able to without
/// going through the capability.
fn atomic_write_with_fsync(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let dir = path.parent().ok_or_else(|| "path has no parent directory".to_string())?;
    let file_name = path
        .file_name()
        .ok_or_else(|| "path has no file name".to_string())?
        .to_string_lossy()
        .into_owned();

    let (tmp_path, mut file) = create_exclusive_temp_file(dir, &file_name)?;

    file.write_all(bytes).map_err(|e| {
        let _ = fs::remove_file(&tmp_path);
        format!("cannot write temp file: {e}")
    })?;
    file.sync_all().map_err(|e| {
        let _ = fs::remove_file(&tmp_path);
        format!("cannot fsync temp file: {e}")
    })?;
    drop(file);

    // Verify the leaf we're about to replace, right up until the
    // replacement itself: if something has swapped a reparse point in
    // at `path` since it was resolved, refuse rather than following or
    // overwriting through it. `existing_component_metadata` uses a
    // no-follow handle open (not a separate stat) on Windows per
    // C2P1-RR-004 — this narrows, but (without an `openat`-equivalent
    // through plain `std`) cannot fully close, the window between this
    // check and the rename immediately below.
    if let Ok(Some(existing)) = existing_component_metadata(path) {
        if is_reparse_point(&existing) {
            let _ = fs::remove_file(&tmp_path);
            return Err("refusing to replace a reparse point at the session path".to_string());
        }
    }

    fs::rename(&tmp_path, path).map_err(|e| {
        let _ = fs::remove_file(&tmp_path);
        format!("cannot finalize file: {e}")
    })?;

    sync_containing_directory(path);
    Ok(())
}

/// Reads the `revision` field out of an on-disk session JSON file without
/// fully deserializing/validating the rest of it — used immediately
/// before [`atomic_write_with_fsync`] to decide whether the caller's
/// `expected_revision` is still current. A missing file is revision 0
/// (no session written yet), never an error — a brand-new session has
/// nothing to be stale against. Refuses (rather than reads through) a
/// leaf that turns out to be a reparse point.
///
/// Not `pub` (C2P1-RR-004C) — called only from [`write_session_if_current`]
/// against a [`ConfinedPath`]'s own path, never directly by an outside
/// caller with a bare, unverified path.
fn read_current_revision(path: &Path) -> Result<u64, String> {
    match existing_component_metadata(path) {
        Ok(Some(meta)) if is_reparse_point(&meta) => {
            return Err("refusing to read a reparse point at the session path".to_string());
        }
        Ok(Some(_)) => {}
        Ok(None) => return Ok(0),
        Err(_) => return Err("cannot stat session file".to_string()),
    }
    match fs::read(path) {
        Ok(bytes) => {
            #[derive(serde::Deserialize)]
            struct RevisionProbe {
                revision: u64,
            }
            let probe: RevisionProbe =
                serde_json::from_slice(&bytes).map_err(|e| format!("cannot read current revision: {e}"))?;
            Ok(probe.revision)
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(0),
        Err(e) => Err(format!("cannot read session file: {e}")),
    }
}

/// Per-workspace serialization primitive: every [`write_session_if_current`]
/// call for the same workspace takes the same in-process lock across its
/// entire read-validate-write-rename sequence. This alone only covers
/// same-process races (two overlapping Tauri command invocations) — see
/// [`CrossProcessSessionLock`] for the C2P1-RR-005 fix that also covers a
/// second process and lexical/hard-link aliasing.
///
/// Keyed by the already-computed `lock_path` a [`ConfinedPath`] carries
/// (itself derived from [`CrossProcessSessionLock::lock_path_for`]'s
/// workspace-root identity), not by whichever specific session-file
/// alias path a caller happened to pass — C2P1-RR-005C: two threads in
/// this same process using two different accepted alias paths for the
/// same logical session (e.g. a hard link in a different subdirectory
/// of the same workspace) must still contend on the same in-process
/// lock, not merely on the OS-level one.
fn session_lock(lock_path: &Path) -> std::sync::Arc<std::sync::Mutex<()>> {
    static REGISTRY: std::sync::OnceLock<std::sync::Mutex<std::collections::HashMap<PathBuf, std::sync::Arc<std::sync::Mutex<()>>>>> =
        std::sync::OnceLock::new();
    let registry = REGISTRY.get_or_init(|| std::sync::Mutex::new(std::collections::HashMap::new()));
    let mut map = registry.lock().unwrap_or_else(|e| e.into_inner());
    map.entry(lock_path.to_path_buf()).or_insert_with(|| std::sync::Arc::new(std::sync::Mutex::new(()))).clone()
}

/// C2P1-RR-005 fix: a real, OS-enforced, cross-process exclusive lock —
/// the in-process `session_lock` above is necessary but not sufficient,
/// since it's bypassed entirely by a second process (a second app launch
/// against the same vault) or by two different lexical path strings that
/// happen to resolve to the same real file.
///
/// Held via `LockFileEx` on a dedicated sidecar file directly under the
/// workspace root — never on the session file itself, so the lock's own
/// existence/lifecycle never interferes with the session file's
/// atomic-rename replacement.
///
/// Keyed by the **[`WorkspaceRoot`]'s own stable identity** — not the
/// session file's identity, not any specific parent-directory path, and
/// not a derived path string. Three prior schemes were tried and all
/// three broke:
///
/// - C2P1-RR-005A: canonicalizing only the parent directory and
///   lowercasing the caller-supplied file name let an alternate accepted
///   name for the same existing file (an 8.3 short name, or a hard link)
///   bypass the lock, since none of those change the *string* that
///   scheme hashed.
/// - C2P1-RR-005B: binding to the session file's own `FILE_ID_INFO`
///   fixed that, but broke differently — this module's own
///   `atomic_write_with_fsync` replaces that file's inode on every
///   successful write by design, so the "stable" identity changed out
///   from under a lock a writer was still holding, letting a late
///   caller compute a different, uncontended key.
/// - C2P1-RR-005C: binding to the session's *parent directory's*
///   `FILE_ID_INFO` fixed both of the above, but a true NTFS hard link
///   can name the same file from a **different directory** on the same
///   volume — `root/a/session.json` and `root/b/session-alias.json` are
///   not, as the C2P1-RR-005B fix's own doc comment incorrectly assumed,
///   "by definition" in the same directory. Two different parent
///   directories meant two different sidecars for the same logical file.
///
/// Binding to the **workspace root's** identity instead — the one
/// external identity every accepted alias for a session is reachable
/// under, established once per operation via [`WorkspaceRoot::open`],
/// never re-derived from whichever specific sub-path a caller used —
/// fixes all three at once: it does not depend on the session file's own
/// replaceable identity, does not depend on which of possibly several
/// parent directories an alias happens to live in, and is queried once
/// up front rather than re-resolved mid-operation, so there is no
/// transition for a concurrent caller to land on the wrong side of.
#[cfg(windows)]
struct CrossProcessSessionLock {
    file: File,
}

#[cfg(windows)]
impl CrossProcessSessionLock {
    /// The lock path is derived **only** from `workspace_root`'s own
    /// stable NTFS identity (queried once, at [`WorkspaceRoot::open`]
    /// time) — never from the session file, never from a parent
    /// directory of one specific alias path, and with no separate
    /// "bootstrap" scheme for a not-yet-created session file, since the
    /// workspace root itself is expected to already exist for every
    /// caller.
    fn lock_path_for(workspace_root: &WorkspaceRoot) -> PathBuf {
        workspace_root.canonical_path().join(format!(
            "{}-{}.session.lock",
            workspace_root.stable_id.volume_serial_hex(),
            workspace_root.stable_id.file_id_hex()
        ))
    }

    /// Acquires the lock at an already-computed `lock_path` (see
    /// [`Self::lock_path_for`]), blocking the calling thread until it's
    /// available. The lock file is created if it doesn't exist yet (its
    /// own content is never read or written — it exists purely as a
    /// stable name `LockFileEx` can hold a byte-range lock on), and is
    /// itself opened without following a reparse point — a lock "file"
    /// that turned out to be a planted symlink must never be locked or
    /// written through.
    ///
    /// Takes the path directly, not a `&WorkspaceRoot`, so that
    /// [`ConfinedPath`] (C2P1-RR-004C) can carry its own precomputed lock
    /// path and acquire against it without a second, separately-trusted
    /// root argument that could disagree with the one `ConfinedPath` was
    /// actually resolved against.
    fn acquire(lock_path: &Path) -> Result<Self, String> {
        let file = open_or_create_no_follow(lock_path)?;
        lock_file_exclusive_blocking(&file)?;
        Ok(Self { file })
    }
}

/// A 128-bit NTFS file identifier plus the volume it lives on — the
/// stable identity [`CrossProcessSessionLock`] binds to for an existing
/// session file. Two different accepted names (case, 8.3 short name,
/// hard link) for the same real file always yield the same
/// `StableFileId`; two different real files, even with colliding names
/// on different volumes, never do (the volume serial number is part of
/// the identity specifically to rule that out).
#[cfg(windows)]
#[derive(Debug)]
struct StableFileId {
    volume_serial: u64,
    file_id: [u8; 16],
}

#[cfg(windows)]
impl StableFileId {
    fn volume_serial_hex(&self) -> String {
        format!("{:016x}", self.volume_serial)
    }
    fn file_id_hex(&self) -> String {
        self.file_id.iter().map(|b| format!("{b:02x}")).collect()
    }
}

/// Queries `handle`'s real NTFS identity via `GetFileInformationByHandleEx`
/// / `FileIdInfo` (`FILE_ID_INFO`) — a standard, documented Win32 call
/// available since Windows Server 2008/Vista, not an NT-native guess.
#[cfg(windows)]
fn query_stable_file_id(handle: &File) -> Result<StableFileId, String> {
    use std::os::windows::io::AsRawHandle;
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::Storage::FileSystem::{GetFileInformationByHandleEx, FileIdInfo, FILE_ID_INFO};

    let raw = HANDLE(handle.as_raw_handle());
    // SAFETY: `raw` is valid for the duration of this call (borrowed from
    // `handle`, which outlives it); `info` is a correctly-sized,
    // zero-initialized buffer the call writes into.
    unsafe {
        let mut info = FILE_ID_INFO::default();
        GetFileInformationByHandleEx(
            raw,
            FileIdInfo,
            &mut info as *mut _ as *mut core::ffi::c_void,
            size_of::<FILE_ID_INFO>() as u32,
        )
        .map_err(|e| format!("GetFileInformationByHandleEx(FileIdInfo) failed: {e}"))?;
        Ok(StableFileId { volume_serial: info.VolumeSerialNumber, file_id: info.FileId.Identifier })
    }
}

#[cfg(windows)]
impl Drop for CrossProcessSessionLock {
    fn drop(&mut self) {
        let _ = unlock_file(&self.file);
        // Even if the explicit unlock above somehow failed, closing the
        // handle (which happens right after `Drop` returns, as `file` is
        // itself dropped) releases every lock Windows associates with
        // that handle — a process that dies without running this `Drop`
        // at all (crash) still has its lock released by the OS when the
        // handle table entry is torn down, so a crashed writer can never
        // permanently wedge the lock.
    }
}

#[cfg(windows)]
fn lock_file_exclusive_blocking(file: &File) -> Result<(), String> {
    use std::os::windows::io::AsRawHandle;
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::Storage::FileSystem::{LockFileEx, LOCKFILE_EXCLUSIVE_LOCK};
    use windows::Win32::System::IO::OVERLAPPED;

    let handle = HANDLE(file.as_raw_handle());
    // SAFETY: `handle` is valid for the duration of this call (borrowed
    // from `file`, which outlives it). `overlapped` is zeroed and local;
    // without `LOCKFILE_FAIL_IMMEDIATELY`, this call blocks synchronously
    // on the calling thread until the lock is acquired, which is the
    // documented behavior for a handle not opened with
    // `FILE_FLAG_OVERLAPPED` (this one isn't).
    unsafe {
        let mut overlapped = OVERLAPPED::default();
        LockFileEx(handle, LOCKFILE_EXCLUSIVE_LOCK, None, u32::MAX, u32::MAX, &mut overlapped)
            .map_err(|e| format!("LockFileEx failed: {e}"))
    }
}

#[cfg(windows)]
fn unlock_file(file: &File) -> Result<(), String> {
    use std::os::windows::io::AsRawHandle;
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::Storage::FileSystem::UnlockFile;

    let handle = HANDLE(file.as_raw_handle());
    // SAFETY: `handle` is valid for the duration of this call.
    unsafe { UnlockFile(handle, 0, 0, u32::MAX, u32::MAX).map_err(|e| format!("UnlockFile failed: {e}")) }
}

#[cfg(not(windows))]
struct CrossProcessSessionLock;

#[cfg(not(windows))]
impl CrossProcessSessionLock {
    fn lock_path_for(workspace_root: &WorkspaceRoot) -> PathBuf {
        workspace_root.canonical_path().join(".session.lock")
    }

    fn acquire(_lock_path: &Path) -> Result<Self, String> {
        Ok(Self)
    }
}

/// Writes a session file, but only if `expected_revision` still matches
/// what's actually on disk — otherwise refuses with
/// [`forge_capture_core::sop_session::StaleRevisionError`] and writes
/// nothing, leaving the existing file exactly as it was.
///
/// **C2P1-RR-004C fix:** takes a live [`ConfinedPath`] — produced only
/// by [`resolve_confined_path`], which requires an already-open
/// [`WorkspaceRoot`] — rather than a raw `session_path` and a separate
/// `workspace_root` as two independently-trusted arguments. The RR-004B
/// round built `ConfinedPath` as a real capability (ancestor guards held
/// through a mutation) but this function did not originally require it:
/// it took a raw path and mutated through the free, unguarded
/// `atomic_write_with_fsync`/`read_current_revision`, so the exact
/// cross-component ancestor-swap race the capability exists to close was
/// never actually closed on the session-write path — the capability was
/// optional, and nothing proved a caller's `session_path` actually
/// agreed with its `workspace_root`. There is no such gap now: a
/// `ConfinedPath` already proves containment and already carries the
/// correct lock path for the root it was resolved against (see
/// [`CrossProcessSessionLock::lock_path_for`]), so this function has
/// nothing left to trust blindly.
///
/// **C2P1-RR-004D / RR-005D fix:** `confined`'s `'a` borrow of its
/// originating [`WorkspaceRoot`] (see [`ConfinedPath`]'s own doc comment)
/// means a caller cannot reach this function at all with the root's own
/// handle already closed — the borrow checker requires the `WorkspaceRoot`
/// this `ConfinedPath` came from to still be alive at this call site, so
/// the root directory can never have been renamed or replaced out from
/// under either the lock path or the mutation target between resolution
/// and this write.
///
/// Holds [`session_lock`] (in-process) AND [`CrossProcessSessionLock`]
/// (OS-enforced, cross-process, workspace-root-identity-keyed — the
/// C2P1-RR-005C fix) across the entire read-current-revision / check /
/// write / rename sequence — and, via `confined`, every intermediate
/// ancestor's guard handle stays open for that same span too (the
/// RR-004C fix) — so overlapping callers racing for the same
/// `expected_revision` — whether two command invocations in this process,
/// two separate app launches against the same vault, or two different
/// accepted alias paths for the same real file, even across different
/// parent directories under the same workspace — are strictly
/// serialized: whichever acquires both locks first reads the true
/// current revision, succeeds, and advances it; every other caller then
/// reads the *new* current revision under the same locks and is
/// correctly rejected as stale, rather than any of them having read the
/// old revision before one wrote (the prior check-then-act race) — and
/// no already-verified ancestor directory can be swapped out from under
/// any of it while `confined` is alive.
pub fn write_session_if_current(
    confined: &ConfinedPath<'_>,
    expected_revision: u64,
    bytes: &[u8],
) -> Result<(), SessionWriteError> {
    let lock = session_lock(confined.lock_path());
    let _guard = lock.lock().unwrap_or_else(|e| e.into_inner());

    // C2P1-RR-005: the in-process mutex above only ever protected against
    // overlapping calls IN THIS PROCESS. A second process, or an
    // alternate accepted alias for the same real file, bypassed it
    // entirely. This holds a real OS-enforced lock, keyed by the
    // workspace root's own identity, across the exact same
    // read-validate-write span.
    let _cross_process_guard =
        CrossProcessSessionLock::acquire(confined.lock_path()).map_err(SessionWriteError::Io)?;

    let current = read_current_revision(confined.path()).map_err(SessionWriteError::Io)?;
    forge_capture_core::sop_session::check_expected_revision(current, expected_revision)
        .map_err(SessionWriteError::Stale)?;
    cleanup_orphaned_temp_files(confined.path());
    confined.atomic_write_with_fsync(bytes).map_err(SessionWriteError::Io)
}

#[derive(Debug)]
pub enum SessionWriteError {
    Stale(forge_capture_core::sop_session::StaleRevisionError),
    Io(String),
}

/// Field names [`redact_log_fields`] blanks out before a value is ever
/// formatted for a log line — brief §4: "No key, raw pixels, OCR text, or
/// detected sensitive value is written to logs."
pub const LOG_REDACTED_FIELD_NAMES: &[&str] = &[
    "raw_pixels",
    "rawPixels",
    "ocr_text",
    "ocrText",
    "token_text",
    "tokenText",
    "dpapi_key",
    "dpapiKey",
    "plaintext",
    "redaction_candidate_value",
    "redactionCandidateValue",
    "window_title",
    "windowTitle",
];

/// Takes a flat `(field name, value)` list (what a structured log call
/// site builds right before formatting) and returns the same list with
/// every value whose field name matches [`LOG_REDACTED_FIELD_NAMES`]
/// replaced by a fixed placeholder — never the real value, never a
/// partial/truncated version of it that could still leak content.
pub fn redact_log_fields(fields: &[(&str, String)]) -> Vec<(String, String)> {
    fields
        .iter()
        .map(|(name, value)| {
            let is_sensitive = LOG_REDACTED_FIELD_NAMES.iter().any(|f| f.eq_ignore_ascii_case(name));
            if is_sensitive {
                (name.to_string(), "[redacted]".to_string())
            } else {
                (name.to_string(), value.clone())
            }
        })
        .collect()
}

// --- DPAPI vault adapter (Windows only) ---
//
// Current-user scope (no CRYPTPROTECT_LOCAL_MACHINE flag), UI forbidden
// (CRYPTPROTECT_UI_FORBIDDEN — a DPAPI call that would need to prompt
// fails instead of silently blocking the process). DPAPI encryption is
// the primary confidentiality control; [`restrict_vault_acl`] below is
// the brief's separately required ACL restriction on the vault
// directory itself — defense in depth against deletion/tampering by
// another local account, not a substitute for DPAPI, and not merely
// "whatever the OS default happens to be" (the directory ACL is now a
// mechanism this module actively sets and verifies, not an inherited
// assumption).
#[derive(Debug)]
pub enum DpapiError {
    Unsupported,
    OperationFailed(String),
}

#[cfg(windows)]
pub fn dpapi_protect(plaintext: &[u8]) -> Result<Vec<u8>, DpapiError> {
    windows_dpapi::protect(plaintext)
}

#[cfg(windows)]
pub fn dpapi_unprotect(ciphertext: &[u8]) -> Result<Vec<u8>, DpapiError> {
    windows_dpapi::unprotect(ciphertext)
}

#[cfg(not(windows))]
pub fn dpapi_protect(_plaintext: &[u8]) -> Result<Vec<u8>, DpapiError> {
    Err(DpapiError::Unsupported)
}

#[cfg(not(windows))]
pub fn dpapi_unprotect(_ciphertext: &[u8]) -> Result<Vec<u8>, DpapiError> {
    Err(DpapiError::Unsupported)
}

#[cfg(windows)]
mod windows_dpapi {
    use super::DpapiError;
    use windows::Win32::Foundation::LocalFree;
    use windows::Win32::Security::Cryptography::{
        CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    pub fn protect(plaintext: &[u8]) -> Result<Vec<u8>, DpapiError> {
        // SAFETY: `in_blob` borrows `plaintext` only for the duration of
        // the call below; `out_blob` is zero-initialized and only ever
        // written to by `CryptProtectData` itself. The output buffer
        // `out_blob.pbData` is allocated by the OS (LocalAlloc under the
        // hood) and is always freed via `LocalFree` before returning,
        // on every path, including the error path.
        unsafe {
            let mut in_blob = CRYPT_INTEGER_BLOB {
                cbData: plaintext.len() as u32,
                pbData: plaintext.as_ptr() as *mut u8,
            };
            let mut out_blob = CRYPT_INTEGER_BLOB::default();
            let ok = CryptProtectData(
                &mut in_blob,
                None,
                None,
                None,
                None,
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut out_blob,
            );
            if ok.is_err() || out_blob.pbData.is_null() {
                return Err(DpapiError::OperationFailed("CryptProtectData failed".to_string()));
            }
            let result = std::slice::from_raw_parts(out_blob.pbData, out_blob.cbData as usize).to_vec();
            let _ = LocalFree(Some(windows::Win32::Foundation::HLOCAL(out_blob.pbData as *mut _)));
            Ok(result)
        }
    }

    pub fn unprotect(ciphertext: &[u8]) -> Result<Vec<u8>, DpapiError> {
        // SAFETY: same shape as `protect` above, mirrored for the inverse
        // call; `out_blob.pbData` is freed via `LocalFree` on every path.
        unsafe {
            let mut in_blob = CRYPT_INTEGER_BLOB {
                cbData: ciphertext.len() as u32,
                pbData: ciphertext.as_ptr() as *mut u8,
            };
            let mut out_blob = CRYPT_INTEGER_BLOB::default();
            let ok = CryptUnprotectData(
                &mut in_blob,
                None,
                None,
                None,
                None,
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut out_blob,
            );
            if ok.is_err() || out_blob.pbData.is_null() {
                return Err(DpapiError::OperationFailed("CryptUnprotectData failed (wrong user, or tampered data)".to_string()));
            }
            let result = std::slice::from_raw_parts(out_blob.pbData, out_blob.cbData as usize).to_vec();
            let _ = LocalFree(Some(windows::Win32::Foundation::HLOCAL(out_blob.pbData as *mut _)));
            Ok(result)
        }
    }
}

// --- vault directory ACL (Windows only) ---
//
// Brief §4: raw session frames are "encrypted at rest with Windows DPAPI
// current-user scope in an ACL-restricted session vault." DPAPI already
// binds decryption to the current user; this restricts the *directory*
// itself to a single-ACE DACL granting full control only to the current
// user's SID, with inheritance from the parent (ordinarily
// current-user-only already, but not guaranteed — e.g. a roaming
// profile or a misconfigured parent ACL) explicitly cut via
// `PROTECTED_DACL_SECURITY_INFORMATION`.
#[derive(Debug)]
pub enum VaultAclError {
    Unsupported,
    OperationFailed(String),
}

#[cfg(windows)]
pub fn restrict_vault_acl(dir: &Path) -> Result<(), VaultAclError> {
    windows_acl::restrict(dir)
}

#[cfg(windows)]
pub fn verify_vault_acl_is_current_user_only(dir: &Path) -> Result<(), VaultAclError> {
    windows_acl::verify_current_user_only(dir)
}

#[cfg(not(windows))]
pub fn restrict_vault_acl(_dir: &Path) -> Result<(), VaultAclError> {
    Err(VaultAclError::Unsupported)
}

#[cfg(not(windows))]
pub fn verify_vault_acl_is_current_user_only(_dir: &Path) -> Result<(), VaultAclError> {
    Err(VaultAclError::Unsupported)
}

#[cfg(windows)]
mod windows_acl {
    use super::VaultAclError;
    use std::path::Path;

    use windows::core::HSTRING;
    use windows::Win32::Foundation::{CloseHandle, LocalFree, HANDLE, HLOCAL};
    use windows::Win32::Security::Authorization::{
        GetNamedSecurityInfoW, SetNamedSecurityInfoW, SE_FILE_OBJECT,
    };
    use windows::Win32::Security::{
        AddAccessAllowedAce, GetAce, GetAclInformation, GetLengthSid, GetTokenInformation, EqualSid,
        InitializeAcl, AclSizeInformation, ACL, ACL_REVISION, ACL_SIZE_INFORMATION, DACL_SECURITY_INFORMATION,
        PROTECTED_DACL_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR, PSID, TOKEN_QUERY, TOKEN_USER, TokenUser,
    };
    use windows::Win32::Storage::FileSystem::FILE_ALL_ACCESS;
    use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    /// Win32 `ACCESS_ALLOWED_ACE_TYPE` (`winnt.h`) — not re-exported by
    /// the `windows` crate's binding of this struct family, so hardcoded
    /// as the stable ABI constant it is (same rationale as the reparse
    /// constants at the top of this file).
    const ACCESS_ALLOWED_ACE_TYPE: u8 = 0;

    /// Runs `f` with the current process token's user SID, valid only
    /// for the duration of the call (it points into a local buffer that
    /// is dropped when `f` returns) — callers must not try to smuggle
    /// the `PSID` out.
    fn with_current_user_sid<R>(f: impl FnOnce(PSID) -> Result<R, VaultAclError>) -> Result<R, VaultAclError> {
        // SAFETY: `token` is opened and always closed via `CloseHandle`
        // before returning, on every path. `buf` is sized by the first
        // (length-probing) `GetTokenInformation` call and only read by
        // the second call into it, both referencing the same `token`.
        unsafe {
            let mut token = HANDLE::default();
            OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token)
                .map_err(|e| VaultAclError::OperationFailed(format!("OpenProcessToken: {e}")))?;

            let mut needed = 0u32;
            let _ = GetTokenInformation(token, TokenUser, None, 0, &mut needed);
            if needed == 0 {
                let _ = CloseHandle(token);
                return Err(VaultAclError::OperationFailed("GetTokenInformation returned zero length".to_string()));
            }
            let mut buf = vec![0u8; needed as usize];
            let mut written = needed;
            let result = GetTokenInformation(token, TokenUser, Some(buf.as_mut_ptr() as *mut _), needed, &mut written)
                .map_err(|e| VaultAclError::OperationFailed(format!("GetTokenInformation: {e}")));
            let _ = CloseHandle(token);
            result?;

            let token_user = &*(buf.as_ptr() as *const TOKEN_USER);
            f(token_user.User.Sid)
        }
    }

    /// Builds a single-ACE DACL (current user, [`FILE_ALL_ACCESS`] only)
    /// into `acl_buf`, sized per Microsoft's documented
    /// `sizeof(ACL) + sizeof(ACCESS_ALLOWED_ACE) - sizeof(DWORD) +
    /// SidLength` formula for one ACE, plus a small pad — returns the
    /// buffer so its lifetime outlives the `*mut ACL` callers build on
    /// top of it.
    fn build_single_ace_acl(user_sid: PSID) -> Result<Vec<u8>, VaultAclError> {
        // SAFETY: `acl_buf` is allocated to at least `acl_size` bytes
        // before `InitializeAcl`/`AddAccessAllowedAce` ever write into
        // it; `user_sid` is only read (never retained past this call).
        unsafe {
            let sid_len = GetLengthSid(user_sid);
            let acl_size = (size_of::<ACL>() as u32)
                + (size_of::<windows::Win32::Security::ACCESS_ALLOWED_ACE>() as u32 - size_of::<u32>() as u32)
                + sid_len
                + 8;
            let mut acl_buf = vec![0u8; acl_size as usize];
            InitializeAcl(acl_buf.as_mut_ptr() as *mut ACL, acl_size, ACL_REVISION)
                .map_err(|e| VaultAclError::OperationFailed(format!("InitializeAcl: {e}")))?;
            AddAccessAllowedAce(acl_buf.as_mut_ptr() as *mut ACL, ACL_REVISION, FILE_ALL_ACCESS.0, user_sid)
                .map_err(|e| VaultAclError::OperationFailed(format!("AddAccessAllowedAce: {e}")))?;
            Ok(acl_buf)
        }
    }

    pub fn restrict(dir: &Path) -> Result<(), VaultAclError> {
        with_current_user_sid(|user_sid| {
            let acl_buf = build_single_ace_acl(user_sid)?;
            let wide = HSTRING::from(dir.as_os_str());
            // SAFETY: `acl_buf` lives through this call; `wide` is a
            // valid wide string for the call's duration.
            unsafe {
                SetNamedSecurityInfoW(
                    &wide,
                    SE_FILE_OBJECT,
                    DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
                    None,
                    None,
                    Some(acl_buf.as_ptr() as *const ACL),
                    None,
                )
                .ok()
                .map_err(|e| VaultAclError::OperationFailed(format!("SetNamedSecurityInfoW: {e}")))
            }
        })
    }

    pub fn verify_current_user_only(dir: &Path) -> Result<(), VaultAclError> {
        with_current_user_sid(|user_sid| {
            let wide = HSTRING::from(dir.as_os_str());
            let mut dacl: *mut ACL = std::ptr::null_mut();
            let mut descriptor = PSECURITY_DESCRIPTOR::default();
            // SAFETY: `descriptor` is freed via `LocalFree` on every
            // path once set; `dacl` is only valid while `descriptor` is
            // alive and is never used after it is freed.
            unsafe {
                GetNamedSecurityInfoW(
                    &wide,
                    SE_FILE_OBJECT,
                    DACL_SECURITY_INFORMATION,
                    None,
                    None,
                    Some(&mut dacl),
                    None,
                    &mut descriptor,
                )
                .ok()
                .map_err(|e| VaultAclError::OperationFailed(format!("GetNamedSecurityInfoW: {e}")))?;

                let result = verify_dacl_is_single_ace_for_sid(dacl, user_sid);
                let _ = LocalFree(Some(HLOCAL(descriptor.0)));
                result
            }
        })
    }

    /// # Safety
    /// `dacl` must be a valid, live `ACL` pointer (e.g. straight out of
    /// `GetNamedSecurityInfoW`) for the duration of this call.
    unsafe fn verify_dacl_is_single_ace_for_sid(dacl: *mut ACL, expected_sid: PSID) -> Result<(), VaultAclError> {
        if dacl.is_null() {
            return Err(VaultAclError::OperationFailed("directory has no DACL".to_string()));
        }
        let mut size_info = ACL_SIZE_INFORMATION::default();
        GetAclInformation(
            dacl,
            &mut size_info as *mut _ as *mut core::ffi::c_void,
            size_of::<ACL_SIZE_INFORMATION>() as u32,
            AclSizeInformation,
        )
        .map_err(|e| VaultAclError::OperationFailed(format!("GetAclInformation: {e}")))?;

        if size_info.AceCount != 1 {
            return Err(VaultAclError::OperationFailed(format!(
                "expected exactly one ACE on the vault DACL, found {}",
                size_info.AceCount
            )));
        }

        let mut ace_ptr: *mut core::ffi::c_void = std::ptr::null_mut();
        GetAce(dacl, 0, &mut ace_ptr).map_err(|e| VaultAclError::OperationFailed(format!("GetAce: {e}")))?;
        let ace = &*(ace_ptr as *const windows::Win32::Security::ACCESS_ALLOWED_ACE);

        if ace.Header.AceType != ACCESS_ALLOWED_ACE_TYPE {
            return Err(VaultAclError::OperationFailed(
                "the vault DACL's one ACE is not an access-allowed ACE".to_string(),
            ));
        }
        if ace.Mask != FILE_ALL_ACCESS.0 {
            return Err(VaultAclError::OperationFailed(format!(
                "the vault DACL's ACE grants mask {:#x}, expected {:#x}",
                ace.Mask, FILE_ALL_ACCESS.0
            )));
        }

        // The ACE's SID bytes start where `SidStart` is declared —
        // `ACCESS_ALLOWED_ACE` is the classic Win32 "trailing variable
        // data" struct shape.
        let ace_sid = PSID(&ace.SidStart as *const u32 as *mut core::ffi::c_void);
        EqualSid(ace_sid, expected_sid)
            .map_err(|_| VaultAclError::OperationFailed("the vault DACL's one ACE is not scoped to the current user".to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("sop-ws-test-{}-{}", std::process::id(), rand_suffix()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn rand_suffix() -> u64 {
        use std::time::{SystemTime, UNIX_EPOCH};
        SystemTime::now().duration_since(UNIX_EPOCH).unwrap().subsec_nanos() as u64
    }

    fn workspace_root(root: &Path) -> WorkspaceRoot {
        WorkspaceRoot::open(root).unwrap()
    }

    // --- path escape / symlink refusal ---

    #[test]
    fn resolve_confined_path_accepts_an_ordinary_relative_path_once_its_directory_is_established() {
        let root = temp_root();
        let ws = workspace_root(&root);
        ensure_workspace_subdirectory(&ws, "frames").unwrap();
        let confined = resolve_confined_path(&ws, "frames/f1.png").unwrap();
        assert!(confined.path().starts_with(fs::canonicalize(&root).unwrap()));
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn resolve_confined_path_refuses_a_missing_intermediate_directory_rather_than_creating_it() {
        // C2P1-RR-004A: this function must never create a directory on
        // an untrusted caller's behalf - the missing `frames` directory
        // is refused, not auto-created.
        let root = temp_root();
        let ws = workspace_root(&root);
        let err = resolve_confined_path(&ws, "frames/f1.png").unwrap_err();
        assert_eq!(err, WorkspacePathError::IntermediateDirectoryMissing);
        assert!(!root.join("frames").exists(), "a missing intermediate must never be created as a side effect of resolving a path");
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    #[cfg(windows)]
    fn resolve_confined_path_mutation_survives_an_attempted_ancestor_swap_after_confinement() {
        // C2P1-RR-004B's exact named scenario: pause after the last
        // confinement check (resolve_confined_path has returned),
        // attempt to swap an already-verified ancestor to an outside
        // junction, THEN perform the real production leaf mutation -
        // and prove the attempted swap failed and no outside path or
        // byte ever changed.
        let root = temp_root();
        let outside = temp_root();
        let ws = workspace_root(&root);
        ensure_workspace_subdirectory(&ws, "frames").expect("setup: create frames dir at workspace init");

        let confined = resolve_confined_path(&ws, "frames/f1.png").unwrap();

        // Attempt the exact attack: remove the already-verified "frames"
        // ancestor and replace it with a junction pointing outside root.
        let frames_dir = root.join("frames");
        let remove_result = fs::remove_dir(&frames_dir);
        assert!(remove_result.is_err(), "the already-verified ancestor must not be removable while resolve_confined_path's guard handle is held");

        let junction_status = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J", &frames_dir.to_string_lossy(), &outside.to_string_lossy()])
            .status();
        if let Ok(status) = junction_status {
            assert!(!status.success(), "the junction swap must fail outright - the ancestor directory's name is still occupied by the live, held-open object");
        }

        // Resume the real production leaf mutation.
        confined.atomic_write_with_fsync(b"real session content").unwrap();

        // Prove containment: the write landed inside root, under
        // frames/, and nothing was ever written outside, even though
        // the attempted swap happened strictly after confinement and
        // strictly before this mutation.
        assert_eq!(fs::read(root.join("frames").join("f1.png")).unwrap(), b"real session content");
        assert!(fs::read_dir(&outside).unwrap().next().is_none(), "nothing must ever have been written outside the vault");

        drop(confined);
        fs::remove_dir_all(&root).ok();
        fs::remove_dir_all(&outside).ok();
    }

    #[test]
    #[cfg(windows)]
    fn write_session_if_current_survives_an_attempted_ancestor_swap_during_the_production_write() {
        // C2P1-RR-004C's exact required test: the ancestor-swap-survives
        // scenario above proved `ConfinedPath::atomic_write_with_fsync`
        // alone was safe. This proves the *actual public mutator*,
        // `write_session_if_current`, is too - the gap RR-004C named was
        // specifically that this function bypassed the capability
        // entirely, so proving the safe method works was not sufficient
        // evidence that the production path was safe.
        let root = temp_root();
        let outside = temp_root();
        let ws = workspace_root(&root);
        ensure_workspace_subdirectory(&ws, "a").expect("setup: create the 'a' dir at workspace init");

        let confined = confine_session_under(&ws, "a", "session.json");

        // Attempt the named separate-process-style attack: delete the
        // already-verified "a" ancestor and replace it with a junction
        // to an outside directory, strictly after resolution and
        // strictly before the production write below runs.
        let a_dir = root.join("a");
        assert!(fs::remove_dir(&a_dir).is_err(), "the already-verified ancestor must not be removable while write_session_if_current's confined-path guard is held");
        let junction_status = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J", &a_dir.to_string_lossy(), &outside.to_string_lossy()])
            .status();
        if let Ok(status) = junction_status {
            assert!(!status.success(), "the junction swap must fail outright");
        }

        // Resume the real production write - through write_session_if_current
        // itself, not the lower-level ConfinedPath method directly.
        let result = write_session_if_current(&confined, 0, br#"{"revision":1}"#);
        assert!(result.is_ok(), "{:?}", result);

        // Prove containment: the write landed inside root, under a/, and
        // nothing was ever written outside.
        assert_eq!(fs::read(root.join("a").join("session.json")).unwrap(), br#"{"revision":1}"#);
        assert!(fs::read_dir(&outside).unwrap().next().is_none(), "nothing must ever have been written outside the vault");

        drop(confined);
        fs::remove_dir_all(&root).ok();
        fs::remove_dir_all(&outside).ok();
    }

    #[test]
    fn ensure_workspace_subdirectory_creates_and_reuses_a_fixed_subdirectory() {
        let root = temp_root();
        let ws = workspace_root(&root);
        let first = ensure_workspace_subdirectory(&ws, "frames").unwrap();
        assert!(first.is_dir());
        // Idempotent: calling again for the same already-existing,
        // non-reparse-point directory succeeds and returns the same path.
        let second = ensure_workspace_subdirectory(&ws, "frames").unwrap();
        assert_eq!(first, second);
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn ensure_workspace_subdirectory_rejects_a_multi_component_name() {
        let root = temp_root();
        let ws = workspace_root(&root);
        let err = ensure_workspace_subdirectory(&ws, "frames/nested").unwrap_err();
        assert_eq!(err, WorkspacePathError::NotASingleComponent);
        assert!(!root.join("frames").exists());
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    #[cfg(windows)]
    fn ensure_workspace_subdirectory_refuses_an_existing_reparse_point_with_the_same_name() {
        let root = temp_root();
        let outside = temp_root();
        let ws = workspace_root(&root);
        let link = root.join("frames");
        let status = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J", &link.to_string_lossy(), &outside.to_string_lossy()])
            .status();
        if let Ok(status) = status {
            if status.success() {
                let err = ensure_workspace_subdirectory(&ws, "frames").unwrap_err();
                assert_eq!(err, WorkspacePathError::EscapesRoot);
            }
        }
        fs::remove_dir_all(&root).ok();
        fs::remove_dir_all(&outside).ok();
    }

    #[test]
    fn resolve_confined_path_rejects_lexical_traversal_before_touching_disk() {
        let root = temp_root();
        let ws = workspace_root(&root);
        let err = resolve_confined_path(&ws, "../escape.png").unwrap_err();
        assert_eq!(err, WorkspacePathError::Lexical(PathConfinementError::ContainsParentTraversal));
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn resolve_confined_path_rejects_a_nonexistent_root() {
        let fake_root = std::env::temp_dir().join("sop-ws-does-not-exist-at-all");
        let err = WorkspaceRoot::open(&fake_root).unwrap_err();
        assert_eq!(err, WorkspacePathError::RootNotResolvable);
    }

    #[test]
    #[cfg(unix)]
    fn resolve_confined_path_defeats_a_symlinked_subdirectory_escaping_the_root() {
        let root = temp_root();
        let outside = temp_root(); // a second, sibling directory - NOT inside root
        let ws = workspace_root(&root);
        std::os::unix::fs::symlink(&outside, root.join("escape_link")).unwrap();
        let err = resolve_confined_path(&ws, "escape_link/stolen.png").unwrap_err();
        assert_eq!(err, WorkspacePathError::EscapesRoot);
        fs::remove_dir_all(&root).ok();
        fs::remove_dir_all(&outside).ok();
    }

    #[test]
    #[cfg(windows)]
    fn resolve_confined_path_defeats_a_junction_escaping_the_root() {
        let root = temp_root();
        let outside = temp_root();
        let ws = workspace_root(&root);
        let link = root.join("escape_link");
        // Windows directory junctions don't require elevation (unlike
        // symlinks without Developer Mode); `mklink /J` is the real
        // on-disk primitive this test exercises the defense against.
        let status = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J", &link.to_string_lossy(), &outside.to_string_lossy()])
            .status();
        if let Ok(status) = status {
            if status.success() {
                let err = resolve_confined_path(&ws, "escape_link/stolen.png").unwrap_err();
                assert_eq!(err, WorkspacePathError::EscapesRoot);
            }
            // If junction creation itself failed (locked-down CI image
            // without mklink permission), skip rather than false-fail -
            // the Unix symlink test above already exercises the same
            // logic path on a platform where it's unconditionally
            // available.
        }
        fs::remove_dir_all(&root).ok();
        fs::remove_dir_all(&outside).ok();
    }

    #[test]
    #[cfg(windows)]
    fn resolve_confined_path_rejects_a_missing_outside_descendant_without_creating_it_outside_the_root() {
        let root = temp_root();
        let outside = temp_root();
        let ws = workspace_root(&root);
        let link = root.join("escape_link");
        let status = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J", &link.to_string_lossy(), &outside.to_string_lossy()])
            .status();
        if let Ok(status) = status {
            if status.success() {
                // The descendant `newdir` under `escape_link` does not
                // exist yet anywhere, and this function never creates
                // any intermediate (C2P1-RR-004A) - `escape_link` itself
                // is refused immediately as a reparse point, so `newdir`
                // is never even considered.
                let err = resolve_confined_path(&ws, "escape_link/newdir/file.png").unwrap_err();
                assert_eq!(err, WorkspacePathError::EscapesRoot);
                assert!(
                    !outside.join("newdir").exists(),
                    "rejection must create nothing outside the vault root"
                );
            }
        }
        fs::remove_dir_all(&root).ok();
        fs::remove_dir_all(&outside).ok();
    }

    #[test]
    #[cfg(windows)]
    fn resolve_confined_path_rejects_an_existing_outside_leaf_reached_through_a_junction() {
        let root = temp_root();
        let outside = temp_root();
        let ws = workspace_root(&root);
        fs::write(outside.join("secret.png"), b"not yours").unwrap();
        let link = root.join("escape_link");
        let status = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J", &link.to_string_lossy(), &outside.to_string_lossy()])
            .status();
        if let Ok(status) = status {
            if status.success() {
                let err = resolve_confined_path(&ws, "escape_link/secret.png").unwrap_err();
                assert_eq!(err, WorkspacePathError::EscapesRoot);
            }
        }
        fs::remove_dir_all(&root).ok();
        fs::remove_dir_all(&outside).ok();
    }

    // --- crash-safe atomic write ---

    #[test]
    fn atomic_write_then_read_round_trips_exactly() {
        let root = temp_root();
        let path = root.join("session.json");
        atomic_write_with_fsync(&path, b"hello world").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"hello world");
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn atomic_write_leaves_no_temp_file_behind_on_success() {
        let root = temp_root();
        let path = root.join("session.json");
        atomic_write_with_fsync(&path, b"data").unwrap();
        let leftover: Vec<_> = fs::read_dir(&root)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().contains(".tmp-"))
            .collect();
        assert!(leftover.is_empty());
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn atomic_write_never_leaves_a_partially_written_file_visible_at_the_real_path() {
        let root = temp_root();
        let path = root.join("session.json");
        atomic_write_with_fsync(&path, b"original content").unwrap();
        // Overwrite with new content - the only state ever visible at
        // `path` is either fully-old or fully-new, never a mix, because
        // the write lands at `path` only via one rename.
        atomic_write_with_fsync(&path, b"new content").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"new content");
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn atomic_write_uses_a_randomized_unpredictable_temp_name() {
        // Two independent writes must not pick the same temp name (the
        // prior PID-only scheme collided for concurrent writes within
        // one process).
        let root = temp_root();
        let seen: std::collections::HashSet<String> = (0..32).map(|_| random_temp_suffix()).collect();
        assert_eq!(seen.len(), 32, "temp suffixes must not collide across calls");
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    #[cfg(windows)]
    fn atomic_write_refuses_to_replace_a_reparse_point_planted_at_the_target_path() {
        let root = temp_root();
        let outside = temp_root();
        let path = root.join("session.json");
        let status = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J", &path.to_string_lossy(), &outside.to_string_lossy()])
            .status();
        if let Ok(status) = status {
            if status.success() {
                let err = atomic_write_with_fsync(&path, b"new content").unwrap_err();
                assert!(err.contains("reparse point"));
            }
        }
        fs::remove_dir_all(&root).ok();
        fs::remove_dir_all(&outside).ok();
    }

    #[test]
    #[cfg(windows)]
    fn read_current_revision_refuses_a_reparse_point_planted_at_the_session_path() {
        let root = temp_root();
        let outside = temp_root();
        let path = root.join("session.json");
        let status = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J", &path.to_string_lossy(), &outside.to_string_lossy()])
            .status();
        if let Ok(status) = status {
            if status.success() {
                let err = read_current_revision(&path).unwrap_err();
                assert!(err.contains("reparse point"));
            }
        }
        fs::remove_dir_all(&root).ok();
        fs::remove_dir_all(&outside).ok();
    }

    // --- stale revision ---

    #[test]
    fn read_current_revision_is_zero_for_a_session_that_does_not_exist_yet() {
        let root = temp_root();
        let path = root.join("session.json");
        assert_eq!(read_current_revision(&path).unwrap(), 0);
        fs::remove_dir_all(&root).ok();
    }

    /// Resolves a confined path for a session leaf directly under
    /// `root` (no intermediate component) — the common case most of
    /// these tests exercise. See `confine_session_under` below for the
    /// cross-directory/intermediate-ancestor cases.
    fn confine_session<'a>(ws: &'a WorkspaceRoot, leaf_name: &str) -> ConfinedPath<'a> {
        resolve_confined_path(ws, leaf_name).unwrap()
    }

    /// Resolves a confined path for a session leaf one directory down
    /// from `root` (e.g. `root/a/session.json`) — used by the RR-004C
    /// and RR-005C tests that specifically need a real intermediate
    /// ancestor to exercise the ancestor-guard/cross-directory-alias
    /// mechanics `confine_session` (no intermediate) can't reach.
    fn confine_session_under<'a>(ws: &'a WorkspaceRoot, subdir: &str, leaf_name: &str) -> ConfinedPath<'a> {
        resolve_confined_path(ws, &format!("{subdir}/{leaf_name}")).unwrap()
    }

    #[test]
    fn write_session_if_current_succeeds_when_the_expected_revision_matches() {
        let root = temp_root();
        let ws = workspace_root(&root);
        let confined = confine_session(&ws, "session.json");
        let result = write_session_if_current(&confined, 0, br#"{"revision":1}"#);
        assert!(result.is_ok());
        assert_eq!(read_current_revision(confined.path()).unwrap(), 1);
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn write_session_if_current_rejects_a_stale_expected_revision_and_writes_nothing() {
        let root = temp_root();
        let ws = workspace_root(&root);
        let confined = confine_session(&ws, "session.json");
        write_session_if_current(&confined, 0, br#"{"revision":1}"#).unwrap();
        // A second writer that read revision 0 (now stale - it's really
        // 1) tries to write.
        let result = write_session_if_current(&confined, 0, br#"{"revision":2}"#);
        assert!(matches!(result, Err(SessionWriteError::Stale(_))));
        // The file must be untouched by the rejected write.
        assert_eq!(read_current_revision(confined.path()).unwrap(), 1);
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn write_session_if_current_resolves_concurrent_same_revision_writers_to_exactly_one_winner() {
        let root = temp_root();
        write_session_if_current(&confine_session(&workspace_root(&root), "session.json"), 0, br#"{"revision":1}"#).unwrap();

        let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
        let make_writer = |text: &'static [u8]| {
            let root = root.clone();
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                let ws = workspace_root(&root);
                let confined = confine_session(&ws, "session.json");
                barrier.wait();
                write_session_if_current(&confined, 1, text)
            })
        };
        let t1 = make_writer(br#"{"revision":2,"writer":"a"}"#);
        let t2 = make_writer(br#"{"revision":2,"writer":"b"}"#);
        let r1 = t1.join().unwrap();
        let r2 = t2.join().unwrap();

        let successes = [&r1, &r2].into_iter().filter(|r| r.is_ok()).count();
        assert_eq!(successes, 1, "exactly one of two same-expected-revision writers must win, not zero or both");

        // Read-back of the winning durable revision.
        assert_eq!(read_current_revision(&root.join("session.json")).unwrap(), 2);
        fs::remove_dir_all(&root).ok();
    }

    // --- C2P1-RR-005: cross-process lock (real OS LockFileEx, not the in-process Mutex) ---

    #[test]
    #[cfg(windows)]
    fn cross_process_lock_genuinely_blocks_a_second_independent_acquirer() {
        // Proves the OS-level lock itself, independent of the in-process
        // `session_lock` Mutex: two SEPARATE file handles (opened fresh,
        // not sharing any in-process state) contend for the same
        // CrossProcessSessionLock. The second `acquire()` call must block
        // until the first is dropped - exactly the guarantee a second
        // process launching this same call would get, since LockFileEx
        // is enforced by the OS against the underlying file object, not
        // against anything this process tracks itself.
        let root = temp_root();
        let lock_path_1 = CrossProcessSessionLock::lock_path_for(&workspace_root(&root));
        let lock_path_2 = CrossProcessSessionLock::lock_path_for(&workspace_root(&root));

        let first = CrossProcessSessionLock::acquire(&lock_path_1).unwrap();

        let second_acquired = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let second_acquired_clone = second_acquired.clone();
        let handle = std::thread::spawn(move || {
            // This call must block until `first` is dropped below.
            let _second = CrossProcessSessionLock::acquire(&lock_path_2).unwrap();
            second_acquired_clone.store(true, std::sync::atomic::Ordering::SeqCst);
        });

        std::thread::sleep(std::time::Duration::from_millis(100));
        assert!(
            !second_acquired.load(std::sync::atomic::Ordering::SeqCst),
            "the second acquirer must still be blocked while the first holds the lock"
        );

        drop(first); // release - the second acquirer should now proceed
        handle.join().unwrap();
        assert!(second_acquired.load(std::sync::atomic::Ordering::SeqCst), "the second acquirer must complete once the lock is released");

        fs::remove_dir_all(&root).ok();
    }

    // --- C2P1-RR-005C: the lock is keyed *only* by the workspace root's
    // own identity - never by any session-specific path - so a hard-link
    // alias in a *different* directory under the same root cannot split
    // the lock namespace, and the file's own rename churn (C2P1-RR-005B)
    // and the old bootstrap/identity fork (C2P1-RR-005A) cannot recur,
    // since nothing about `lock_path_for` ever looks at the session path
    // at all. ---

    #[test]
    #[cfg(windows)]
    fn cross_process_lock_path_depends_only_on_the_workspace_root_not_any_session_path() {
        let root = temp_root();
        let key_1 = CrossProcessSessionLock::lock_path_for(&workspace_root(&root));
        let key_2 = CrossProcessSessionLock::lock_path_for(&workspace_root(&root));
        assert_eq!(key_1, key_2, "two independent WorkspaceRoot::open calls for the same root must agree on the same lock, with no session-path input to ever diverge on");
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    #[cfg(windows)]
    fn cross_process_lock_path_is_unaffected_by_the_session_file_being_created_renamed_or_hard_linked() {
        let root = temp_root();
        let ws = workspace_root(&root);
        let before_any_write = CrossProcessSessionLock::lock_path_for(&ws);

        let confined = confine_session(&ws, "session.json");
        write_session_if_current(&confined, 0, br#"{"revision":1}"#).unwrap(); // creates + renames
        write_session_if_current(&confined, 1, br#"{"revision":2}"#).unwrap(); // renames again
        std::fs::hard_link(confined.path(), root.join("session-alias.json")).unwrap(); // a second name, same inode

        let after = CrossProcessSessionLock::lock_path_for(&workspace_root(&root));
        assert_eq!(before_any_write, after, "none of creation, repeated rename-replacement, or an added hard-link alias may ever change the lock key - it depends only on the root");
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    #[cfg(windows)]
    fn workspace_root_open_fails_closed_for_a_nonexistent_root() {
        // No fallback namespace exists to degrade into - an unopenable
        // root must refuse outright, which is also what every lock and
        // confined-path call for that root transitively depends on.
        let fake_root = std::env::temp_dir().join("sop-ws-does-not-exist-at-all-for-lock-test");
        let err = WorkspaceRoot::open(&fake_root).unwrap_err();
        assert_eq!(err, WorkspacePathError::RootNotResolvable);
    }

    #[test]
    fn write_session_if_current_resolves_concurrent_first_ever_creation_to_exactly_one_winner() {
        let root = temp_root();
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
        let make_writer = |text: &'static [u8]| {
            let root = root.clone();
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                let ws = workspace_root(&root);
                let confined = confine_session(&ws, "session.json");
                barrier.wait();
                write_session_if_current(&confined, 0, text)
            })
        };
        let t1 = make_writer(br#"{"revision":1,"writer":"a"}"#);
        let t2 = make_writer(br#"{"revision":1,"writer":"b"}"#);
        let r1 = t1.join().unwrap();
        let r2 = t2.join().unwrap();
        let successes = [&r1, &r2].into_iter().filter(|r| r.is_ok()).count();
        assert_eq!(successes, 1, "exactly one of two concurrent first-ever-creation writers must win, not zero or both");
        assert_eq!(read_current_revision(&root.join("session.json")).unwrap(), 1);
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    #[cfg(windows)]
    fn write_session_if_current_is_serialized_even_bypassing_the_in_process_lock() {
        // Calls the cross-process primitive directly around two
        // concurrent write_session_if_current attempts from threads that
        // each also independently hold a CrossProcessSessionLock-style
        // handle first, proving the OS lock - not merely the in-process
        // Mutex - is what the real write path actually serializes on.
        // (A literal second OS process isn't spun up here - LockFileEx's
        // guarantee is per-underlying-file-object, enforced by the OS
        // kernel, not per-process-in-this-test-binary, so two independent
        // handles within one test process already exercise the identical
        // kernel code path a second real process would hit.)
        let root = temp_root();
        let ws = workspace_root(&root);
        let confined = confine_session(&ws, "session.json");
        write_session_if_current(&confined, 0, br#"{"revision":1}"#).unwrap();

        let external_lock = CrossProcessSessionLock::acquire(confined.lock_path()).unwrap();
        let root_clone = root.clone();
        let writer = std::thread::spawn(move || {
            let ws = workspace_root(&root_clone);
            let confined = confine_session(&ws, "session.json");
            write_session_if_current(&confined, 1, br#"{"revision":2,"writer":"blocked-writer"}"#)
        });

        std::thread::sleep(std::time::Duration::from_millis(100));
        assert_eq!(read_current_revision(confined.path()).unwrap(), 1, "the writer must still be blocked on the externally-held cross-process lock");

        drop(external_lock);
        let result = writer.join().unwrap();
        assert!(result.is_ok());
        assert_eq!(read_current_revision(confined.path()).unwrap(), 2);

        fs::remove_dir_all(&root).ok();
    }

    /// Child-process helper for
    /// `write_session_if_current_is_blocked_by_a_genuinely_separate_process`
    /// below — never runs as part of the normal suite (`#[ignore]`); the
    /// parent test spawns THIS SAME test binary and asks it, by exact
    /// name, to run only this one test. Acquires the real cross-process
    /// lock (keyed only by the workspace root, per the env var), signals
    /// readiness by writing a marker file, holds the lock for a fixed
    /// duration, then exits (releasing it).
    #[test]
    #[ignore]
    #[cfg(windows)]
    fn cross_process_lock_child_helper_acquire_and_hold() {
        let root = PathBuf::from(std::env::var("FORGE_TEST_LOCK_ROOT").expect("env var required"));
        let ready_path = PathBuf::from(std::env::var("FORGE_TEST_LOCK_READY_PATH").expect("env var required"));
        let ws = WorkspaceRoot::open(&root).expect("child process failed to open the workspace root");
        let lock_path = CrossProcessSessionLock::lock_path_for(&ws);
        let _lock = CrossProcessSessionLock::acquire(&lock_path).expect("child process failed to acquire the lock");
        fs::write(&ready_path, b"ready").expect("child process failed to write the ready marker");
        std::thread::sleep(std::time::Duration::from_millis(800));
        // `_lock` drops here on return, releasing the lock as this
        // process exits - exactly the real-world "second app instance
        // holds the lock, then closes" scenario.
    }

    #[test]
    #[cfg(windows)]
    fn write_session_if_current_is_blocked_by_a_genuinely_separate_process() {
        // C2P1-RR-005A's explicit ask: "no two child processes through
        // the production mutation path." This spawns a REAL second OS
        // process (not a thread in this one) that acquires the lock via
        // the exact same CrossProcessSessionLock::acquire the real
        // `write_session_if_current` path uses, proving the production
        // function is actually blocked by a separate process, not just
        // demonstrating the primitive in isolation.
        let root = temp_root();
        let ws = workspace_root(&root);
        let confined = confine_session(&ws, "session.json");
        write_session_if_current(&confined, 0, br#"{"revision":1}"#).unwrap();

        let ready_path = root.join("child-ready.marker");
        let exe = std::env::current_exe().expect("current_exe should resolve for a running test binary");
        let mut child = std::process::Command::new(&exe)
            .args(["sop_workspace::tests::cross_process_lock_child_helper_acquire_and_hold", "--exact", "--ignored", "--test-threads=1"])
            .env("FORGE_TEST_LOCK_ROOT", &root)
            .env("FORGE_TEST_LOCK_READY_PATH", &ready_path)
            .spawn()
            .expect("failed to spawn the child test process");

        // Wait (bounded) for the child to report it actually holds the lock.
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        while !ready_path.exists() {
            if std::time::Instant::now() > deadline {
                let _ = child.kill();
                panic!("child process never signaled it acquired the cross-process lock");
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }

        // The child process now genuinely holds the OS lock. The
        // production write path in THIS process must be blocked by it -
        // proven the same way as the in-process test: run the write on a
        // background thread, sample state shortly after, confirm it
        // hasn't advanced yet, then confirm it completes once the real
        // separate process exits and releases the lock.
        let root_clone = root.clone();
        let writer = std::thread::spawn(move || {
            let ws = workspace_root(&root_clone);
            let confined = confine_session(&ws, "session.json");
            write_session_if_current(&confined, 1, br#"{"revision":2,"writer":"parent-process"}"#)
        });

        std::thread::sleep(std::time::Duration::from_millis(150));
        assert_eq!(
            read_current_revision(confined.path()).unwrap(),
            1,
            "the parent-process writer must still be blocked by the separate child process's lock"
        );

        child.wait().expect("child process should exit cleanly, releasing the lock");
        let result = writer.join().unwrap();
        assert!(result.is_ok(), "{:?}", result);
        assert_eq!(read_current_revision(confined.path()).unwrap(), 2);

        fs::remove_dir_all(&root).ok();
    }

    /// Child-process helper for
    /// `write_session_if_current_is_blocked_by_a_separate_process_despite_a_cross_directory_hard_link_alias`
    /// below. Opens the same workspace root the parent uses, acquires
    /// the real cross-process lock through it, signals readiness, holds,
    /// then exits.
    #[test]
    #[ignore]
    #[cfg(windows)]
    fn cross_process_lock_child_helper_for_hard_link_scenario() {
        let root = PathBuf::from(std::env::var("FORGE_TEST_LOCK_ROOT").expect("env var required"));
        let ready_path = PathBuf::from(std::env::var("FORGE_TEST_LOCK_READY_PATH").expect("env var required"));
        let ws = WorkspaceRoot::open(&root).expect("child process failed to open the workspace root");
        let lock_path = CrossProcessSessionLock::lock_path_for(&ws);
        let _lock = CrossProcessSessionLock::acquire(&lock_path).expect("child process failed to acquire the lock");
        fs::write(&ready_path, b"ready").expect("child process failed to write the ready marker");
        std::thread::sleep(std::time::Duration::from_millis(800));
    }

    #[test]
    #[cfg(windows)]
    fn write_session_if_current_is_blocked_by_a_separate_process_despite_a_cross_directory_hard_link_alias() {
        // C2P1-RR-005C's exact named scenario and required evidence: "a
        // real NTFS test with a hard-link alias in a different directory
        // and two separate processes through the production write path
        // ... both callers select the same durable lock namespace and
        // exactly one same-revision writer succeeds."
        //
        // Layout: root/a/session.json is the real, canonical session
        // file. root/b/session-alias.json is a genuine NTFS hard link to
        // it, living in a *different* directory under the same
        // workspace root - the exact counterexample the prior round's
        // parent-directory-keyed scheme (C2P1-RR-005B) could not
        // converge, since `root/a` and `root/b` are different parent
        // directories with different stable identities.
        let root = temp_root();
        let ws = workspace_root(&root);
        ensure_workspace_subdirectory(&ws, "a").unwrap();
        ensure_workspace_subdirectory(&ws, "b").unwrap();
        let dir_a = root.join("a");
        let dir_b = root.join("b");
        let hard_link_path = dir_b.join("session-alias.json");

        let confined = confine_session_under(&ws, "a", "session.json");
        write_session_if_current(&confined, 0, br#"{"revision":1}"#).unwrap();
        std::fs::hard_link(confined.path(), &hard_link_path).expect("hard_link should succeed on NTFS within one volume");

        // Prove this is a genuine cross-directory scenario, not a
        // same-directory coincidence: `a` and `b` have different stable
        // identities, even though the lock derived from the shared
        // `root` does not care.
        let id_a = query_stable_file_id(&open_no_follow(&dir_a).unwrap()).unwrap();
        let id_b = query_stable_file_id(&open_no_follow(&dir_b).unwrap()).unwrap();
        assert_ne!((id_a.volume_serial, id_a.file_id), (id_b.volume_serial, id_b.file_id), "a and b must be genuinely different directories for this to be a real test of the named scenario");

        // Both processes open the SAME workspace root (`root`, the
        // common ancestor of both `a` and `b`) and must therefore select
        // the identical, durable lock namespace regardless of which
        // subdirectory their own session-path interest lives in.
        let ready_path = root.join("child-ready.marker");
        let exe = std::env::current_exe().expect("current_exe should resolve for a running test binary");
        let mut child = std::process::Command::new(&exe)
            .args(["sop_workspace::tests::cross_process_lock_child_helper_for_hard_link_scenario", "--exact", "--ignored", "--test-threads=1"])
            .env("FORGE_TEST_LOCK_ROOT", &root)
            .env("FORGE_TEST_LOCK_READY_PATH", &ready_path)
            .spawn()
            .expect("failed to spawn the child test process");

        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        while !ready_path.exists() {
            if std::time::Instant::now() > deadline {
                let _ = child.kill();
                panic!("child process never signaled it acquired the cross-process lock");
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }

        // The child now genuinely holds the lock derived from `root`.
        // The parent's real production write through the canonical path
        // must still be blocked by it, proving the lock the child picked
        // (reachable with no session-path input at all) is the exact
        // same namespace the real write path contends on - the hard
        // link in the other directory never caused a split.
        let root_clone = root.clone();
        let writer = std::thread::spawn(move || {
            let ws = workspace_root(&root_clone);
            let confined = confine_session_under(&ws, "a", "session.json");
            write_session_if_current(&confined, 1, br#"{"revision":2,"writer":"parent-process"}"#)
        });

        std::thread::sleep(std::time::Duration::from_millis(150));
        assert_eq!(
            read_current_revision(confined.path()).unwrap(),
            1,
            "the parent-process writer must still be blocked by the separate child process's lock, despite the cross-directory hard-link alias"
        );

        child.wait().expect("child process should exit cleanly, releasing the lock");
        let result = writer.join().unwrap();
        assert!(result.is_ok(), "{:?}", result);
        assert_eq!(read_current_revision(confined.path()).unwrap(), 2, "exactly one same-revision writer succeeded");
        // The hard-linked alias is a separate directory entry: renaming
        // over `a/session.json` never touches it, so it still shows the
        // pre-write snapshot - an inherent property of rename-based
        // atomic writes plus hard links, not something any lock scheme
        // can change. Documented, not asserted as a bug: the lock's job
        // is to prevent two writers from both believing they have
        // exclusive access to the canonical file, which this proves.
        assert!(hard_link_path.exists());

        fs::remove_dir_all(&root).ok();
    }

    // --- C2P1-RR-004D / RR-005D: ConfinedPath borrows the WorkspaceRoot
    // it was resolved against, so the root (and the delete-excluding
    // handle it holds) cannot be dropped before the confined mutation
    // completes - neither at compile time (the exact named pattern must
    // not compile) nor, for the direct-leaf case that previously had no
    // ancestor guard at all, at runtime. ---

    /// Compiles `source` as a standalone binary via a direct `rustc`
    /// invocation (no cargo project, no external crates) and returns
    /// whether it succeeded plus the compiler's stderr. Used by the two
    /// tests below to prove a genuine compile-time property of a
    /// lifetime-bounded borrow, not merely assert a doc comment's claim.
    ///
    /// This does not compile the real `sop_workspace.rs` itself: this
    /// crate is `[[bin]]`-only (no `[lib]` target), so there is nothing
    /// for a `///` `compile_fail` rustdoc test to run against, and
    /// linking a throwaway crate against this one's real dependencies
    /// (`windows`, `sha2`, `forge-capture-core`) from a bare `rustc`
    /// call would require fragile, toolchain-specific `--extern` wiring.
    /// Instead this isolates the *exact* lifetime shape
    /// [`ConfinedPath`]/[`resolve_confined_path`]/[`write_session_if_current`]
    /// rely on: a struct holding `&'a Root`, built by a function generic
    /// over `'a`, used by a caller after the constructing statement ends,
    /// with no `std::fs`/Windows/crate-specific code at all, so the only
    /// thing on trial is the borrow-checker property itself.
    fn rustc_compiles(source: &str) -> (bool, String) {
        let dir = std::env::temp_dir().join(format!("sop-ws-compile-fail-{}-{}", std::process::id(), rand_suffix()));
        fs::create_dir_all(&dir).unwrap();
        let src_path = dir.join("probe.rs");
        let out_path = dir.join("probe.exe");
        fs::write(&src_path, source).unwrap();
        let output = std::process::Command::new("rustc")
            .args(["--edition", "2021", "--crate-type", "bin", "-o"])
            .arg(&out_path)
            .arg(&src_path)
            .output()
            .expect("rustc must be on PATH to run this probe - it is the same toolchain `cargo test` itself uses");
        let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
        fs::remove_dir_all(&dir).ok();
        (output.status.success(), stderr)
    }

    /// The `ConfinedPath`-shaped borrow pattern: a `Confined<'a>` holding
    /// `&'a Root`, where the root outlives the value borrowing it (the
    /// caller binds `root` to a local before calling `make`, the same
    /// shape as `let ws = WorkspaceRoot::open(&path)?; let confined =
    /// resolve_confined_path(&ws, "x")?;`). This is the control case -
    /// it must compile, proving the probe harness itself is sound and
    /// the borrow isn't rejected unconditionally.
    ///
    /// `Root` carries an explicit (empty) `Drop` impl specifically to
    /// mirror `WorkspaceRoot`'s own real Drop glue (closing its `File`
    /// handle) - without it, rustc's dropck has no destructor-timing
    /// pressure to enforce here, and a temporary `Root` would be free to
    /// silently keep compiling past its nominal "end of statement" scope
    /// (empirically confirmed while writing this probe: the identical
    /// shape below compiles fine without a `Drop` impl on `Root`, which
    /// would make this proof worthless for a type that, like the real
    /// `WorkspaceRoot`, actually does have one).
    const CONFINED_BORROW_SHAPE_SOUND: &str = r#"
        struct Root { x: i32 }
        impl Drop for Root { fn drop(&mut self) {} }
        struct Confined<'a> { root: &'a Root }
        fn make<'a>(root: &'a Root) -> Confined<'a> { Confined { root } }
        fn use_it(c: &Confined) -> i32 { c.root.x }
        fn main() {
            let root = Root { x: 1 };
            let confined = make(&root);
            let _ = use_it(&confined);
        }
    "#;

    /// The exact RR-004D counterexample's shape: `root` is a temporary
    /// constructed inline as `make`'s argument, dropped at the end of
    /// the `let confined = ...;` statement that binds it, strictly
    /// before `confined` is used on the next line - the same shape as
    /// the verdict's `let confined = resolve_confined_path(&WorkspaceRoot::open(&root)?, "session.json")?; write_session_if_current(&confined, ...)?;`.
    /// See [`CONFINED_BORROW_SHAPE_SOUND`]'s doc comment for why `Root`
    /// needs its `Drop` impl for this probe to mean anything.
    const CONFINED_BORROW_SHAPE_WITH_TEMPORARY_ROOT: &str = r#"
        struct Root { x: i32 }
        impl Drop for Root { fn drop(&mut self) {} }
        struct Confined<'a> { root: &'a Root }
        fn make<'a>(root: &'a Root) -> Confined<'a> { Confined { root } }
        fn use_it(c: &Confined) -> i32 { c.root.x }
        fn main() {
            let confined = make(&Root { x: 1 });
            let _ = use_it(&confined);
        }
    "#;

    #[test]
    fn confined_borrow_shape_compiles_when_the_root_is_a_named_local_that_outlives_it() {
        let (ok, stderr) = rustc_compiles(CONFINED_BORROW_SHAPE_SOUND);
        assert!(ok, "the control case (root bound to a local before use) must compile cleanly:\n{stderr}");
    }

    #[test]
    fn confined_borrow_shape_rejects_the_rr004d_temporary_root_pattern_at_compile_time() {
        // This is the actual C2P1-RR-004D proof: the exact "resolve
        // against a temporary, use the result afterward" shape the
        // verdict named must fail to compile, not merely be discouraged
        // by a doc comment - which is precisely what `ConfinedPath<'a>`
        // borrowing `&'a WorkspaceRoot` (rather than a copied path or
        // id) now guarantees for the real production types.
        let (ok, stderr) = rustc_compiles(CONFINED_BORROW_SHAPE_WITH_TEMPORARY_ROOT);
        assert!(!ok, "a Confined<'a> built from a temporary Root, used after that Root is dropped, must be rejected by the borrow checker");
        assert!(
            stderr.contains("does not live long enough") || stderr.contains("temporary value dropped while borrowed"),
            "expected a lifetime/temporary-value diagnostic, got:\n{stderr}"
        );
    }

    #[test]
    #[cfg(windows)]
    fn write_session_if_current_survives_an_attempted_root_rename_for_a_direct_leaf_with_no_ancestor_guards() {
        // C2P1-RR-004D's named sharpest case: a direct-leaf confined
        // path (no intermediate component at all, so `_ancestor_guards`
        // is empty - there is no held ancestor handle anywhere in the
        // capability). Before this fix, nothing here stopped the
        // *root itself* from being deleted or replaced once the
        // temporary WorkspaceRoot that produced `confined` had dropped.
        // Now `confined` holds `ws` alive by borrow for its own full
        // lifetime, so `ws`'s own delete-excluding root handle (opened
        // in `WorkspaceRoot::open`) is provably still open here.
        let root = temp_root();
        let outside = temp_root();
        let ws = workspace_root(&root);
        let confined = confine_session(&ws, "session.json");

        // Attempt the exact attack, but against the ROOT itself rather
        // than an intermediate ancestor: remove it, then try to replace
        // it with a junction to an outside directory - the same two
        // operations the existing ancestor-swap tests already prove
        // `open_no_follow`'s share mode defeats.
        let remove_result = fs::remove_dir(&root);
        assert!(remove_result.is_err(), "the workspace root itself must not be removable while its own WorkspaceRoot (kept alive by ConfinedPath's borrow) is still open");

        let junction_status = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J", &root.to_string_lossy(), &outside.to_string_lossy()])
            .status();
        if let Ok(status) = junction_status {
            assert!(!status.success(), "replacing the root's own name with a junction must fail outright while its held-open handle is live");
        }

        // Resume the real production write - through write_session_if_current,
        // with no intermediate ancestor guard protecting it, only the
        // borrowed WorkspaceRoot's own handle.
        let result = write_session_if_current(&confined, 0, br#"{"revision":1}"#);
        assert!(result.is_ok(), "{:?}", result);
        assert_eq!(fs::read(root.join("session.json")).unwrap(), br#"{"revision":1}"#);
        assert!(fs::read_dir(&outside).unwrap().next().is_none(), "nothing must ever have been written outside the vault");

        drop(confined);
        drop(ws);
        fs::remove_dir_all(&root).ok();
        fs::remove_dir_all(&outside).ok();
    }

    #[test]
    fn confined_path_workspace_root_accessor_returns_the_exact_root_it_was_resolved_against() {
        // C2P1-RR-004D/RR-005D's "attached to the verified root object"
        // requirement, proven at the object-identity level (not merely
        // equal-by-value): `confined.workspace_root()` must be the same
        // `WorkspaceRoot` instance `ws` is - the one whose handle
        // protects the root directory and whose stable id the lock path
        // (see `CrossProcessSessionLock::lock_path_for`) was derived
        // from - never a copy, a re-open, or a different instance.
        let root = temp_root();
        let ws = workspace_root(&root);
        let confined = confine_session(&ws, "session.json");
        assert!(
            std::ptr::eq(confined.workspace_root(), &ws),
            "ConfinedPath must carry a borrow of the exact WorkspaceRoot it was resolved against, not a copy or a separately-opened instance"
        );
        fs::remove_dir_all(&root).ok();
    }

    // --- log redaction ---

    #[test]
    fn redact_log_fields_blanks_every_known_sensitive_field_name() {
        let fields = vec![
            ("ocr_text", "my password is hunter2".to_string()),
            ("session_id", "sess-1".to_string()),
        ];
        let redacted = redact_log_fields(&fields);
        assert_eq!(redacted[0], ("ocr_text".to_string(), "[redacted]".to_string()));
        assert_eq!(redacted[1], ("session_id".to_string(), "sess-1".to_string()));
    }

    #[test]
    fn redact_log_fields_matches_field_names_case_insensitively() {
        let fields = vec![("OCR_TEXT", "secret".to_string())];
        let redacted = redact_log_fields(&fields);
        assert_eq!(redacted[0].1, "[redacted]");
    }

    #[test]
    fn redact_log_fields_never_leaves_a_truncated_fragment_of_the_real_value() {
        let fields = vec![("raw_pixels", "AAAAAAAAAAAAAAAAAAAAAAAA".to_string())];
        let redacted = redact_log_fields(&fields);
        assert!(!redacted[0].1.contains('A'));
    }

    // --- DPAPI (Windows only — real OS crypto, not a mock) ---

    #[test]
    #[cfg(windows)]
    fn dpapi_protect_then_unprotect_round_trips_the_exact_plaintext() {
        let plaintext = b"this is a raw SOP session frame, encrypted at rest";
        let ciphertext = dpapi_protect(plaintext).expect("DPAPI protect should succeed for the current user");
        assert_ne!(ciphertext, plaintext);
        let recovered = dpapi_unprotect(&ciphertext).expect("DPAPI unprotect should succeed for the same user");
        assert_eq!(recovered, plaintext);
    }

    #[test]
    #[cfg(windows)]
    fn dpapi_unprotect_rejects_tampered_ciphertext() {
        let plaintext = b"sensitive";
        let mut ciphertext = dpapi_protect(plaintext).unwrap();
        let last = ciphertext.len() - 1;
        ciphertext[last] ^= 0xFF;
        let result = dpapi_unprotect(&ciphertext);
        assert!(result.is_err());
    }

    #[test]
    #[cfg(windows)]
    fn dpapi_protect_handles_empty_input() {
        let ciphertext = dpapi_protect(b"").expect("DPAPI should accept empty plaintext");
        let recovered = dpapi_unprotect(&ciphertext).unwrap();
        assert!(recovered.is_empty());
    }

    #[test]
    #[cfg(not(windows))]
    fn dpapi_is_explicitly_unsupported_off_windows_rather_than_silently_no_op() {
        assert!(matches!(dpapi_protect(b"x"), Err(DpapiError::Unsupported)));
        assert!(matches!(dpapi_unprotect(b"x"), Err(DpapiError::Unsupported)));
    }

    // --- vault ACL (Windows only — real DACL, not a mock) ---

    #[test]
    #[cfg(windows)]
    fn restrict_vault_acl_then_verify_succeeds_for_a_fresh_directory() {
        let root = temp_root();
        restrict_vault_acl(&root).expect("restricting the vault ACL should succeed for a directory this process owns");
        verify_vault_acl_is_current_user_only(&root).expect("the just-restricted vault ACL should verify as current-user-only");
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    #[cfg(windows)]
    fn verify_vault_acl_rejects_a_directory_that_was_never_restricted() {
        // A plain fresh temp directory inherits its parent's DACL, which
        // on a real machine is never guaranteed to be the single
        // current-user-only ACE this check demands (and on CI images is
        // frequently broader, e.g. inherited Administrators/SYSTEM
        // entries) — `restrict_vault_acl` must actually run first.
        let root = temp_root();
        let result = verify_vault_acl_is_current_user_only(&root);
        assert!(result.is_err(), "an unrestricted directory's inherited DACL must not pass verification by accident");
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    #[cfg(not(windows))]
    fn vault_acl_is_explicitly_unsupported_off_windows_rather_than_silently_no_op() {
        let root = temp_root();
        assert!(matches!(restrict_vault_acl(&root), Err(VaultAclError::Unsupported)));
        assert!(matches!(verify_vault_acl_is_current_user_only(&root), Err(VaultAclError::Unsupported)));
        fs::remove_dir_all(&root).ok();
    }
}
