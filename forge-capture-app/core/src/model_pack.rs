//! FORGE Capture AI model-pack supply-chain gate (build slice C2-P2).
//!
//! Plan: `results/chatgpt/capture-ai-caption-pipeline-implementation-brief-2026-10-26.md`
//! §9: "Manifest and every asset have SHA-256, byte length, model ID/
//! revision, license, and minimum sidecar protocol." §2.5: "Download goes
//! to a temporary name, is hash/signature verified, then atomically
//! renamed. No partial model is loadable... Revoked/unknown manifests are
//! refused."
//!
//! This module owns the generic, pure (filesystem-only, no ML runtime)
//! half of that gate: parsing a `manifest.json`, verifying it is the exact
//! manifest a caller expects (by the manifest file's own SHA-256 — the
//! same identity the sidecar IPC protocol already carries as
//! [`crate::sop_ipc::IpcRequest::model_manifest_sha256`]), and verifying
//! every listed asset file on disk matches its declared hash and byte
//! length before anything is allowed to load it. It is deliberately not
//! OCR/NER/caption-specific: C2-P4's NER pack and C2-P5's caption pack
//! reuse this same verification, not a second hand-rolled copy.
//!
//! What this module does **not** do: download anything, fetch a remote
//! signature, or decide trust-on-first-use. Brief §2.5's atomic
//! temp-name-then-rename download path and revocation list are app/
//! installer concerns (C2-P7); this module only ever reads a pack that is
//! already fully present on disk and answers "is this exactly the pack it
//! claims to be, byte for byte."

use std::path::Path;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::sop_ipc::{confine_relative_path, is_valid_sha256_hex, PathConfinementError};

/// Current model-pack manifest schema version. [`parse_manifest`] rejects
/// anything newer, same fail-closed convention as
/// [`crate::sop_ipc::SIDECAR_PROTOCOL_VERSION`] and
/// [`crate::sop_session::SOP_SESSION_SCHEMA_VERSION`].
pub const MODEL_PACK_MANIFEST_SCHEMA_VERSION: u32 = 1;

/// Upper bounds on manifest-carried strings/collections — the manifest
/// file itself is read before any trust decision is made about it, so
/// every field gets the same bounded-before-use treatment as an IPC
/// request (see `crate::sop_ipc`), not an unbounded `String`/`Vec`.
pub const MAX_MANIFEST_BYTES: usize = 1024 * 1024;
pub const MAX_ASSETS_PER_MANIFEST: usize = 64;
pub const MAX_PACK_ID_LEN: usize = 256;
pub const MAX_MODEL_ID_LEN: usize = 256;
pub const MAX_REVISION_LEN: usize = 256;
pub const MAX_LICENSE_LEN: usize = 128;
/// A single model asset file this pack ships is refused above this size —
/// generous for any mobile PP-OCR/GLiNER/Florence-2-base ONNX graph this
/// program ships, small enough that a manifest cannot direct this process
/// to read gigabytes of file into memory for hashing.
pub const MAX_ASSET_BYTES: u64 = 512 * 1024 * 1024;

/// Brief §9/§2.5: one model-pack asset's declared identity.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ModelAsset {
    /// Path relative to the pack directory — lexically confined the same
    /// way an IPC [`crate::sop_ipc::BoundedPath`] is (see
    /// [`verify_model_pack`]); never absolute, never `..`.
    pub relative_path: String,
    pub sha256: String,
    pub byte_len: u64,
    pub model_id: String,
    pub revision: String,
    pub license: String,
}

/// Brief §9/§2.5: the full model-pack manifest.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ModelManifest {
    pub schema_version: u32,
    pub pack_id: String,
    pub assets: Vec<ModelAsset>,
    /// Brief §2.1 IPC protocol floor this pack requires — a sidecar
    /// running an older protocol must refuse this pack rather than guess
    /// compatibility.
    pub min_sidecar_protocol_version: u32,
}

/// Every distinct way a candidate model pack is refused — brief §2.5:
/// "Revoked/unknown manifests are refused," never silently degraded to
/// "best effort."
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ModelPackError {
    ManifestMissing,
    ManifestTooLarge { found_bytes: u64, max_bytes: usize },
    ManifestIo(String),
    ManifestParse(String),
    UnsupportedManifestSchemaVersion { found: u32, max_supported: u32 },
    /// The manifest file's own SHA-256 does not match the digest the
    /// caller expected (e.g. an `IpcRequest::model_manifest_sha256`) —
    /// this is the exact-identity check, independent of whether the
    /// manifest otherwise parses cleanly.
    ManifestDigestMismatch { expected: String, found: String },
    TooManyAssets { found: usize, max: usize },
    PackIdTooLong { found: usize, max: usize },
    ModelIdTooLong { found: usize, max: usize },
    RevisionTooLong { found: usize, max: usize },
    LicenseTooLong { found: usize, max: usize },
    InvalidAssetDigest { relative_path: String },
    AssetPathConfinement { relative_path: String, reason: PathConfinementError },
    AssetTooLarge { relative_path: String, found_bytes: u64, max_bytes: u64 },
    AssetMissing { relative_path: String },
    AssetIo { relative_path: String, reason: String },
    AssetSizeMismatch { relative_path: String, expected: u64, found: u64 },
    AssetDigestMismatch { relative_path: String, expected: String, found: String },
    /// The pack declares a protocol floor newer than the sidecar actually
    /// running it.
    SidecarProtocolTooOld { pack_requires: u32, sidecar_has: u32 },
}

fn hex_lower(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push_str(&format!("{b:02x}"));
    }
    s
}

/// SHA-256 of `bytes`, lowercase hex — same convention as
/// [`crate::sop_session::sha256_hex`].
pub fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex_lower(&hasher.finalize())
}

/// Parses and shape-validates a manifest's raw bytes (schema version,
/// bounded field lengths, well-formed per-asset digests/paths) without
/// touching any asset file on disk. Exposed separately from
/// [`verify_model_pack`] so callers that only need the parsed manifest
/// shape (e.g. to read `min_sidecar_protocol_version` before deciding
/// whether to even attempt a full verify) don't need a real pack
/// directory to do it.
pub fn parse_manifest(bytes: &[u8]) -> Result<ModelManifest, ModelPackError> {
    if bytes.len() > MAX_MANIFEST_BYTES {
        return Err(ModelPackError::ManifestTooLarge { found_bytes: bytes.len() as u64, max_bytes: MAX_MANIFEST_BYTES });
    }
    let manifest: ModelManifest = serde_json::from_slice(bytes).map_err(|e| ModelPackError::ManifestParse(e.to_string()))?;
    if manifest.schema_version != MODEL_PACK_MANIFEST_SCHEMA_VERSION {
        return Err(ModelPackError::UnsupportedManifestSchemaVersion {
            found: manifest.schema_version,
            max_supported: MODEL_PACK_MANIFEST_SCHEMA_VERSION,
        });
    }
    if manifest.pack_id.len() > MAX_PACK_ID_LEN {
        return Err(ModelPackError::PackIdTooLong { found: manifest.pack_id.len(), max: MAX_PACK_ID_LEN });
    }
    if manifest.assets.len() > MAX_ASSETS_PER_MANIFEST {
        return Err(ModelPackError::TooManyAssets { found: manifest.assets.len(), max: MAX_ASSETS_PER_MANIFEST });
    }
    for asset in &manifest.assets {
        if asset.model_id.len() > MAX_MODEL_ID_LEN {
            return Err(ModelPackError::ModelIdTooLong { found: asset.model_id.len(), max: MAX_MODEL_ID_LEN });
        }
        if asset.revision.len() > MAX_REVISION_LEN {
            return Err(ModelPackError::RevisionTooLong { found: asset.revision.len(), max: MAX_REVISION_LEN });
        }
        if asset.license.len() > MAX_LICENSE_LEN {
            return Err(ModelPackError::LicenseTooLong { found: asset.license.len(), max: MAX_LICENSE_LEN });
        }
        if !is_valid_sha256_hex(&asset.sha256) {
            return Err(ModelPackError::InvalidAssetDigest { relative_path: asset.relative_path.clone() });
        }
        confine_relative_path(&asset.relative_path)
            .map_err(|reason| ModelPackError::AssetPathConfinement { relative_path: asset.relative_path.clone(), reason })?;
        if asset.byte_len > MAX_ASSET_BYTES {
            return Err(ModelPackError::AssetTooLarge {
                relative_path: asset.relative_path.clone(),
                found_bytes: asset.byte_len,
                max_bytes: MAX_ASSET_BYTES,
            });
        }
    }
    Ok(manifest)
}

/// The full gate: reads `pack_dir/manifest.json`, confirms its bytes hash
/// to exactly `expected_manifest_sha256`, parses/shape-validates it, then
/// reads and hashes every declared asset file and confirms each one
/// matches its declared size and digest exactly. Returns the verified
/// manifest only when every one of those checks passes — any single
/// mismatch, missing file, or oversized asset fails the whole pack
/// closed; there is no partial-pack success.
pub fn verify_model_pack(pack_dir: &Path, expected_manifest_sha256: &str, sidecar_protocol_version: u32) -> Result<ModelManifest, ModelPackError> {
    let manifest_path = pack_dir.join("manifest.json");
    let manifest_bytes = std::fs::read(&manifest_path).map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            ModelPackError::ManifestMissing
        } else {
            ModelPackError::ManifestIo(e.to_string())
        }
    })?;
    let found_manifest_digest = sha256_hex(&manifest_bytes);
    if !found_manifest_digest.eq_ignore_ascii_case(expected_manifest_sha256) {
        return Err(ModelPackError::ManifestDigestMismatch {
            expected: expected_manifest_sha256.to_string(),
            found: found_manifest_digest,
        });
    }

    let manifest = parse_manifest(&manifest_bytes)?;

    if manifest.min_sidecar_protocol_version > sidecar_protocol_version {
        return Err(ModelPackError::SidecarProtocolTooOld {
            pack_requires: manifest.min_sidecar_protocol_version,
            sidecar_has: sidecar_protocol_version,
        });
    }

    for asset in &manifest.assets {
        // `confine_relative_path` already ran in `parse_manifest`; this
        // is the filesystem half (symlink defeat is intentionally out of
        // scope here, same division [`crate::sop_ipc`]'s own doc comment
        // draws for IPC bounded paths — a verified-read-only model pack
        // directory the app itself installed is a materially different
        // threat model than an IPC path from an untrusted caller, and a
        // follow-up install-time slice, not this one, owns hardening
        // that directory against a planted symlink).
        let asset_path = pack_dir.join(&asset.relative_path);
        let bytes = std::fs::read(&asset_path).map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                ModelPackError::AssetMissing { relative_path: asset.relative_path.clone() }
            } else {
                ModelPackError::AssetIo { relative_path: asset.relative_path.clone(), reason: e.to_string() }
            }
        })?;
        if bytes.len() as u64 > MAX_ASSET_BYTES {
            return Err(ModelPackError::AssetTooLarge {
                relative_path: asset.relative_path.clone(),
                found_bytes: bytes.len() as u64,
                max_bytes: MAX_ASSET_BYTES,
            });
        }
        if bytes.len() as u64 != asset.byte_len {
            return Err(ModelPackError::AssetSizeMismatch {
                relative_path: asset.relative_path.clone(),
                expected: asset.byte_len,
                found: bytes.len() as u64,
            });
        }
        let found_digest = sha256_hex(&bytes);
        if !found_digest.eq_ignore_ascii_case(&asset.sha256) {
            return Err(ModelPackError::AssetDigestMismatch {
                relative_path: asset.relative_path.clone(),
                expected: asset.sha256.clone(),
                found: found_digest,
            });
        }
    }

    Ok(manifest)
}

/// Resolves and returns the verified, confined absolute path to a named
/// asset from an already-[`verify_model_pack`]ed manifest. Callers (the
/// sidecar's model loader) use this instead of hand-building
/// `pack_dir.join(relative_path)` themselves, so there is exactly one
/// place that turns a manifest-declared relative path into a real
/// filesystem path.
pub fn resolve_asset_path(pack_dir: &Path, manifest: &ModelManifest, relative_path: &str) -> Option<std::path::PathBuf> {
    manifest.assets.iter().find(|a| a.relative_path == relative_path).map(|_| pack_dir.join(relative_path))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("forge-model-pack-test-{}-{}", std::process::id(), rand_suffix()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn rand_suffix() -> u64 {
        use std::time::{SystemTime, UNIX_EPOCH};
        SystemTime::now().duration_since(UNIX_EPOCH).unwrap().subsec_nanos() as u64
    }

    fn write_pack(dir: &Path, asset_bytes: &[u8]) -> (ModelManifest, String) {
        let asset_sha = sha256_hex(asset_bytes);
        std::fs::write(dir.join("model.onnx"), asset_bytes).unwrap();
        let manifest = ModelManifest {
            schema_version: MODEL_PACK_MANIFEST_SCHEMA_VERSION,
            pack_id: "test-pack-v1".to_string(),
            assets: vec![ModelAsset {
                relative_path: "model.onnx".to_string(),
                sha256: asset_sha,
                byte_len: asset_bytes.len() as u64,
                model_id: "test-model".to_string(),
                revision: "rev-1".to_string(),
                license: "Apache-2.0".to_string(),
            }],
            min_sidecar_protocol_version: 1,
        };
        let manifest_bytes = serde_json::to_vec(&manifest).unwrap();
        std::fs::write(dir.join("manifest.json"), &manifest_bytes).unwrap();
        let manifest_digest = sha256_hex(&manifest_bytes);
        (manifest, manifest_digest)
    }

    #[test]
    fn verify_model_pack_accepts_a_well_formed_matching_pack() {
        let dir = temp_dir();
        let (manifest, digest) = write_pack(&dir, b"fake onnx bytes");
        let verified = verify_model_pack(&dir, &digest, 1).unwrap();
        assert_eq!(verified, manifest);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn verify_model_pack_fails_closed_on_a_missing_manifest() {
        let dir = temp_dir();
        let result = verify_model_pack(&dir, &"a".repeat(64), 1);
        assert_eq!(result, Err(ModelPackError::ManifestMissing));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn verify_model_pack_fails_closed_when_the_manifest_digest_does_not_match_the_expectation() {
        let dir = temp_dir();
        let (_, _digest) = write_pack(&dir, b"fake onnx bytes");
        let wrong_expected = "b".repeat(64);
        let result = verify_model_pack(&dir, &wrong_expected, 1);
        assert!(matches!(result, Err(ModelPackError::ManifestDigestMismatch { .. })), "{result:?}");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn verify_model_pack_fails_closed_on_a_tampered_manifest_after_hashing() {
        // Edits the manifest file's bytes post-hash (simulating tampering
        // between the digest being recorded and the file being read) —
        // the recomputed digest of the *current* bytes must disagree with
        // the caller's expectation, not the stale pre-edit one.
        let dir = temp_dir();
        let (_, digest) = write_pack(&dir, b"fake onnx bytes");
        let mut tampered = std::fs::read(dir.join("manifest.json")).unwrap();
        tampered.push(b' ');
        std::fs::write(dir.join("manifest.json"), &tampered).unwrap();
        let result = verify_model_pack(&dir, &digest, 1);
        assert!(matches!(result, Err(ModelPackError::ManifestDigestMismatch { .. })), "{result:?}");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn verify_model_pack_fails_closed_on_a_missing_asset_file() {
        let dir = temp_dir();
        let (_, digest) = write_pack(&dir, b"fake onnx bytes");
        std::fs::remove_file(dir.join("model.onnx")).unwrap();
        let result = verify_model_pack(&dir, &digest, 1);
        assert_eq!(result, Err(ModelPackError::AssetMissing { relative_path: "model.onnx".to_string() }));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn verify_model_pack_fails_closed_on_a_corrupted_asset_with_a_wrong_hash() {
        let dir = temp_dir();
        let (_, digest) = write_pack(&dir, b"fake onnx bytes");
        // Same length as "fake onnx bytes" (15 bytes) so the size check
        // does not fire first - this exercises the digest check
        // specifically (see the size-mismatch test below for that path).
        std::fs::write(dir.join("model.onnx"), b"corrupted bytes").unwrap();
        let result = verify_model_pack(&dir, &digest, 1);
        assert!(matches!(result, Err(ModelPackError::AssetDigestMismatch { .. })), "{result:?}");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn verify_model_pack_fails_closed_on_an_asset_whose_size_no_longer_matches() {
        let dir = temp_dir();
        let (_, digest) = write_pack(&dir, b"fake onnx bytes");
        // Same-length-defeating edit: overwrite with different bytes of a
        // *different* length so the size check itself is exercised
        // (the digest check above already covers same-length corruption).
        std::fs::write(dir.join("model.onnx"), b"short").unwrap();
        let result = verify_model_pack(&dir, &digest, 1);
        assert!(matches!(result, Err(ModelPackError::AssetSizeMismatch { .. })), "{result:?}");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn verify_model_pack_refuses_a_newer_manifest_schema_version() {
        let dir = temp_dir();
        let (manifest, _) = write_pack(&dir, b"fake onnx bytes");
        let mut newer = manifest;
        newer.schema_version = MODEL_PACK_MANIFEST_SCHEMA_VERSION + 1;
        let bytes = serde_json::to_vec(&newer).unwrap();
        std::fs::write(dir.join("manifest.json"), &bytes).unwrap();
        let digest = sha256_hex(&bytes);
        let result = verify_model_pack(&dir, &digest, 1);
        assert!(matches!(result, Err(ModelPackError::UnsupportedManifestSchemaVersion { .. })), "{result:?}");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn verify_model_pack_refuses_a_pack_whose_protocol_floor_exceeds_the_running_sidecar() {
        let dir = temp_dir();
        let (manifest, _) = write_pack(&dir, b"fake onnx bytes");
        let mut newer = manifest;
        newer.min_sidecar_protocol_version = 99;
        let bytes = serde_json::to_vec(&newer).unwrap();
        std::fs::write(dir.join("manifest.json"), &bytes).unwrap();
        let digest = sha256_hex(&bytes);
        let result = verify_model_pack(&dir, &digest, 1);
        assert_eq!(result, Err(ModelPackError::SidecarProtocolTooOld { pack_requires: 99, sidecar_has: 1 }));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn parse_manifest_rejects_a_path_traversal_asset_path() {
        let manifest = ModelManifest {
            schema_version: MODEL_PACK_MANIFEST_SCHEMA_VERSION,
            pack_id: "p".to_string(),
            assets: vec![ModelAsset {
                relative_path: "../escape.onnx".to_string(),
                sha256: "a".repeat(64),
                byte_len: 3,
                model_id: "m".to_string(),
                revision: "r".to_string(),
                license: "MIT".to_string(),
            }],
            min_sidecar_protocol_version: 1,
        };
        let bytes = serde_json::to_vec(&manifest).unwrap();
        let result = parse_manifest(&bytes);
        assert!(matches!(result, Err(ModelPackError::AssetPathConfinement { .. })), "{result:?}");
    }

    #[test]
    fn parse_manifest_rejects_a_malformed_asset_digest() {
        let manifest = ModelManifest {
            schema_version: MODEL_PACK_MANIFEST_SCHEMA_VERSION,
            pack_id: "p".to_string(),
            assets: vec![ModelAsset {
                relative_path: "a.onnx".to_string(),
                sha256: "not-hex".to_string(),
                byte_len: 3,
                model_id: "m".to_string(),
                revision: "r".to_string(),
                license: "MIT".to_string(),
            }],
            min_sidecar_protocol_version: 1,
        };
        let bytes = serde_json::to_vec(&manifest).unwrap();
        let result = parse_manifest(&bytes);
        assert!(matches!(result, Err(ModelPackError::InvalidAssetDigest { .. })), "{result:?}");
    }

    #[test]
    fn parse_manifest_rejects_an_oversized_manifest() {
        let huge = vec![b' '; MAX_MANIFEST_BYTES + 1];
        let result = parse_manifest(&huge);
        assert!(matches!(result, Err(ModelPackError::ManifestTooLarge { .. })), "{result:?}");
    }

    #[test]
    fn parse_manifest_rejects_an_unknown_field() {
        let json = serde_json::json!({
            "schemaVersion": 1,
            "packId": "p",
            "assets": [],
            "minSidecarProtocolVersion": 1,
            "unexpectedField": "surprise",
        });
        let result: Result<ModelManifest, _> = serde_json::from_value(json);
        assert!(result.is_err());
    }

    #[test]
    fn resolve_asset_path_finds_a_declared_asset() {
        let dir = temp_dir();
        let (manifest, _) = write_pack(&dir, b"fake onnx bytes");
        let resolved = resolve_asset_path(&dir, &manifest, "model.onnx").unwrap();
        assert_eq!(resolved, dir.join("model.onnx"));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn resolve_asset_path_returns_none_for_an_undeclared_name() {
        let dir = temp_dir();
        let (manifest, _) = write_pack(&dir, b"fake onnx bytes");
        assert!(resolve_asset_path(&dir, &manifest, "not-declared.onnx").is_none());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn sha256_hex_is_stable_and_case_sensitive_lowercase() {
        let digest = sha256_hex(b"hello world");
        assert_eq!(digest.len(), 64);
        assert!(digest.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));
    }
}
