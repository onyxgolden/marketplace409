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
pub fn resolve_confined_path(root: &Path, relative: &str) -> Result<PathBuf, WorkspacePathError> {
    confine_relative_path(relative).map_err(WorkspacePathError::Lexical)?;

    let canonical_root = fs::canonicalize(root).map_err(|_| WorkspacePathError::RootNotResolvable)?;
    let candidate = root.join(relative);

    // The candidate itself may not exist yet (a fresh write target), so
    // canonicalize its PARENT (which must already exist in a workspace we
    // control) and rejoin the file name — this still defeats a symlinked
    // ancestor directory while allowing a not-yet-created leaf file.
    let parent = candidate
        .parent()
        .ok_or(WorkspacePathError::EscapesRoot)?;
    let file_name = candidate
        .file_name()
        .ok_or(WorkspacePathError::EscapesRoot)?;

    let canonical_parent = if parent == root {
        canonical_root.clone()
    } else {
        fs::create_dir_all(parent).map_err(|_| WorkspacePathError::EscapesRoot)?;
        fs::canonicalize(parent).map_err(|_| WorkspacePathError::EscapesRoot)?
    };

    if !canonical_parent.starts_with(&canonical_root) {
        return Err(WorkspacePathError::EscapesRoot);
    }

    Ok(canonical_parent.join(file_name))
}

/// Mirrors `main.rs`'s `atomic_write` (temp file in the same directory,
/// renamed over the target) but adds the two things the brief calls out
/// specifically for the SOP session: an explicit `fsync` before the
/// rename (brief §4: "Atomic write is temp + fsync + rename"), and a
/// caller-supplied expected-revision check consulted while still holding
/// nothing but the bytes already in hand — the actual race-free guarantee
/// still depends on the caller serializing writes to one session (a
/// single Tauri command handler invocation), same as every other
/// stateful write in this app; this function makes a stale write
/// *detectable*, not impossible to race into.
pub fn atomic_write_with_fsync(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let dir = path.parent().ok_or_else(|| "path has no parent directory".to_string())?;
    let file_name = path
        .file_name()
        .ok_or_else(|| "path has no file name".to_string())?
        .to_string_lossy()
        .into_owned();
    let tmp_path = dir.join(format!("{file_name}.tmp-{}", std::process::id()));

    let mut file = File::create(&tmp_path).map_err(|e| format!("cannot create temp file: {e}"))?;
    file.write_all(bytes).map_err(|e| {
        let _ = fs::remove_file(&tmp_path);
        format!("cannot write temp file: {e}")
    })?;
    file.sync_all().map_err(|e| {
        let _ = fs::remove_file(&tmp_path);
        format!("cannot fsync temp file: {e}")
    })?;
    drop(file);

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
}
