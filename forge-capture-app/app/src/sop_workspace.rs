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
/// This does **not** make the whole multi-component walk atomic — `std`
/// has no `openat()`/`NtCreateFile`-with-`RootDirectory` equivalent for
/// resolving the *next* component relative to an already-open handle, so
/// moving from a verified component to the next one still re-resolves by
/// path. A real handle-relative resolve would need the undocumented NT
/// native API (`NtCreateFile`'s `OBJECT_ATTRIBUTES.RootDirectory`), which
/// this author chose not to guess at (see the C2P1-006 ACL finding's own
/// note on not implementing unverified Win32 surface blind). What this
/// function closes is real and specific: the per-component check-vs-use
/// gap; what remains is the cross-component gap, narrowed to the minimum
/// number of syscalls between one component's verified open and the
/// next's, same as the existing re-verify-after-create discipline below.
#[cfg(windows)]
fn open_no_follow(path: &Path) -> std::io::Result<File> {
    use std::os::windows::fs::OpenOptionsExt;
    const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;
    const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
    fs::OpenOptions::new().read(true).custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT).open(path)
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
}

/// Resolves `relative` against `root`, refusing anything that would
/// escape `root` either lexically (per
/// [`forge_capture_core::sop_ipc::confine_relative_path`]) or physically
/// (via a symlink/junction on disk). `relative`'s leaf does not need to
/// exist yet (a path being written for the first time) — but, as of the
/// C2P1-RR-004A fix below, every component *before* the leaf **must**
/// already exist: this function never creates an intermediate directory
/// on an untrusted caller's behalf. See [`ensure_workspace_subdirectory`]
/// for the one, trusted-only way to establish a fixed subdirectory (e.g.
/// `"frames"`) before calling this function for a leaf inside it.
///
/// Walks one path component at a time starting from the canonicalized
/// root, checking each existing component via an opened, no-follow
/// handle (`existing_component_metadata`/`open_no_follow`) — this never
/// mutates the filesystem itself, only reads and verifies.
///
/// **C2P1-RR-004A fix, stated plainly:** the prior version of this
/// function, on finding a *missing* intermediate component, created it
/// itself (`fs::create_dir`) before the next component's check could
/// run. That meant an already-checked intermediate directory, replaced
/// with a junction in the gap between this function's verified open of
/// it and the next component's separate, path-based creation, could
/// have a brand-new directory actually created *outside* `root` — a
/// real mutation, landed before the final canonical check ever ran.
/// Removing the create entirely (this version) removes that specific
/// harm: this function can no longer mutate anything outside `root`,
/// because it can no longer mutate anything at all. A missing
/// intermediate is simply refused
/// ([`WorkspacePathError::IntermediateDirectoryMissing`]).
///
/// This does not, by itself, achieve perfect handle-relative resolution
/// — Windows has no `openat()`/`O_NOFOLLOW` equivalent in the documented
/// Win32 surface this app uses (the only way to get genuine
/// handle-relative resolution is the undocumented, NT-native
/// `NtCreateFile` with `OBJECT_ATTRIBUTES.RootDirectory`, which has no
/// binding in the `windows` crate and no official Microsoft
/// documentation; hand-declaring its `extern "system"` signature and
/// struct layouts myself would carry **no compiler- or crate-level check
/// that the ABI is right**, a categorically different risk than every
/// other unsafe call in this file, all of which are typed,
/// compiler-verified `windows` crate bindings — see the C2P1-006 ACL
/// finding's own note on not implementing unverified Win32 surface
/// blind, the same judgment call repeated here). So a read-only
/// component check earlier in this walk could in principle still observe
/// a directory that is later swapped before this function's own final
/// canonical re-check runs. What C2P1-RR-004A's fix changes is the
/// *consequence* of that: previously, the race could make this function
/// itself write a new directory outside `root`. Now it cannot — the
/// worst a stale read can do is make this call return a wrong result,
/// which the existing final canonical check below already exists to
/// catch, and which carries no side effect if it doesn't. The caller's
/// own subsequent leaf write is a separate, already-reviewed concern
/// (an exclusive, no-follow create at the leaf — C2P1-RR-004's original
/// scope); the once-only, trusted, single-hop creation in
/// [`ensure_workspace_subdirectory`] is the only remaining place in this
/// module that creates a directory from a name at all, and it is never
/// driven by untrusted per-call input. This is reported as the real
/// scope of what remains open — not silently reduced, not re-claimed as
/// fully eliminated.
pub fn resolve_confined_path(root: &Path, relative: &str) -> Result<PathBuf, WorkspacePathError> {
    confine_relative_path(relative).map_err(WorkspacePathError::Lexical)?;

    let canonical_root = fs::canonicalize(root).map_err(|_| WorkspacePathError::RootNotResolvable)?;

    let components: Vec<&str> = relative.split(['/', '\\']).collect();
    let mut current = canonical_root.clone();
    for (i, component) in components.iter().enumerate() {
        let candidate = current.join(component);
        let is_last = i == components.len() - 1;
        let existing = existing_component_metadata(&candidate)?;
        match existing {
            Some(meta) => {
                // C2P1-RR-004: on Windows, `meta` already came from an
                // open, no-follow handle to this exact object (see
                // `verify_component_no_follow`) — this is not a second,
                // separately-racable stat.
                if is_reparse_point(&meta) {
                    return Err(WorkspacePathError::EscapesRoot);
                }
                if !is_last && !meta.is_dir() {
                    // Can't descend through a plain file as if it were
                    // a directory.
                    return Err(WorkspacePathError::EscapesRoot);
                }
                current = candidate;
            }
            None if is_last => {
                // The leaf does not exist yet — fine, this is a fresh
                // write target. Nothing to verify or create here; the
                // caller creates the leaf itself (via an exclusive,
                // no-follow open), never this function.
                current = candidate;
            }
            None => {
                // C2P1-RR-004A: a missing *intermediate* directory is
                // refused, never created, regardless of which process
                // owns the workspace — see this function's doc comment.
                return Err(WorkspacePathError::IntermediateDirectoryMissing);
            }
        }
    }

    // Final containment proof: canonicalize whatever portion of `current`
    // actually exists on disk (the leaf itself if it was already there,
    // otherwise its parent, which the loop above has already proven is
    // not a reparse point) and require it to still resolve under the
    // canonical root. Every component walked above was already checked
    // non-reparse, so this canonicalize cannot cross a symlink/junction
    // this function didn't already see and reject.
    let verify_target = if current.exists() { current.clone() } else { current.parent().unwrap_or(&canonical_root).to_path_buf() };
    let canonical_verify = fs::canonicalize(&verify_target).map_err(|_| WorkspacePathError::EscapesRoot)?;
    if !canonical_verify.starts_with(&canonical_root) {
        return Err(WorkspacePathError::EscapesRoot);
    }

    Ok(current)
}

/// Creates (idempotently) exactly one fixed subdirectory directly under
/// `root`, verifying it the same way [`resolve_confined_path`] verifies
/// every component it walks. This is the **only** place in this module
/// that creates a directory from a name — specifically so creation never
/// has to happen in response to untrusted, per-call `relative` input
/// (the C2P1-RR-004A fix to [`resolve_confined_path`] above). Callers
/// must pass a single, hardcoded, non-attacker-controlled component
/// (e.g. `"frames"`) at workspace setup time — never anything built from
/// caption text, a filename a user chose, or any other untrusted source.
///
/// `name` must be exactly one path component — this function is not a
/// nested-path creator, and accepting `/`/`\` in `name` would reopen
/// the same multi-hop surface [`resolve_confined_path`] just closed.
///
/// Canonicalizes `root` fresh on every call rather than accepting a
/// pre-canonicalized root, so the only window between "root is proven
/// real" and "the one child this call creates is proven real" is this
/// function's own few syscalls — there is no earlier, separately-timed
/// verification of an intermediate for an attacker to race against,
/// because there is no intermediate: `name` is always a direct child of
/// a just-canonicalized `root`.
pub fn ensure_workspace_subdirectory(root: &Path, name: &str) -> Result<PathBuf, WorkspacePathError> {
    confine_relative_path(name).map_err(WorkspacePathError::Lexical)?;
    if name.contains('/') || name.contains('\\') {
        return Err(WorkspacePathError::NotASingleComponent);
    }

    let canonical_root = fs::canonicalize(root).map_err(|_| WorkspacePathError::RootNotResolvable)?;
    let candidate = canonical_root.join(name);

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
pub fn atomic_write_with_fsync(path: &Path, bytes: &[u8]) -> Result<(), String> {
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
pub fn read_current_revision(path: &Path) -> Result<u64, String> {
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

/// Per-session-path serialization primitive: every
/// [`write_session_if_current`] call for the same `path` takes the same
/// in-process lock across its entire read-validate-write-rename sequence.
/// This alone only covers same-process races (two overlapping Tauri
/// command invocations) — see [`CrossProcessSessionLock`] for the
/// C2P1-RR-005 fix that also covers a second process and lexical
/// aliasing.
fn session_lock(path: &Path) -> std::sync::Arc<std::sync::Mutex<()>> {
    static REGISTRY: std::sync::OnceLock<std::sync::Mutex<std::collections::HashMap<PathBuf, std::sync::Arc<std::sync::Mutex<()>>>>> =
        std::sync::OnceLock::new();
    let registry = REGISTRY.get_or_init(|| std::sync::Mutex::new(std::collections::HashMap::new()));
    let mut map = registry.lock().unwrap_or_else(|e| e.into_inner());
    map.entry(path.to_path_buf()).or_insert_with(|| std::sync::Arc::new(std::sync::Mutex::new(()))).clone()
}

/// C2P1-RR-005 fix: a real, OS-enforced, cross-process exclusive lock —
/// the in-process `session_lock` above is necessary but not sufficient,
/// since it's bypassed entirely by a second process (a second app launch
/// against the same vault) or by two different lexical path strings that
/// happen to resolve to the same real file.
///
/// Held via `LockFileEx` on a dedicated sibling `<name>.lock` file next
/// to the session file — never on the session file itself, so the lock's
/// own existence/lifecycle never interferes with the session file's
/// atomic-rename replacement (`atomic_write_with_fsync` creates a whole
/// new file and renames over the old one; a lock held via an open handle
/// on the OLD inode would be silently left behind, pointless, once the
/// rename swaps in a new one — a lock file that is never replaced, only
/// ever locked/unlocked, avoids that trap entirely).
///
/// Keyed by the **session's parent directory's stable identity**, not by
/// the session file itself and not by a derived path string. Two prior
/// schemes were tried and both broke:
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
///
/// Binding to the *parent directory's* `FILE_ID_INFO` instead (see
/// [`CrossProcessSessionLock::lock_path_for`] for the full rationale)
/// fixes both at once: the directory's identity never changes due to
/// this module's own writes, so there is exactly one lock namespace for
/// a given session's location, before it's ever created, during every
/// write, and after every rename — immune to case, 8.3 names, and hard
/// links (all of which share the one parent directory) without any
/// name-based logic, and with no separate "doesn't exist yet" bootstrap
/// scheme left to diverge from it.
#[cfg(windows)]
struct CrossProcessSessionLock {
    file: File,
}

#[cfg(windows)]
impl CrossProcessSessionLock {
    /// The lock path for `session_path` is derived **only** from its
    /// *parent directory's* stable NTFS identity — never from the
    /// session file's own identity, and with no separate "bootstrap"
    /// scheme for a not-yet-created file.
    ///
    /// C2P1-RR-005B: the prior version keyed the lock to the session
    /// file's own `FILE_ID_INFO`, and this module's own
    /// `atomic_write_with_fsync` *guarantees* that identity changes on
    /// every successful write (temp-file-then-rename always produces a
    /// new inode). A second caller whose `lock_path_for` call landed
    /// after a writer's rename but before that writer dropped its guard
    /// computed a *different* lock name and entered the critical section
    /// concurrently with it — not a theoretical gap, but a direct
    /// violation of this module's own documented "every overlapping
    /// caller is strictly serialized" guarantee. There was a second,
    /// related divergence: a waiter that resolved the bootstrap path
    /// before the file existed could remain parked on it after another
    /// writer created the file and moved a third caller onto the
    /// identity path, splitting the two into separate lock namespaces.
    ///
    /// Binding to the **parent directory's** identity instead sidesteps
    /// both by construction. This module never replaces, renames, or
    /// recreates the directory a session file lives in, so that identity
    /// is invariant across every write of the file inside it, before the
    /// file is ever created, during a write, and after every rename —
    /// there is only ever one lock namespace, never two that can drift
    /// apart, so the bootstrap/identity fork this used to need is simply
    /// removed rather than patched. A query failure on the parent
    /// directory itself (missing, inaccessible, or a reparse point) fails
    /// this call outright — there is no weaker fallback namespace left to
    /// silently degrade into.
    ///
    /// Hard-link and case/8.3-name aliases for the same session file
    /// still converge for free: they are, by definition, different names
    /// *in the same directory*, so they already resolve to the same
    /// parent and therefore the same lock, with no name-based logic
    /// needed at all.
    ///
    /// Trade-off, stated plainly: this makes the lock per-directory, not
    /// per-file. Two genuinely different session files that happened to
    /// share one directory would now serialize against each other
    /// unnecessarily. Every build slice so far describes one workspace
    /// directory holding one session; if a later slice puts multiple
    /// independent sessions in one directory, this granularity should be
    /// revisited explicitly rather than silently assumed to still be
    /// fine.
    fn lock_path_for(session_path: &Path) -> Result<PathBuf, String> {
        let parent = session_path.parent().ok_or_else(|| "session path has no parent directory".to_string())?;
        let canonical_parent =
            fs::canonicalize(parent).map_err(|e| format!("cannot canonicalize session directory: {e}"))?;
        let handle = open_no_follow(parent).map_err(|e| format!("cannot open session directory: {e}"))?;
        let meta = handle.metadata().map_err(|e| format!("cannot stat session directory: {e}"))?;
        if is_reparse_point(&meta) {
            return Err("session directory is a reparse point; refusing to lock through it".to_string());
        }
        let id = query_stable_file_id(&handle)
            .map_err(|e| format!("cannot query session directory identity: {e}"))?;
        Ok(canonical_parent.join(format!("{}-{}.session.lock", id.volume_serial_hex(), id.file_id_hex())))
    }

    /// Acquires the lock, blocking the calling thread until it's
    /// available. The lock file is created if it doesn't exist yet (its
    /// own content is never read or written — it exists purely as a
    /// stable name `LockFileEx` can hold a byte-range lock on), and is
    /// itself opened without following a reparse point — a lock "file"
    /// that turned out to be a planted symlink must never be locked or
    /// written through.
    fn acquire(session_path: &Path) -> Result<Self, String> {
        let lock_path = Self::lock_path_for(session_path)?;
        let file = open_or_create_no_follow(&lock_path)?;
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
    fn acquire(_session_path: &Path) -> Result<Self, String> {
        Ok(Self)
    }
}

/// Writes a session file, but only if `expected_revision` still matches
/// what's actually on disk — otherwise refuses with
/// [`forge_capture_core::sop_session::StaleRevisionError`] and writes
/// nothing, leaving the existing file exactly as it was.
///
/// Holds [`session_lock`] (in-process) AND [`CrossProcessSessionLock`]
/// (OS-enforced, cross-process, canonical-identity-keyed — the C2P1-RR-005
/// fix) for `path` across the entire read-current-revision / check /
/// write / rename sequence, so overlapping callers racing for the same
/// `expected_revision` — whether two command invocations in this process,
/// two separate app launches against the same vault, or two different
/// lexical spellings of the same real path — are strictly serialized:
/// whichever acquires both locks first reads the true current revision,
/// succeeds, and advances it; every other caller then reads the *new*
/// current revision under the same locks and is correctly rejected as
/// stale, rather than any of them having read the old revision before one
/// wrote (the prior check-then-act race).
pub fn write_session_if_current(
    path: &Path,
    expected_revision: u64,
    bytes: &[u8],
) -> Result<(), SessionWriteError> {
    let lock = session_lock(path);
    let _guard = lock.lock().unwrap_or_else(|e| e.into_inner());

    // C2P1-RR-005: the in-process mutex above only ever protected against
    // overlapping calls IN THIS PROCESS. A second process, or a lexical
    // alias for the same real file, bypassed it entirely. This holds a
    // real OS-enforced lock, keyed by canonical file identity, across the
    // exact same read-validate-write span.
    let _cross_process_guard =
        CrossProcessSessionLock::acquire(path).map_err(SessionWriteError::Io)?;

    let current = read_current_revision(path).map_err(SessionWriteError::Io)?;
    forge_capture_core::sop_session::check_expected_revision(current, expected_revision)
        .map_err(SessionWriteError::Stale)?;
    cleanup_orphaned_temp_files(path);
    atomic_write_with_fsync(path, bytes).map_err(SessionWriteError::Io)
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

    // --- path escape / symlink refusal ---

    #[test]
    fn resolve_confined_path_accepts_an_ordinary_relative_path_once_its_directory_is_established() {
        let root = temp_root();
        ensure_workspace_subdirectory(&root, "frames").unwrap();
        let resolved = resolve_confined_path(&root, "frames/f1.png").unwrap();
        assert!(resolved.starts_with(fs::canonicalize(&root).unwrap()));
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn resolve_confined_path_refuses_a_missing_intermediate_directory_rather_than_creating_it() {
        // C2P1-RR-004A: this function must never create a directory on
        // an untrusted caller's behalf - the missing `frames` directory
        // is refused, not auto-created.
        let root = temp_root();
        let err = resolve_confined_path(&root, "frames/f1.png").unwrap_err();
        assert_eq!(err, WorkspacePathError::IntermediateDirectoryMissing);
        assert!(!root.join("frames").exists(), "a missing intermediate must never be created as a side effect of resolving a path");
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn ensure_workspace_subdirectory_creates_and_reuses_a_fixed_subdirectory() {
        let root = temp_root();
        let first = ensure_workspace_subdirectory(&root, "frames").unwrap();
        assert!(first.is_dir());
        // Idempotent: calling again for the same already-existing,
        // non-reparse-point directory succeeds and returns the same path.
        let second = ensure_workspace_subdirectory(&root, "frames").unwrap();
        assert_eq!(first, second);
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn ensure_workspace_subdirectory_rejects_a_multi_component_name() {
        let root = temp_root();
        let err = ensure_workspace_subdirectory(&root, "frames/nested").unwrap_err();
        assert_eq!(err, WorkspacePathError::NotASingleComponent);
        assert!(!root.join("frames").exists());
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    #[cfg(windows)]
    fn ensure_workspace_subdirectory_refuses_an_existing_reparse_point_with_the_same_name() {
        let root = temp_root();
        let outside = temp_root();
        let link = root.join("frames");
        let status = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J", &link.to_string_lossy(), &outside.to_string_lossy()])
            .status();
        if let Ok(status) = status {
            if status.success() {
                let err = ensure_workspace_subdirectory(&root, "frames").unwrap_err();
                assert_eq!(err, WorkspacePathError::EscapesRoot);
            }
        }
        fs::remove_dir_all(&root).ok();
        fs::remove_dir_all(&outside).ok();
    }

    #[test]
    fn resolve_confined_path_rejects_lexical_traversal_before_touching_disk() {
        let root = temp_root();
        let err = resolve_confined_path(&root, "../escape.png").unwrap_err();
        assert_eq!(err, WorkspacePathError::Lexical(PathConfinementError::ContainsParentTraversal));
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn resolve_confined_path_rejects_a_nonexistent_root() {
        let fake_root = std::env::temp_dir().join("sop-ws-does-not-exist-at-all");
        let err = resolve_confined_path(&fake_root, "f1.png").unwrap_err();
        assert_eq!(err, WorkspacePathError::RootNotResolvable);
    }

    #[test]
    #[cfg(unix)]
    fn resolve_confined_path_defeats_a_symlinked_subdirectory_escaping_the_root() {
        let root = temp_root();
        let outside = temp_root(); // a second, sibling directory - NOT inside root
        std::os::unix::fs::symlink(&outside, root.join("escape_link")).unwrap();
        let err = resolve_confined_path(&root, "escape_link/stolen.png").unwrap_err();
        assert_eq!(err, WorkspacePathError::EscapesRoot);
        fs::remove_dir_all(&root).ok();
        fs::remove_dir_all(&outside).ok();
    }

    #[test]
    #[cfg(windows)]
    fn resolve_confined_path_defeats_a_junction_escaping_the_root() {
        let root = temp_root();
        let outside = temp_root();
        let link = root.join("escape_link");
        // Windows directory junctions don't require elevation (unlike
        // symlinks without Developer Mode); `mklink /J` is the real
        // on-disk primitive this test exercises the defense against.
        let status = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J", &link.to_string_lossy(), &outside.to_string_lossy()])
            .status();
        if let Ok(status) = status {
            if status.success() {
                let err = resolve_confined_path(&root, "escape_link/stolen.png").unwrap_err();
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
        let link = root.join("escape_link");
        let status = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J", &link.to_string_lossy(), &outside.to_string_lossy()])
            .status();
        if let Ok(status) = status {
            if status.success() {
                // The descendant `newdir` under `escape_link` does not
                // exist yet anywhere. The previous version of this
                // function called `create_dir_all` on the unverified
                // parent before canonicalizing it, so `newdir` could get
                // created *outside* `root` (physically inside `outside`)
                // before the escape was ever detected.
                let err = resolve_confined_path(&root, "escape_link/newdir/file.png").unwrap_err();
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
        fs::write(outside.join("secret.png"), b"not yours").unwrap();
        let link = root.join("escape_link");
        let status = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J", &link.to_string_lossy(), &outside.to_string_lossy()])
            .status();
        if let Ok(status) = status {
            if status.success() {
                let err = resolve_confined_path(&root, "escape_link/secret.png").unwrap_err();
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

    #[test]
    fn write_session_if_current_succeeds_when_the_expected_revision_matches() {
        let root = temp_root();
        let path = root.join("session.json");
        let result = write_session_if_current(&path, 0, br#"{"revision":1}"#);
        assert!(result.is_ok());
        assert_eq!(read_current_revision(&path).unwrap(), 1);
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn write_session_if_current_rejects_a_stale_expected_revision_and_writes_nothing() {
        let root = temp_root();
        let path = root.join("session.json");
        write_session_if_current(&path, 0, br#"{"revision":1}"#).unwrap();
        // A second writer that read revision 0 (now stale - it's really
        // 1) tries to write.
        let result = write_session_if_current(&path, 0, br#"{"revision":2}"#);
        assert!(matches!(result, Err(SessionWriteError::Stale(_))));
        // The file must be untouched by the rejected write.
        assert_eq!(read_current_revision(&path).unwrap(), 1);
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn write_session_if_current_resolves_concurrent_same_revision_writers_to_exactly_one_winner() {
        let root = temp_root();
        let path = root.join("session.json");
        write_session_if_current(&path, 0, br#"{"revision":1}"#).unwrap();

        let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
        let make_writer = |text: &'static [u8]| {
            let path = path.clone();
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                barrier.wait();
                write_session_if_current(&path, 1, text)
            })
        };
        let t1 = make_writer(br#"{"revision":2,"writer":"a"}"#);
        let t2 = make_writer(br#"{"revision":2,"writer":"b"}"#);
        let r1 = t1.join().unwrap();
        let r2 = t2.join().unwrap();

        let successes = [&r1, &r2].into_iter().filter(|r| r.is_ok()).count();
        assert_eq!(successes, 1, "exactly one of two same-expected-revision writers must win, not zero or both");

        // Read-back of the winning durable revision.
        assert_eq!(read_current_revision(&path).unwrap(), 2);
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
        let session_path = root.join("session.json");
        fs::write(&session_path, b"{}").unwrap(); // parent must exist for canonicalize

        let first = CrossProcessSessionLock::acquire(&session_path).unwrap();

        let second_acquired = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let second_acquired_clone = second_acquired.clone();
        let session_path_clone = session_path.clone();
        let handle = std::thread::spawn(move || {
            // This call must block until `first` is dropped below.
            let _second = CrossProcessSessionLock::acquire(&session_path_clone).unwrap();
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

    #[test]
    #[cfg(windows)]
    fn cross_process_lock_resolves_a_case_differing_alias_to_the_same_underlying_lock() {
        let root = temp_root();
        let session_path_lower = root.join("session.json");
        fs::write(&session_path_lower, b"{}").unwrap();
        let session_path_upper = root.join("SESSION.JSON"); // NTFS: same real file

        let lock_a = CrossProcessSessionLock::lock_path_for(&session_path_lower).unwrap();
        let lock_b = CrossProcessSessionLock::lock_path_for(&session_path_upper).unwrap();
        assert_eq!(lock_a, lock_b, "a case-differing lexical alias for the same file must resolve to the same lock path");

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    #[cfg(windows)]
    fn cross_process_lock_resolves_a_hard_link_alias_to_the_same_underlying_lock() {
        // C2P1-RR-005A's explicit example: "a hard-link path... can yield
        // different sibling lock names." A hard link is a second NAME for
        // the identical NTFS file (same volume serial + file id) - the
        // whole reason this round moved off name-derived keys onto
        // FILE_ID_INFO.
        let root = temp_root();
        let original = root.join("session.json");
        fs::write(&original, b"{}").unwrap();
        let hard_link = root.join("session-alias.json");
        std::fs::hard_link(&original, &hard_link).expect("hard_link should succeed on NTFS within one volume");

        let lock_a = CrossProcessSessionLock::lock_path_for(&original).unwrap();
        let lock_b = CrossProcessSessionLock::lock_path_for(&hard_link).unwrap();
        assert_eq!(lock_a, lock_b, "a hard-link alias for the same real file must resolve to the same lock path");

        fs::remove_dir_all(&root).ok();
    }

    // --- C2P1-RR-005B: lock identity must survive the session file's own
    // rename, and must never fork into a separate "doesn't exist yet"
    // namespace that a concurrent caller could diverge onto. ---

    #[test]
    #[cfg(windows)]
    fn cross_process_lock_path_is_identical_before_and_after_the_session_file_is_created() {
        let root = temp_root();
        let session_path = root.join("session.json");
        let before = CrossProcessSessionLock::lock_path_for(&session_path).unwrap();
        fs::write(&session_path, b"{}").unwrap();
        let after = CrossProcessSessionLock::lock_path_for(&session_path).unwrap();
        assert_eq!(
            before, after,
            "the lock path must never change across the session file's own lifecycle - only the parent directory's identity, which creating the file does not alter, may ever determine it"
        );
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    #[cfg(windows)]
    fn cross_process_lock_path_is_identical_across_every_rewrite_of_the_session_file() {
        let root = temp_root();
        let session_path = root.join("session.json");
        let before_any_write = CrossProcessSessionLock::lock_path_for(&session_path).unwrap();
        write_session_if_current(&session_path, 0, br#"{"revision":1}"#).unwrap();
        let after_first_write = CrossProcessSessionLock::lock_path_for(&session_path).unwrap();
        write_session_if_current(&session_path, 1, br#"{"revision":2}"#).unwrap();
        let after_second_write = CrossProcessSessionLock::lock_path_for(&session_path).unwrap();
        assert_eq!(before_any_write, after_first_write, "creating the file via a real write must not change the lock key");
        assert_eq!(after_first_write, after_second_write, "a second write, which replaces the inode again via rename, must not change the lock key either");
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    #[cfg(windows)]
    fn cross_process_lock_path_for_a_not_yet_created_file_matches_a_concurrent_waiters_key() {
        // There is now exactly one lock namespace regardless of whether
        // the session file exists yet - this directly closes the second
        // C2P1-RR-005B variant (a bootstrap-path waiter stranded in a
        // different namespace than a writer that saw the file already
        // created), since that second namespace no longer exists to
        // diverge into.
        let root = temp_root();
        let session_path = root.join("session.json");
        let key_before_creation_attempt_1 = CrossProcessSessionLock::lock_path_for(&session_path).unwrap();
        let key_before_creation_attempt_2 = CrossProcessSessionLock::lock_path_for(&session_path).unwrap();
        assert_eq!(
            key_before_creation_attempt_1, key_before_creation_attempt_2,
            "two callers checking before the file exists must agree on the same lock, with no separate bootstrap namespace to diverge into"
        );
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    #[cfg(windows)]
    fn cross_process_lock_still_blocks_a_late_acquirer_that_only_sees_the_post_rename_file() {
        // C2P1-RR-005B's exact named scenario: writer A holds the lock,
        // performs the atomic rename, and stays paused BEFORE releasing
        // the guard; writer B's own `lock_path_for` call happens
        // strictly AFTER that rename - under the prior file-identity-keyed
        // scheme, B would have computed a *different*, uncontended lock
        // name right here. B must still block until A actually releases.
        let root = temp_root();
        let session_path = root.join("session.json");
        fs::write(&session_path, b"{}").unwrap();

        let lock_a = CrossProcessSessionLock::acquire(&session_path).unwrap();
        let key_a_is_holding = CrossProcessSessionLock::lock_path_for(&session_path).unwrap();

        // Simulate "A performed its atomic rename while still holding the
        // lock" - exactly what `write_session_if_current` does mid-critical
        // section, before this guard is dropped.
        atomic_write_with_fsync(&session_path, br#"{"revision":1}"#).unwrap();

        let key_after_rename = CrossProcessSessionLock::lock_path_for(&session_path).unwrap();
        assert_eq!(key_a_is_holding, key_after_rename, "the key computed after the rename must be the exact key A is holding");

        let b_acquired = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let b_acquired_clone = b_acquired.clone();
        let session_path_clone = session_path.clone();
        let handle = std::thread::spawn(move || {
            let _b = CrossProcessSessionLock::acquire(&session_path_clone).unwrap();
            b_acquired_clone.store(true, std::sync::atomic::Ordering::SeqCst);
        });

        std::thread::sleep(std::time::Duration::from_millis(150));
        assert!(
            !b_acquired.load(std::sync::atomic::Ordering::SeqCst),
            "B must still be blocked by A's lock even though A already performed its rename"
        );

        drop(lock_a);
        handle.join().unwrap();
        assert!(b_acquired.load(std::sync::atomic::Ordering::SeqCst), "B must complete once A actually releases");

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    #[cfg(windows)]
    fn cross_process_lock_fails_closed_when_the_session_directory_cannot_be_queried() {
        // No fallback namespace exists to silently degrade into anymore -
        // a parent directory that can't be opened/queried must refuse
        // outright, not quietly pick a weaker scheme.
        let session_path = PathBuf::from(r"Z:\definitely-does-not-exist-anywhere-on-this-machine\session.json");
        let err = CrossProcessSessionLock::lock_path_for(&session_path).unwrap_err();
        assert!(!err.is_empty());
        fs::remove_dir_all("Z:\\definitely-does-not-exist-anywhere-on-this-machine").ok();
    }

    #[test]
    fn write_session_if_current_resolves_concurrent_first_ever_creation_to_exactly_one_winner() {
        let root = temp_root();
        let path = root.join("session.json");
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
        let make_writer = |text: &'static [u8]| {
            let path = path.clone();
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                barrier.wait();
                write_session_if_current(&path, 0, text)
            })
        };
        let t1 = make_writer(br#"{"revision":1,"writer":"a"}"#);
        let t2 = make_writer(br#"{"revision":1,"writer":"b"}"#);
        let r1 = t1.join().unwrap();
        let r2 = t2.join().unwrap();
        let successes = [&r1, &r2].into_iter().filter(|r| r.is_ok()).count();
        assert_eq!(successes, 1, "exactly one of two concurrent first-ever-creation writers must win, not zero or both");
        assert_eq!(read_current_revision(&path).unwrap(), 1);
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
        let path = root.join("session.json");
        write_session_if_current(&path, 0, br#"{"revision":1}"#).unwrap();

        let external_lock = CrossProcessSessionLock::acquire(&path).unwrap();
        let path_clone = path.clone();
        let writer = std::thread::spawn(move || write_session_if_current(&path_clone, 1, br#"{"revision":2,"writer":"blocked-writer"}"#));

        std::thread::sleep(std::time::Duration::from_millis(100));
        assert_eq!(read_current_revision(&path).unwrap(), 1, "the writer must still be blocked on the externally-held cross-process lock");

        drop(external_lock);
        let result = writer.join().unwrap();
        assert!(result.is_ok());
        assert_eq!(read_current_revision(&path).unwrap(), 2);

        fs::remove_dir_all(&root).ok();
    }

    /// Child-process helper for
    /// `write_session_if_current_is_blocked_by_a_genuinely_separate_process`
    /// below — never runs as part of the normal suite (`#[ignore]`); the
    /// parent test spawns THIS SAME test binary and asks it, by exact
    /// name, to run only this one test. Acquires the real cross-process
    /// lock, signals readiness by writing a marker file, holds the lock
    /// for a fixed duration, then exits (releasing it).
    #[test]
    #[ignore]
    #[cfg(windows)]
    fn cross_process_lock_child_helper_acquire_and_hold() {
        let session_path = PathBuf::from(std::env::var("FORGE_TEST_LOCK_SESSION_PATH").expect("env var required"));
        let ready_path = PathBuf::from(std::env::var("FORGE_TEST_LOCK_READY_PATH").expect("env var required"));
        let _lock = CrossProcessSessionLock::acquire(&session_path).expect("child process failed to acquire the lock");
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
        let session_path = root.join("session.json");
        write_session_if_current(&session_path, 0, br#"{"revision":1}"#).unwrap();

        let ready_path = root.join("child-ready.marker");
        let exe = std::env::current_exe().expect("current_exe should resolve for a running test binary");
        let mut child = std::process::Command::new(&exe)
            .args(["sop_workspace::tests::cross_process_lock_child_helper_acquire_and_hold", "--exact", "--ignored", "--test-threads=1"])
            .env("FORGE_TEST_LOCK_SESSION_PATH", &session_path)
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
        let path_clone = session_path.clone();
        let writer = std::thread::spawn(move || write_session_if_current(&path_clone, 1, br#"{"revision":2,"writer":"parent-process"}"#));

        std::thread::sleep(std::time::Duration::from_millis(150));
        assert_eq!(
            read_current_revision(&session_path).unwrap(),
            1,
            "the parent-process writer must still be blocked by the separate child process's lock"
        );

        child.wait().expect("child process should exit cleanly, releasing the lock");
        let result = writer.join().unwrap();
        assert!(result.is_ok(), "{:?}", result);
        assert_eq!(read_current_revision(&session_path).unwrap(), 2);

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
