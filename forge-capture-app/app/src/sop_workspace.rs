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

use std::fs;
use std::io::Write as _;
use std::path::{Path, PathBuf};

use forge_capture_core::sop_ipc::{confine_relative_path, PathConfinementError};

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
/// C2P1-004 fix round: the prior version called `create_dir_all(parent)`
/// *before* proving the parent chain was safe, so a symlinked existing
/// component followed by a missing descendant (e.g.
/// `escape_link/newdir/file`, where `escape_link` is a junction to
/// somewhere outside root) could have `newdir` created **outside** the
/// root before the escape was even detected — mutating the filesystem
/// ahead of the check it's supposed to be gated by. This version performs
/// **no filesystem mutation until every existing ancestor component has
/// been individually verified non-reparse and still-under-root**, walking
/// one component at a time rather than trusting one `canonicalize()` call
/// on an already-partially-created path.
pub fn resolve_confined_path(root: &Path, relative: &str) -> Result<PathBuf, WorkspacePathError> {
    confine_relative_path(relative).map_err(WorkspacePathError::Lexical)?;

    let canonical_root = fs::canonicalize(root).map_err(|_| WorkspacePathError::RootNotResolvable)?;

    let components: Vec<&str> = relative.split(['/', '\\']).filter(|c| !c.is_empty()).collect();
    if components.is_empty() {
        return Err(WorkspacePathError::EscapesRoot);
    }

    // Walk every component EXCEPT the last (the ancestor directories).
    // Each one must already be a real, non-reparse directory under root —
    // verified via `symlink_metadata` (which does NOT follow the final
    // link, unlike `metadata`) before it is ever descended into or,
    // failing that, created. Nothing is created until the component
    // immediately being processed has itself been proven safe to create
    // (every component before it already passed this same check).
    let mut verified_parent = canonical_root.clone();
    for component in &components[..components.len() - 1] {
        let next = verified_parent.join(component);
        match fs::symlink_metadata(&next) {
            Ok(meta) => {
                if meta.file_type().is_symlink() || !meta.is_dir() {
                    return Err(WorkspacePathError::EscapesRoot);
                }
                // Re-canonicalize this single, now-verified-non-reparse
                // component and confirm it's still under root (defense in
                // depth against a TOCTOU swap between the metadata read
                // above and this call — canonicalize re-resolves fresh).
                let canon = fs::canonicalize(&next).map_err(|_| WorkspacePathError::EscapesRoot)?;
                if !canon.starts_with(&canonical_root) {
                    return Err(WorkspacePathError::EscapesRoot);
                }
                verified_parent = canon;
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                // Safe to create: `verified_parent` (everything up to and
                // including this component's own parent) has already
                // been individually verified above, so this single
                // `create_dir` cannot tunnel through anything unverified.
                // `create_dir`, not `create_dir_all` — exactly one level,
                // never a recursive jump past components this loop
                // hasn't checked yet.
                fs::create_dir(&next).map_err(|_| WorkspacePathError::EscapesRoot)?;
                verified_parent = next;
            }
            Err(_) => return Err(WorkspacePathError::EscapesRoot),
        }
    }

    let leaf = components[components.len() - 1];
    let leaf_path = verified_parent.join(leaf);
    // If the leaf already exists, it must not itself be a symlink/reparse
    // point — a pre-positioned link at the exact target name must never
    // be followed for a write (the write primitive, `atomic_write_with_
    // fsync`, independently re-checks this immediately before its final
    // rename too — defense in depth, not reliance on this check alone).
    if let Ok(meta) = fs::symlink_metadata(&leaf_path) {
        if meta.file_type().is_symlink() {
            return Err(WorkspacePathError::EscapesRoot);
        }
    }
    Ok(leaf_path)
}

/// Generates a short, process-and-call-unique suffix for a temp file name.
/// Not cryptographic randomness — exclusivity is enforced by
/// `create_new(true)` at the actual file-creation call, not by this value
/// being unguessable. This only needs to make retries converge quickly
/// after a same-name collision (same process, same millisecond, two
/// threads) rather than loop indefinitely.
fn temp_name_nonce() -> u64 {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let counter = COUNTER.fetch_add(1, Ordering::Relaxed);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.subsec_nanos() as u64)
        .unwrap_or(0);
    nanos ^ counter.wrapping_mul(0x9E3779B97F4A7C15) // golden-ratio mix, just to spread bits
}

/// Mirrors `main.rs`'s `atomic_write` (temp file in the same directory,
/// renamed over the target) but adds what the brief and the C2P1-004/005
/// re-review call for specifically: an explicit `fsync` before the rename
/// (brief §4: "Atomic write is temp + fsync + rename"), an **exclusive**
/// temp file creation (`create_new`, never `File::create`, which would
/// silently truncate/follow an existing file or link already sitting at
/// the predicted temp name), a randomized-enough name that a same-process
/// concurrent writer doesn't collide with (the prior PID-only name did),
/// and a final re-verification that the destination isn't a symlink
/// immediately before the rename that finalizes the write.
///
/// This function alone does not make concurrent writers to the SAME
/// session race-free — [`write_session_if_current_locked`] is what
/// serializes those; this function's own guarantee is narrower: whichever
/// single call wins never corrupts a partial write, never silently
/// follows a planted link, and never collides with another temp file by
/// name.
pub fn atomic_write_with_fsync(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let dir = path.parent().ok_or_else(|| "path has no parent directory".to_string())?;
    let file_name = path
        .file_name()
        .ok_or_else(|| "path has no file name".to_string())?
        .to_string_lossy()
        .into_owned();

    // Bounded retry on an exclusive-create collision (extremely unlikely
    // given the nonce, but a collision must retry with a fresh name, not
    // fall back to a non-exclusive create).
    const MAX_ATTEMPTS: u32 = 8;
    let mut last_err: Option<std::io::Error> = None;
    let mut tmp_path = dir.join(format!("{file_name}.tmp-{}-{}", std::process::id(), temp_name_nonce()));
    let mut file = None;
    for _ in 0..MAX_ATTEMPTS {
        match fs::OpenOptions::new().write(true).create_new(true).open(&tmp_path) {
            Ok(f) => {
                file = Some(f);
                break;
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                last_err = Some(e);
                tmp_path = dir.join(format!("{file_name}.tmp-{}-{}", std::process::id(), temp_name_nonce()));
            }
            Err(e) => return Err(format!("cannot exclusively create temp file: {e}")),
        }
    }
    let mut file = file.ok_or_else(|| {
        format!(
            "cannot exclusively create temp file after {MAX_ATTEMPTS} attempts: {}",
            last_err.map(|e| e.to_string()).unwrap_or_default()
        )
    })?;

    file.write_all(bytes).map_err(|e| {
        let _ = fs::remove_file(&tmp_path);
        format!("cannot write temp file: {e}")
    })?;
    file.sync_all().map_err(|e| {
        let _ = fs::remove_file(&tmp_path);
        format!("cannot fsync temp file: {e}")
    })?;
    drop(file);

    // Re-verify the destination isn't a symlink/reparse point right
    // before finalizing — defense in depth against a link planted at
    // `path` between the caller's earlier `resolve_confined_path` check
    // and this write (the same reasoning as that function's own leaf
    // check, kept as two independent checks rather than relying on one).
    if let Ok(meta) = fs::symlink_metadata(path) {
        if meta.file_type().is_symlink() {
            let _ = fs::remove_file(&tmp_path);
            return Err("destination path is a symlink/reparse point; refusing to finalize".to_string());
        }
    }

    fs::rename(&tmp_path, path).map_err(|e| {
        let _ = fs::remove_file(&tmp_path);
        format!("cannot finalize file: {e}")
    })
}

/// Reads the `revision` field out of an on-disk session JSON file without
/// fully deserializing/validating the rest of it — used immediately
/// before [`atomic_write_with_fsync`] to decide whether the caller's
/// `expected_revision` is still current. A missing file is revision 0
/// (no session written yet), never an error — a brand-new session has
/// nothing to be stale against.
pub fn read_current_revision(path: &Path) -> Result<u64, String> {
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

/// Writes a session file, but only if `expected_revision` still matches
/// what's actually on disk — otherwise refuses with
/// [`forge_capture_core::sop_session::StaleRevisionError`] and writes
/// nothing, leaving the existing file exactly as it was.
pub fn write_session_if_current(
    path: &Path,
    expected_revision: u64,
    bytes: &[u8],
) -> Result<(), SessionWriteError> {
    let current = read_current_revision(path).map_err(SessionWriteError::Io)?;
    forge_capture_core::sop_session::check_expected_revision(current, expected_revision)
        .map_err(SessionWriteError::Stale)?;
    atomic_write_with_fsync(path, bytes).map_err(SessionWriteError::Io)
}

#[derive(Debug)]
pub enum SessionWriteError {
    Stale(forge_capture_core::sop_session::StaleRevisionError),
    Io(String),
}

/// C2P1-005 fix: [`write_session_if_current`] alone is check-then-act —
/// two overlapping callers can both read the same current revision, both
/// pass the comparison, and both write, with the later rename silently
/// winning over the earlier one's "success." A code comment asserting the
/// caller serializes writes is not an enforced contract (separate Tauri
/// command invocations are not guaranteed not to overlap in practice).
///
/// `SessionLocks` is a real, enforced per-session mutual-exclusion
/// primitive: one `Mutex<()>` per `session_id`, created on first use and
/// reused after. A caller holds a session's lock for the ENTIRE
/// read-current-revision + compare + write span via
/// [`write_session_if_current_locked`] — not just around the final write
/// — so two overlapping writers with the same `expected_revision` are
/// strictly serialized: the first to acquire the lock reads, validates,
/// and writes (advancing the on-disk revision); the second then reads
/// the NEW current revision (now stale relative to what it expected) and
/// is correctly rejected by [`forge_capture_core::sop_session::check_expected_revision`]
/// — never racing to both "succeed."
pub struct SessionLocks {
    locks: std::sync::Mutex<std::collections::HashMap<String, std::sync::Arc<std::sync::Mutex<()>>>>,
}

impl SessionLocks {
    pub fn new() -> Self {
        Self { locks: std::sync::Mutex::new(std::collections::HashMap::new()) }
    }

    /// Returns the (possibly newly-created) lock for `session_id`. The
    /// short-lived registry lock only guards the hashmap lookup/insert
    /// itself, never the actual session read/write work — that happens
    /// after this call returns, under the returned per-session lock.
    fn lock_for(&self, session_id: &str) -> std::sync::Arc<std::sync::Mutex<()>> {
        let mut registry = self.locks.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        registry.entry(session_id.to_string()).or_insert_with(|| std::sync::Arc::new(std::sync::Mutex::new(()))).clone()
    }
}

impl Default for SessionLocks {
    fn default() -> Self {
        Self::new()
    }
}

/// The race-free entry point: holds `session_id`'s lock across the whole
/// read-validate-write sequence. Two threads/command-invocations calling
/// this concurrently for the SAME `session_id` are fully serialized by
/// this function; calls for DIFFERENT session ids never block each other.
pub fn write_session_if_current_locked(
    locks: &SessionLocks,
    session_id: &str,
    path: &Path,
    expected_revision: u64,
    bytes: &[u8],
) -> Result<(), SessionWriteError> {
    let lock = locks.lock_for(session_id);
    let _guard = lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    write_session_if_current(path, expected_revision, bytes)
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

// --- Vault directory ACL gate (C2P1-006) ---
//
// C2P1-006 re-review finding: this slice relies on the app data
// directory's inherited per-user permissions rather than creating and
// verifying an explicit restricted DACL on the session vault directory
// itself — the brief calls for an "ACL-restricted session vault," which
// matters for deletion/tampering protection, not just confidentiality
// (DPAPI below already covers confidentiality-at-rest on the file
// contents; a DACL is the separate, additional protection against another
// account on the same machine deleting or replacing the vault's files).
//
// Implementing real DACL construction (SID lookup, ACL buffer sizing,
// SetNamedSecurityInfoW) is real, security-sensitive unsafe FFI this
// author could not verify against authoritative windows-rs 0.62 API
// signatures in this fix round (web lookups for the exact signatures
// returned nothing usable) — guessing at ACL/SID byte-layout code without
// being able to confirm it against real documentation is a worse outcome
// than being explicit about the gap. Per the re-review's own stated
// alternative ("explicitly narrow the slice acceptance and retain the ACL
// item as a blocking gate for the first raw-frame write"), this function
// is that gate: a REAL, enforced failure, not a documentation note alone.
// Any future code path that writes a raw (unencrypted-at-the-filesystem-
// ACL-layer) session frame into the vault must call this first and
// propagate its error — it always fails until a real DACL implementation
// replaces it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VaultAclError {
    /// The real DACL implementation does not exist yet — this is the
    /// C2P1-006 blocking gate firing exactly as intended, not a bug.
    NotYetImplemented,
}

/// Blocking gate for the first raw-frame write into the session vault.
/// Always returns `Err` — see the section doc comment above. A caller
/// must never catch this and proceed anyway; it exists specifically to
/// make "the ACL item isn't done yet" a loud, structural failure instead
/// of a silent gap a future author could miss.
pub fn require_vault_directory_acl_restricted(_path: &Path) -> Result<(), VaultAclError> {
    Err(VaultAclError::NotYetImplemented)
}

// --- DPAPI vault adapter (Windows only) ---
//
// Current-user scope (no CRYPTPROTECT_LOCAL_MACHINE flag), UI forbidden
// (CRYPTPROTECT_UI_FORBIDDEN — a DPAPI call that would need to prompt
// fails instead of silently blocking the process). The vault directory
// itself relies on the OS's own per-user ACLs on the app data directory
// (already current-user-only by default, same as every other sidecar
// this app writes) rather than this module setting custom ACLs — see the
// module doc comment; DPAPI encryption is the primary control here, the
// directory ACL is defense in depth inherited from the OS default, not a
// separate mechanism built in this slice.
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
    fn resolve_confined_path_creates_nothing_outside_the_vault_when_a_missing_descendant_is_requested_through_a_junction() {
        // C2P1-004's exact repro: escape_link/newdir/file, where
        // escape_link is a junction to `outside` and `newdir` does NOT
        // yet exist. The prior version's create_dir_all(parent) could
        // create `newdir` inside `outside` BEFORE detecting the escape.
        // This proves the fixed version creates nothing there at all.
        let root = temp_root();
        let outside = temp_root();
        let link = root.join("escape_link");
        let status = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J", &link.to_string_lossy(), &outside.to_string_lossy()])
            .status();
        if let Ok(status) = status {
            if status.success() {
                let outside_before: Vec<_> = fs::read_dir(&outside).unwrap().collect();
                assert!(outside_before.is_empty(), "test setup assumption violated");

                let err = resolve_confined_path(&root, "escape_link/newdir/file.png").unwrap_err();
                assert_eq!(err, WorkspacePathError::EscapesRoot);

                let outside_after: Vec<_> = fs::read_dir(&outside).unwrap().collect();
                assert!(outside_after.is_empty(), "rejection must create nothing outside the vault, found: {outside_after:?}");
            }
        }
        fs::remove_dir_all(&root).ok();
        fs::remove_dir_all(&outside).ok();
    }

    #[test]
    #[cfg(unix)]
    fn resolve_confined_path_rejects_a_preexisting_symlink_at_the_exact_leaf_path() {
        // A pre-positioned symlink sitting at the exact leaf name must
        // never be followed for a write, even if every ancestor
        // directory is perfectly legitimate.
        let root = temp_root();
        let outside_file = root.join("..").join(format!("outside-target-{}", rand_suffix()));
        fs::write(&outside_file, b"not yours").unwrap();
        std::os::unix::fs::symlink(&outside_file, root.join("planted.png")).unwrap();
        let err = resolve_confined_path(&root, "planted.png").unwrap_err();
        assert_eq!(err, WorkspacePathError::EscapesRoot);
        fs::remove_dir_all(&root).ok();
        fs::remove_file(&outside_file).ok();
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
    fn atomic_write_temp_file_is_exclusively_created_not_truncate_on_existing() {
        // C2P1-004: the temp file must be created with create_new, which
        // fails (rather than silently truncating/following) if anything
        // already exists at that exact name. This test can't predict the
        // random nonce, but it proves the underlying primitive genuinely
        // refuses to clobber a pre-existing file at an arbitrary name
        // sharing the same base — i.e. `create_new` really is exclusive,
        // not quietly degrading to `create`.
        let root = temp_root();
        let predictable_name = root.join("collide.tmp-test");
        fs::write(&predictable_name, b"pre-existing, must not be touched").unwrap();
        let result = fs::OpenOptions::new().write(true).create_new(true).open(&predictable_name);
        assert!(result.is_err());
        assert_eq!(fs::read(&predictable_name).unwrap(), b"pre-existing, must not be touched");
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn atomic_write_rejects_finalizing_over_a_symlinked_destination() {
        #[cfg(unix)]
        {
            let root = temp_root();
            let outside_file = root.join("..").join(format!("outside-dest-{}", rand_suffix()));
            fs::write(&outside_file, b"not yours").unwrap();
            let dest = root.join("session.json");
            std::os::unix::fs::symlink(&outside_file, &dest).unwrap();
            let result = atomic_write_with_fsync(&dest, b"attempted overwrite");
            assert!(result.is_err());
            // The symlink target must be untouched.
            assert_eq!(fs::read(&outside_file).unwrap(), b"not yours");
            fs::remove_dir_all(&root).ok();
            fs::remove_file(&outside_file).ok();
        }
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
    fn concurrent_writes_with_the_same_expected_revision_yield_exactly_one_winner() {
        // C2P1-005: the exact race the re-review flagged — two threads
        // both read revision 0, both pass the comparison, and (without a
        // lock) both successfully rename, with the last write silently
        // winning. `write_session_if_current_locked` must fully serialize
        // same-session writers so this is impossible: the second thread's
        // read happens strictly after the first thread's write under the
        // SAME lock, so it reads the NEW revision and is correctly
        // rejected as stale.
        let root = temp_root();
        let path = root.join("session.json");
        write_session_if_current(&path, 0, br#"{"revision":1}"#).unwrap(); // seed: current revision is now 1

        let locks = std::sync::Arc::new(SessionLocks::new());
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
        let path_a = path.clone();
        let path_b = path.clone();
        let locks_a = locks.clone();
        let locks_b = locks.clone();
        let barrier_a = barrier.clone();
        let barrier_b = barrier.clone();

        let thread_a = std::thread::spawn(move || {
            barrier_a.wait(); // both threads start their attempt at the same instant
            write_session_if_current_locked(&locks_a, "sess-1", &path_a, 1, br#"{"revision":2,"writer":"a"}"#)
        });
        let thread_b = std::thread::spawn(move || {
            barrier_b.wait();
            write_session_if_current_locked(&locks_b, "sess-1", &path_b, 1, br#"{"revision":2,"writer":"b"}"#)
        });

        let result_a = thread_a.join().unwrap();
        let result_b = thread_b.join().unwrap();

        let a_won = result_a.is_ok();
        let b_won = result_b.is_ok();
        // Exactly one winner, never both, never neither.
        assert_ne!(a_won, b_won, "expected exactly one writer to win: a={a_won:?} b={b_won:?}");

        // Read back the winning durable revision and confirm it matches
        // whichever one actually won (no silent last-write-wins mixing).
        let final_bytes = fs::read(&path).unwrap();
        let final_json: serde_json::Value = serde_json::from_slice(&final_bytes).unwrap();
        let expected_writer = if a_won { "a" } else { "b" };
        assert_eq!(final_json["writer"], expected_writer);
        assert_eq!(final_json["revision"], 2);

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn different_session_ids_do_not_block_each_other() {
        let root = temp_root();
        let path_x = root.join("sess-x.json");
        let path_y = root.join("sess-y.json");
        let locks = SessionLocks::new();
        assert!(write_session_if_current_locked(&locks, "sess-x", &path_x, 0, br#"{"revision":1}"#).is_ok());
        assert!(write_session_if_current_locked(&locks, "sess-y", &path_y, 0, br#"{"revision":1}"#).is_ok());
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

    // --- vault ACL blocking gate (C2P1-006) ---

    #[test]
    fn require_vault_directory_acl_restricted_always_fails_until_the_real_implementation_lands() {
        let root = temp_root();
        let result = require_vault_directory_acl_restricted(&root);
        assert_eq!(result, Err(VaultAclError::NotYetImplemented));
        fs::remove_dir_all(&root).ok();
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
}
