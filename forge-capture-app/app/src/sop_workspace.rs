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
}

/// Resolves `relative` against `root`, refusing anything that would
/// escape `root` either lexically (per
/// [`forge_capture_core::sop_ipc::confine_relative_path`]) or physically
/// (via a symlink/junction on disk). `relative` does not need to exist
/// yet (a path being written for the first time) — only `root` must.
///
/// Walks one path component at a time starting from the canonicalized
/// root, checking each *existing* component with [`fs::symlink_metadata`]
/// (never following it) before ever deciding whether to create the next
/// one. No filesystem mutation happens until every existing ancestor
/// component has been proven not to be a reparse point — the previous
/// version of this function called `create_dir_all` on an unverified
/// parent *before* canonicalizing it, so a symlinked/junctioned existing
/// component with a missing descendant (e.g. `escape_link/newdir/file`
/// where `escape_link` points outside `root`) could have `newdir`
/// created outside `root` and only be rejected afterward. Any missing
/// intermediate directory this function itself creates is re-verified
/// immediately after creation, before it is trusted as the base for the
/// next component, narrowing (not eliminating — no `openat`-equivalent
/// is available through `std` alone) the window between check and use.
pub fn resolve_confined_path(root: &Path, relative: &str) -> Result<PathBuf, WorkspacePathError> {
    confine_relative_path(relative).map_err(WorkspacePathError::Lexical)?;

    let canonical_root = fs::canonicalize(root).map_err(|_| WorkspacePathError::RootNotResolvable)?;

    let components: Vec<&str> = relative.split(['/', '\\']).collect();
    let mut current = canonical_root.clone();
    for (i, component) in components.iter().enumerate() {
        let candidate = current.join(component);
        let is_last = i == components.len() - 1;
        match fs::symlink_metadata(&candidate) {
            Ok(meta) => {
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
            Err(_) if is_last => {
                // The leaf does not exist yet — fine, this is a fresh
                // write target. Nothing to verify or create here; the
                // caller creates the leaf itself (via an exclusive,
                // no-follow open), never this function.
                current = candidate;
            }
            Err(_) => {
                // A missing intermediate directory in a workspace this
                // process owns — create exactly this one component (not
                // `create_dir_all`, which would blindly create every
                // remaining component past an attacker-controlled
                // ancestor we haven't checked yet) and immediately
                // re-verify it before trusting it as the next `current`.
                fs::create_dir(&candidate).map_err(|_| WorkspacePathError::EscapesRoot)?;
                let meta = fs::symlink_metadata(&candidate).map_err(|_| WorkspacePathError::EscapesRoot)?;
                if is_reparse_point(&meta) || !meta.is_dir() {
                    return Err(WorkspacePathError::EscapesRoot);
                }
                current = candidate;
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
    // overwriting through it. This narrows, but (without an
    // `openat`-equivalent through plain `std`) cannot fully close, the
    // window between this check and the rename immediately below.
    if let Ok(existing) = fs::symlink_metadata(path) {
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
    match fs::symlink_metadata(path) {
        Ok(meta) if is_reparse_point(&meta) => {
            return Err("refusing to read a reparse point at the session path".to_string());
        }
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(0),
        Err(e) => return Err(format!("cannot stat session file: {e}")),
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
/// lock across its entire read-validate-write-rename sequence, so two
/// overlapping Tauri command invocations for one session (the exact
/// race the brief's "stale revisions reject instead of overwriting
/// concurrent edits" and the prior code's bare comment-only promise both
/// failed to actually enforce) can no longer both read the same
/// `current` revision before either has written. Keyed by path within
/// this process; see [`write_session_if_current`]'s own doc comment for
/// the scope this does and does not cover.
fn session_lock(path: &Path) -> std::sync::Arc<std::sync::Mutex<()>> {
    static REGISTRY: std::sync::OnceLock<std::sync::Mutex<std::collections::HashMap<PathBuf, std::sync::Arc<std::sync::Mutex<()>>>>> =
        std::sync::OnceLock::new();
    let registry = REGISTRY.get_or_init(|| std::sync::Mutex::new(std::collections::HashMap::new()));
    let mut map = registry.lock().unwrap_or_else(|e| e.into_inner());
    map.entry(path.to_path_buf()).or_insert_with(|| std::sync::Arc::new(std::sync::Mutex::new(()))).clone()
}

/// Writes a session file, but only if `expected_revision` still matches
/// what's actually on disk — otherwise refuses with
/// [`forge_capture_core::sop_session::StaleRevisionError`] and writes
/// nothing, leaving the existing file exactly as it was.
///
/// Holds [`session_lock`] for `path` across the entire
/// read-current-revision / check / write / rename sequence, so two
/// overlapping callers racing for the same `expected_revision` are
/// strictly serialized: whichever acquires the lock first reads the true
/// current revision, succeeds, and advances it; the second then reads
/// the *new* current revision under the same lock and is correctly
/// rejected as stale, rather than both having read the old revision
/// before either wrote (the prior check-then-act race). This covers
/// concurrent calls within this process — the realistic domain for
/// "separate Tauri command invocations may overlap," since all of this
/// app's commands run in one process. It does not provide a durable
/// cross-process lock (e.g. two separate launches of the app against the
/// same vault); the atomic rename still prevents a corrupt/partial file
/// in that case, at the cost of a possible lost update, same as any
/// single-process-assumption Tauri command today.
pub fn write_session_if_current(
    path: &Path,
    expected_revision: u64,
    bytes: &[u8],
) -> Result<(), SessionWriteError> {
    let lock = session_lock(path);
    let _guard = lock.lock().unwrap_or_else(|e| e.into_inner());

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
    fn resolve_confined_path_accepts_an_ordinary_relative_path() {
        let root = temp_root();
        let resolved = resolve_confined_path(&root, "frames/f1.png").unwrap();
        assert!(resolved.starts_with(fs::canonicalize(&root).unwrap()));
        fs::remove_dir_all(&root).ok();
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
