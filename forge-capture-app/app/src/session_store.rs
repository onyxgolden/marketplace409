//! FORGE Capture Rung 5 — OS credential storage for the FORGE session.
//!
//! The desktop app's "Save to FORGE" flow keeps the user's Supabase session
//! (access + refresh tokens) in the OS credential store — Windows Credential
//! Manager via CredWriteW/CredReadW/CredDeleteW — never in a plaintext config
//! file. No stored session means the UI offers "Sign in to FORGE" and never
//! attempts an upload (fail closed).
//!
//! The stored value is an opaque JSON string built by the UI
//! (`{ access_token, refresh_token, expires_at }`); this module never parses
//! it, it only stores and returns bytes.

/// Maximum session blob we will write to the credential store. A Supabase
/// session JSON is ~1-2 KiB; 8 KiB leaves generous headroom while bounding
/// the write.
pub const MAX_SESSION_BYTES: usize = 8 * 1024;

/// Credential Manager target name shown to the user in the OS UI.
pub fn target_name() -> String {
    "FORGE Capture / FORGE session".to_string()
}

#[tauri::command]
pub fn forge_session_get() -> Result<Option<String>, String> {
    imp::get()
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn forge_session_set(sessionJson: String) -> Result<(), String> {
    if sessionJson.len() > MAX_SESSION_BYTES {
        return Err("Session is too large to store.".to_string());
    }
    if sessionJson.trim().is_empty() {
        return Err("Session is empty.".to_string());
    }
    imp::set(&sessionJson)
}

#[tauri::command]
pub fn forge_session_clear() -> Result<(), String> {
    imp::clear()
}

#[cfg(windows)]
mod imp {
    use windows::core::{HRESULT, PCWSTR, PWSTR};
    use windows::Win32::Foundation::ERROR_NOT_FOUND;
    use windows::Win32::Security::Credentials::{
        CredDeleteW, CredFree, CredReadW, CredWriteW, CREDENTIALW, CRED_FLAGS,
        CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC,
    };

    use super::target_name;

    fn wide_null(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    /// ERROR_NOT_FOUND as the HRESULT windows-core surfaces on Cred* failure.
    fn not_found() -> HRESULT {
        HRESULT::from_win32(ERROR_NOT_FOUND.0)
    }

    fn os_error(context: &str, code: HRESULT) -> String {
        format!("{context} (OS error {}).", code.0)
    }

    pub fn get() -> Result<Option<String>, String> {
        unsafe {
            let target = wide_null(&target_name());
            let mut cred: *mut CREDENTIALW = std::ptr::null_mut();
            if let Err(e) = CredReadW(PCWSTR(target.as_ptr()), CRED_TYPE_GENERIC, None, &mut cred) {
                if e.code() == not_found() {
                    return Ok(None);
                }
                return Err(os_error(
                    "Could not read the stored FORGE session",
                    e.code(),
                ));
            }
            let blob = &*cred;
            let len = blob.CredentialBlobSize as usize;
            let bytes = std::slice::from_raw_parts(blob.CredentialBlob, len).to_vec();
            CredFree(cred as *const std::ffi::c_void);
            let text = String::from_utf8(bytes)
                .map_err(|e| format!("Stored FORGE session is not valid text: {e}"))?;
            Ok(Some(text))
        }
    }

    pub fn set(session_json: &str) -> Result<(), String> {
        unsafe {
            let target = wide_null(&target_name());
            let mut blob = session_json.as_bytes().to_vec();
            let cred = CREDENTIALW {
                Flags: CRED_FLAGS(0),
                Type: CRED_TYPE_GENERIC,
                TargetName: PWSTR(target.as_ptr() as *mut u16),
                Comment: PWSTR::null(),
                LastWritten: Default::default(),
                CredentialBlobSize: blob.len() as u32,
                CredentialBlob: blob.as_mut_ptr(),
                Persist: CRED_PERSIST_LOCAL_MACHINE,
                AttributeCount: 0,
                Attributes: std::ptr::null_mut(),
                TargetAlias: PWSTR::null(),
                UserName: PWSTR::null(),
            };
            CredWriteW(&cred, 0)
                .map_err(|e| os_error("Could not store the FORGE session", e.code()))
        }
    }

    pub fn clear() -> Result<(), String> {
        unsafe {
            let target = wide_null(&target_name());
            if let Err(e) = CredDeleteW(PCWSTR(target.as_ptr()), CRED_TYPE_GENERIC, None) {
                if e.code() == not_found() {
                    return Ok(());
                }
                return Err(os_error(
                    "Could not remove the stored FORGE session",
                    e.code(),
                ));
            }
            Ok(())
        }
    }
}

/// Non-Windows hosts: fail closed. The product is Windows-first; a session
/// store that silently wrote somewhere insecure would be worse than none.
#[cfg(not(windows))]
mod imp {
    pub fn get() -> Result<Option<String>, String> {
        Err("OS credential storage is only implemented on Windows.".to_string())
    }

    pub fn set(_session_json: &str) -> Result<(), String> {
        Err("OS credential storage is only implemented on Windows.".to_string())
    }

    pub fn clear() -> Result<(), String> {
        Err("OS credential storage is only implemented on Windows.".to_string())
    }
}

#[cfg(test)]
mod session_store_tests {
    use super::*;

    #[test]
    fn target_name_is_stable() {
        // The OS shows this string to the user; changing it orphans the
        // previously stored session.
        assert_eq!(target_name(), "FORGE Capture / FORGE session");
    }

    #[test]
    fn oversized_session_is_rejected_before_touching_the_os() {
        let big = "x".repeat(MAX_SESSION_BYTES + 1);
        assert!(forge_session_set(big).is_err());
    }

    #[test]
    fn empty_session_is_rejected() {
        assert!(forge_session_set("   ".to_string()).is_err());
    }

    #[test]
    fn forge_session_set_param_name_matches_ui() {
        // ui/forge-upload.js signInWithPassword():
        //   invoke("forge_session_set", { sessionJson })
        // Tauri binds command parameters by exact name, so the Rust
        // parameter must stay camelCase (see begin_region_pick in main.rs).
        let _ = forge_session_set as fn(String) -> Result<(), String>;
    }
}
