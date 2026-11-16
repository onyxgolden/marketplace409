// FORGE Capture — PPTX-to-video Slice 1 backend (app/src/pptx_video.rs).
//
// The webview does the parsing and rendering (Pagus in JS, DOM-free cores
// under ui/pptx-*-core.js); this module only stores bytes, verifies
// fingerprints, and enforces path containment. It never opens a deck, never
// decodes media, never executes anything from a deck, and never touches the
// network.
//
// Layout under the Capture data root (same base as `captures_dir()`):
//   <base>/PptxVideos/<project-id>/source.pptx        — the uploaded deck
//   <base>/PptxVideos/<project-id>/project.json       — PptxVideoProjectV1
//   <base>/PptxVideos/<project-id>/thumbs/slide-0001.svg — slide thumbnails
//
// Uploads are chunked like the Rung 4 media upload (`begin_media_upload`):
// begin → append (in-order, no gaps) → finish (verify + atomic write).
// A failed finish leaves no project directory behind; a cancelled upload
// leaves nothing on disk at all.
//
// Manifests are written temp-then-rename, so a crash mid-write can never
// leave a partial project.json under its final name. Deletes remove only
// the project's own folder (canonicalized + containment-checked first);
// the user's original deck file is never touched.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::State;

use crate::AppState;

/// Hard cap per deck upload: 100 MB (matches the JS import cap).
pub const MAX_PPTX_UPLOAD_BYTES: u64 = 100 * 1024 * 1024;

/// Hard cap per thumbnail: 10 MB (SVG or PNG).
pub const MAX_THUMB_BYTES: usize = 10 * 1024 * 1024;

/// PptxVideoProjectV1 schema marker (must match ui/pptx-project-core.js).
pub const PPTX_VIDEO_SCHEMA: &str = "PptxVideoProjectV1";

/// One in-flight chunked deck upload. Mirrors `MediaUpload` in main.rs:
/// the webview holds the file bytes; the backend reassembles and writes.
pub struct PptxUpload {
    expected_bytes: u64,
    file_name: String,
    received: Vec<u8>,
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/// Capture data root: `%LOCALAPPDATA%/FORGE Capture` (Windows) or
/// `~/.local/share/forge-capture` (other). Same base as `captures_dir()`.
fn data_root() -> Result<std::path::PathBuf, String> {
    #[cfg(windows)]
    let base = std::env::var("LOCALAPPDATA")
        .map(std::path::PathBuf::from)
        .map_err(|_| "LOCALAPPDATA is not set".to_string())?
        .join("FORGE Capture");
    #[cfg(not(windows))]
    let base = std::env::var("HOME")
        .map(std::path::PathBuf::from)
        .map_err(|_| "HOME is not set".to_string())?
        .join(".local/share/forge-capture");
    Ok(base)
}

/// Root of all PPTX video projects. Created on first use.
pub fn pptx_videos_root() -> Result<std::path::PathBuf, String> {
    let dir = data_root()?.join("PptxVideos");
    std::fs::create_dir_all(&dir).map_err(|e| format!("cannot create pptx videos dir: {e}"))?;
    Ok(dir)
}

/// Project ids are minted by the backend; validate the shape here (same
/// rule as `isValidProjectId` in ui/pptx-project-core.js). Anything else is
/// rejected before it can reach a path join.
pub fn is_valid_project_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        && id.chars().next().is_some_and(|c| c.is_ascii_alphanumeric())
}

/// Project directory for an id, after validating the id shape. Never
/// returns a path outside the projects root.
fn project_dir(project_id: &str) -> Result<std::path::PathBuf, String> {
    if !is_valid_project_id(project_id) {
        return Err(format!("invalid project id: {project_id}"));
    }
    Ok(pptx_videos_root()?.join(project_id))
}

/// Resolve `relative` under a project dir. The relative path is always
/// constructed by this module (never caller-supplied), so the containment
/// check is lexical: no `..` or empty segments, joined onto the
/// canonicalized project dir — the result cannot escape the folder.
fn project_path(project_id: &str, relative: &str) -> Result<std::path::PathBuf, String> {
    if relative.is_empty()
        || relative.split('/').any(|c| c.is_empty() || c == ".." || c == ".")
        || relative.contains('\\')
    {
        return Err("refusing a path outside the project folder".to_string());
    }
    let dir = project_dir(project_id)?;
    let canon_dir = dir
        .canonicalize()
        .map_err(|e| format!("cannot resolve project dir: {e}"))?;
    Ok(canon_dir.join(relative))
}

// ---------------------------------------------------------------------------
// Small pure helpers (unit-tested below)
// ---------------------------------------------------------------------------

/// SHA-256 of bytes, lowercase hex.
pub fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let digest = hasher.finalize();
    let mut out = String::with_capacity(64);
    for byte in digest {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

/// True when the bytes start with the ZIP local-file-header magic
/// (`PK\x03\x04`). A legacy binary .ppt starts with the OLE compound magic
/// `D0 CF 11 E0` and must be rejected, never stored.
pub fn looks_like_zip(bytes: &[u8]) -> bool {
    bytes.len() >= 4 && bytes[0..4] == [0x50, 0x4B, 0x03, 0x04]
}

/// True when the bytes start with the OLE compound magic — a legacy .ppt.
pub fn looks_like_legacy_ppt(bytes: &[u8]) -> bool {
    bytes.len() >= 8 && bytes[0..8] == [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]
}

/// True when the bytes start with the PNG signature.
pub fn looks_like_png(bytes: &[u8]) -> bool {
    bytes.len() >= 8 && bytes[0..8] == [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]
}

/// True when the bytes look like an SVG document (optional UTF-8 BOM,
/// optional whitespace, then `<svg`). Thumbnails are stored as SVG in
/// Slice 1 (see `pptx_video_save_thumb` for why PNG rasterization is
/// not used); PNG is accepted for forward compatibility.
pub fn looks_like_svg(bytes: &[u8]) -> bool {
    let mut start = 0;
    if bytes.len() >= 3 && bytes[0..3] == [0xEF, 0xBB, 0xBF] {
        start = 3;
    }
    let mut i = start;
    while i < bytes.len() && matches!(bytes[i], b' ' | b'\t' | b'\n' | b'\r') {
        i += 1;
    }
    bytes.len() >= i + 4 && bytes[i..i + 4] == *b"<svg"
}

/// Plain-words title validation: same rules as `validateProjectTitle` in
/// ui/pptx-project-core.js. Returns the error message, or None when valid.
pub fn validate_project_title(title: &str) -> Option<String> {
    let trimmed = title.trim();
    if trimmed.is_empty() {
        return Some("Give the project a name.".to_string());
    }
    if trimmed.chars().count() > 200 {
        return Some("Keep the name under 200 characters.".to_string());
    }
    if trimmed
        .chars()
        .any(|c| matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') || c.is_control())
    {
        return Some("The name cannot contain / \\ : * ? \" < > or |.".to_string());
    }
    None
}

/// Atomic write: temp file in the same directory, then rename. The caller
/// owns cleanup of the temp file on error paths that return early.
fn write_atomic(path: &std::path::Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "cannot write a file with no parent directory".to_string())?;
    std::fs::create_dir_all(parent).map_err(|e| format!("cannot create directory: {e}"))?;
    let temp = parent.join(format!(
        ".{}.tmp-{}",
        path.file_name().unwrap_or_default().to_string_lossy(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    ));
    if let Err(e) = std::fs::write(&temp, bytes) {
        let _ = std::fs::remove_file(&temp);
        return Err(format!("cannot write temp file: {e}"));
    }
    if let Err(e) = std::fs::rename(&temp, path) {
        let _ = std::fs::remove_file(&temp);
        return Err(format!("cannot finalize file: {e}"));
    }
    Ok(())
}

fn next_project_id(state: &State<AppState>) -> String {
    let mut counter = state.id_counter.lock().unwrap();
    *counter += 1;
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("pptx-{millis}-{counter}")
}

// ---------------------------------------------------------------------------
// DTOs (camelCase, matching the JS invoke payloads)
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BeginPptxUploadDto {
    file_name: String,
    total_bytes: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppendPptxChunkDto {
    upload_id: String,
    offset: u64,
    bytes: Vec<u8>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PptxVideoProjectDto {
    project_id: String,
    file_name: String,
    sha256: String,
    size_bytes: u64,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PptxVideoProjectSummaryDto {
    project_id: String,
    title: String,
    slide_count: u64,
    updated_at: String,
}

// ---------------------------------------------------------------------------
// Chunked upload commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn pptx_video_begin_upload(
    dto: BeginPptxUploadDto,
    state: State<AppState>,
) -> Result<String, String> {
    if dto.total_bytes == 0 || dto.total_bytes > MAX_PPTX_UPLOAD_BYTES {
        return Err(format!(
            "total_bytes {} is outside the allowed 1..{} range",
            dto.total_bytes, MAX_PPTX_UPLOAD_BYTES
        ));
    }
    if !dto.file_name.to_ascii_lowercase().ends_with(".pptx") {
        return Err(format!(
            "only .pptx files can be imported (got {})",
            dto.file_name
        ));
    }
    let id = next_project_id(&state);
    let mut uploads = state.pptx_uploads.lock().unwrap();
    uploads.insert(
        id.clone(),
        PptxUpload {
            expected_bytes: dto.total_bytes,
            file_name: dto.file_name,
            received: Vec::new(),
        },
    );
    Ok(id)
}

#[tauri::command]
pub fn pptx_video_append_chunk(
    dto: AppendPptxChunkDto,
    state: State<AppState>,
) -> Result<u64, String> {
    let mut uploads = state.pptx_uploads.lock().unwrap();
    let upload = uploads
        .get_mut(&dto.upload_id)
        .ok_or_else(|| format!("unknown upload id: {}", dto.upload_id))?;
    if dto.offset != upload.received.len() as u64 {
        return Err(format!(
            "chunk offset {} does not match received bytes {} — chunks must arrive in order with no gaps or duplicates",
            dto.offset,
            upload.received.len()
        ));
    }
    let new_len = upload.received.len() as u64 + dto.bytes.len() as u64;
    if new_len > upload.expected_bytes {
        return Err(format!(
            "upload would exceed declared total: {} > {}",
            new_len, upload.expected_bytes
        ));
    }
    upload.received.extend_from_slice(&dto.bytes);
    Ok(upload.received.len() as u64)
}

#[tauri::command]
pub fn pptx_video_cancel_upload(uploadId: String, state: State<AppState>) -> Result<(), String> {
    let mut uploads = state.pptx_uploads.lock().unwrap();
    uploads.remove(&uploadId);
    Ok(())
}

#[tauri::command]
pub fn pptx_video_finish_upload(
    uploadId: String,
    state: State<AppState>,
) -> Result<PptxVideoProjectDto, String> {
    let upload = {
        let mut uploads = state.pptx_uploads.lock().unwrap();
        uploads
            .remove(&uploadId)
            .ok_or_else(|| format!("unknown upload id: {uploadId}"))?
    };
    if upload.received.len() as u64 != upload.expected_bytes {
        return Err(format!(
            "incomplete upload: got {} of {} declared bytes",
            upload.received.len(),
            upload.expected_bytes
        ));
    }
    if looks_like_legacy_ppt(&upload.received) {
        return Err(
            "This is an old .ppt file, not a .pptx. Save it as .pptx in PowerPoint and try again."
                .to_string(),
        );
    }
    if !looks_like_zip(&upload.received) {
        return Err("This file is not a PowerPoint file — it does not start like a .pptx.".to_string());
    }
    // The upload id doubles as the project id (minted `pptx-<millis>-<n>`).
    let project_id = uploadId.clone();
    let dir = project_dir(&project_id)?;
    // Any failure after this point removes the directory: a failed finish
    // never leaves a partial project behind.
    let result = (|| -> Result<PptxVideoProjectDto, String> {
        std::fs::create_dir_all(&dir).map_err(|e| format!("cannot create project folder: {e}"))?;
        let sha256 = sha256_hex(&upload.received);
        let source_path = dir.join("source.pptx");
        write_atomic(&source_path, &upload.received)?;
        Ok(PptxVideoProjectDto {
            project_id,
            file_name: upload.file_name,
            sha256,
            size_bytes: upload.received.len() as u64,
        })
    })();
    if result.is_err() {
        let _ = std::fs::remove_dir_all(&dir);
    }
    result
}

// ---------------------------------------------------------------------------
// Project commands
// ---------------------------------------------------------------------------

/// Read and parse a project's manifest. Returns the raw JSON value so the
/// UI gets exactly what was stored.
fn read_manifest(project_id: &str) -> Result<serde_json::Value, String> {
    let path = project_path(project_id, "project.json")?;
    let text = std::fs::read_to_string(&path)
        .map_err(|e| format!("cannot read the project file: {e}"))?;
    serde_json::from_str(&text).map_err(|e| format!("the project file is not valid JSON: {e}"))?
}

/// Structural checks the backend enforces on any manifest it stores.
/// (The JS side runs the full `validateProjectManifest`; the backend
/// re-checks the safety-critical shape: schema, id match, fingerprint
/// format, non-empty slides with unique ids and boolean selections.)
fn check_manifest_shape(project_id: &str, manifest: &serde_json::Value) -> Result<(), String> {
    let schema = manifest
        .get("schemaVersion")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if schema != PPTX_VIDEO_SCHEMA {
        return Err(format!(
            "this project was made by a different version ({})",
            if schema.is_empty() { "unknown" } else { schema }
        ));
    }
    let id = manifest.get("id").and_then(|v| v.as_str()).unwrap_or("");
    if id != project_id {
        return Err("the project file does not belong to this project".to_string());
    }
    let sha = manifest
        .get("source")
        .and_then(|s| s.get("sha256"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if sha.len() != 64 || !sha.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("the source deck record has no valid file fingerprint".to_string());
    }
    let slides = manifest
        .get("slides")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "the project has no slides".to_string())?;
    if slides.is_empty() {
        return Err("the project has no slides".to_string());
    }
    let mut ids = std::collections::HashSet::new();
    for slide in slides {
        let slide_id = slide.get("id").and_then(|v| v.as_str()).unwrap_or("");
        if slide_id.is_empty() || !ids.insert(slide_id.to_string()) {
            return Err("the project has a slide with a missing or repeated id".to_string());
        }
        if !slide.get("selected").is_some_and(|v| v.is_boolean()) {
            return Err(format!("slide {slide_id} has no selection saved"));
        }
    }
    Ok(())
}

#[tauri::command]
pub fn pptx_video_list_projects() -> Result<Vec<PptxVideoProjectSummaryDto>, String> {
    let root = pptx_videos_root()?;
    let mut rows = Vec::new();
    let entries = match std::fs::read_dir(&root) {
        Ok(entries) => entries,
        Err(_) => return Ok(rows),
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if !is_valid_project_id(&name) {
            continue;
        }
        let manifest = match read_manifest(&name) {
            Ok(manifest) => manifest,
            Err(_) => continue, // a project without a readable manifest is skipped, never fatal
        };
        if check_manifest_shape(&name, &manifest).is_err() {
            continue;
        }
        let title = manifest
            .get("title")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let slide_count = manifest
            .get("slides")
            .and_then(|v| v.as_array())
            .map(|a| a.len() as u64)
            .unwrap_or(0);
        let updated_at = manifest
            .get("updatedAt")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        rows.push(PptxVideoProjectSummaryDto {
            project_id: name,
            title,
            slide_count,
            updated_at,
        });
    }
    rows.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(rows)
}

#[tauri::command]
pub fn pptx_video_get_project(projectId: String) -> Result<String, String> {
    let manifest = read_manifest(&projectId)?;
    check_manifest_shape(&projectId, &manifest)?;
    Ok(serde_json::to_string(&manifest).map_err(|e| format!("cannot serialize the project: {e}"))?)
}

#[tauri::command]
pub fn pptx_video_save_project(projectId: String, manifestJson: String) -> Result<(), String> {
    let manifest: serde_json::Value =
        serde_json::from_str(&manifestJson).map_err(|e| format!("the project is not valid JSON: {e}"))?;
    check_manifest_shape(&projectId, &manifest)?;
    // The manifest must describe the deck actually stored in this folder.
    let stored_sha = {
        let source_path = project_path(&projectId, "source.pptx")?;
        let bytes = std::fs::read(&source_path)
            .map_err(|e| format!("cannot read the stored deck: {e}"))?;
        sha256_hex(&bytes)
    };
    let claimed_sha = manifest
        .get("source")
        .and_then(|s| s.get("sha256"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if claimed_sha != stored_sha {
        return Err(
            "the project file does not match the stored deck — refusing to save".to_string(),
        );
    }
    let path = project_path(&projectId, "project.json")?;
    write_atomic(&path, manifestJson.as_bytes())
}

#[tauri::command]
pub fn pptx_video_save_thumb(
    projectId: String,
    slideIndex: u32,
    thumbBytes: Vec<u8>,
) -> Result<String, String> {
    // Thumbnails are the rendered SVGs themselves, not PNG rasters:
    // Pagus draws all slide text inside <foreignObject>, and Chromium
    // taints any canvas an SVG-with-foreignObject is drawn onto, so
    // `canvas.toBlob()` throws for every real slide. Storing the SVG
    // (which <img> displays directly, with no script execution) keeps
    // thumbnails faithful and local. PNG is accepted too, for forward
    // compatibility with a later raster path.
    if thumbBytes.len() > MAX_THUMB_BYTES {
        return Err(format!(
            "thumbnail is {} bytes, over the {} byte cap",
            thumbBytes.len(),
            MAX_THUMB_BYTES
        ));
    }
    let extension = if looks_like_png(&thumbBytes) {
        "png"
    } else if looks_like_svg(&thumbBytes) {
        "svg"
    } else {
        return Err("thumbnail bytes are neither a PNG image nor an SVG document".to_string());
    };
    let relative = format!("thumbs/slide-{:04}.{extension}", slideIndex + 1);
    let path = project_path(&projectId, &relative)?;
    write_atomic(&path, &thumbBytes)?;
    Ok(sha256_hex(&thumbBytes))
}

/// Read one stored thumbnail back as bytes (the UI is served from a
/// static localhost server, so it cannot read project files by path).
/// Returned as a JSON number array, like the upload chunk bytes. The
/// thumbnail may be SVG or PNG; the caller picks the blob type from the
/// slide record's `thumbPath` extension.
#[tauri::command]
pub fn pptx_video_read_thumb(projectId: String, slideIndex: u32) -> Result<Vec<u8>, String> {
    for extension in ["svg", "png"] {
        let relative = format!("thumbs/slide-{:04}.{extension}", slideIndex + 1);
        let path = match project_path(&projectId, &relative) {
            Ok(path) => path,
            Err(e) => return Err(e),
        };
        if !path.exists() {
            continue;
        }
        let bytes = std::fs::read(&path).map_err(|e| format!("cannot read the thumbnail: {e}"))?;
        let ok = if extension == "svg" {
            looks_like_svg(&bytes)
        } else {
            looks_like_png(&bytes)
        };
        if !ok {
            return Err("the stored thumbnail is not a valid image".to_string());
        }
        return Ok(bytes);
    }
    Err("no thumbnail saved for that slide".to_string())
}

#[tauri::command]
pub fn pptx_video_rename_project(
    projectId: String,
    title: String,
) -> Result<PptxVideoProjectSummaryDto, String> {
    if let Some(error) = validate_project_title(&title) {
        return Err(error);
    }
    let mut manifest = read_manifest(&projectId)?;
    check_manifest_shape(&projectId, &manifest)?;
    let now = forge_capture_core::timestamp::now_utc_iso8601();
    manifest["title"] = serde_json::Value::String(title.trim().to_string());
    manifest["updatedAt"] = serde_json::Value::String(now.clone());
    if let Some(revision) = manifest.get("revision").and_then(|v| v.as_u64()) {
        manifest["revision"] = serde_json::Value::from(revision + 1);
    }
    if let Some(events) = manifest.get_mut("events").and_then(|v| v.as_array_mut()) {
        events.push(serde_json::json!({
            "at": now,
            "type": "renamed",
            "detail": format!("Renamed to “{}”.", title.trim()),
        }));
    }
    let text = serde_json::to_string(&manifest).map_err(|e| format!("cannot serialize the project: {e}"))?;
    let path = project_path(&projectId, "project.json")?;
    write_atomic(&path, text.as_bytes())?;
    let slide_count = manifest
        .get("slides")
        .and_then(|v| v.as_array())
        .map(|a| a.len() as u64)
        .unwrap_or(0);
    Ok(PptxVideoProjectSummaryDto {
        project_id: projectId,
        title: title.trim().to_string(),
        slide_count,
        updated_at: now,
    })
}

#[tauri::command]
pub fn pptx_video_delete_project(projectId: String) -> Result<(), String> {
    let dir = project_dir(&projectId)?;
    // Canonicalize both sides: the directory must really live under the
    // projects root (a symlink or `..` in the id cannot smuggle another
    // path in — the id validator already bars those, this is the belt).
    let root = pptx_videos_root()?;
    let canon_root = root
        .canonicalize()
        .map_err(|e| format!("cannot resolve the projects folder: {e}"))?;
    let canon_dir = match dir.canonicalize() {
        Ok(path) => path,
        Err(_) => return Ok(()), // nothing on disk: already gone
    };
    if !canon_dir.starts_with(&canon_root) {
        return Err("refusing to delete a folder outside the projects folder".to_string());
    }
    if canon_dir == canon_root {
        return Err("refusing to delete the projects folder itself".to_string());
    }
    std::fs::remove_dir_all(&canon_dir).map_err(|e| format!("cannot delete the project: {e}"))?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Tests (pure helpers only — no Tauri state, no disk writes outside temp)
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sha256_hex_matches_the_known_empty_digest() {
        assert_eq!(
            sha256_hex(&[]),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    #[test]
    fn zip_and_legacy_ppt_magic_are_told_apart() {
        assert!(looks_like_zip(b"PK\x03\x04rest of a zip"));
        assert!(!looks_like_zip(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"));
        assert!(looks_like_legacy_ppt(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"));
        assert!(!looks_like_legacy_ppt(b"PK\x03\x04rest of a zip"));
        assert!(!looks_like_zip(b"PK"));
        assert!(!looks_like_legacy_ppt(b"short"));
    }

    #[test]
    fn png_and_svg_magic_checks() {
        assert!(looks_like_png(b"\x89PNG\r\n\x1a\nrest"));
        assert!(!looks_like_png(b"\xff\xd8\xff\xe0jpeg"));
        assert!(!looks_like_png(b"short"));
        assert!(looks_like_svg(b"<svg xmlns=\"http://www.w3.org/2000/svg\">"));
        assert!(looks_like_svg(b"\xef\xbb\xbf\n  <svg>"));
        assert!(!looks_like_svg(b"<html>"));
        assert!(!looks_like_svg(b"short"));
    }

    #[test]
    fn project_id_validation_bars_escapes() {
        assert!(is_valid_project_id("pptx-123-4"));
        assert!(is_valid_project_id("a"));
        assert!(!is_valid_project_id(""));
        assert!(!is_valid_project_id("../escape"));
        assert!(!is_valid_project_id("a/b"));
        assert!(!is_valid_project_id("-leading-dash"));
        assert!(!is_valid_project_id("has space"));
        assert!(!is_valid_project_id(&"x".repeat(65)));
    }

    #[test]
    fn title_validation_matches_the_js_rules() {
        assert_eq!(validate_project_title("My deck"), None);
        assert_eq!(
            validate_project_title("   "),
            Some("Give the project a name.".to_string())
        );
        assert_eq!(
            validate_project_title("a/b"),
            Some("The name cannot contain / \\ : * ? \" < > or |.".to_string())
        );
        assert_eq!(
            validate_project_title(&"x".repeat(201)),
            Some("Keep the name under 200 characters.".to_string())
        );
    }

    #[test]
    fn manifest_shape_checks_catch_the_bad_cases() {
        let good = serde_json::json!({
            "schemaVersion": "PptxVideoProjectV1",
            "id": "pptx-1",
            "title": "Deck",
            "source": { "sha256": "aa".repeat(32) },
            "slides": [
                { "id": "slide-1", "selected": true },
                { "id": "slide-2", "selected": false },
            ],
        });
        assert!(check_manifest_shape("pptx-1", &good).is_ok());
        let wrong_version = serde_json::json!({ "schemaVersion": "V2", "id": "pptx-1" });
        assert!(check_manifest_shape("pptx-1", &wrong_version).is_err());
        let wrong_id = serde_json::json!({
            "schemaVersion": "PptxVideoProjectV1", "id": "pptx-2",
            "source": { "sha256": "aa".repeat(32) },
            "slides": [{ "id": "slide-1", "selected": true }],
        });
        assert!(check_manifest_shape("pptx-1", &wrong_id).is_err());
        let bad_sha = serde_json::json!({
            "schemaVersion": "PptxVideoProjectV1", "id": "pptx-1",
            "source": { "sha256": "not-a-sha" },
            "slides": [{ "id": "slide-1", "selected": true }],
        });
        assert!(check_manifest_shape("pptx-1", &bad_sha).is_err());
        let dup_slide = serde_json::json!({
            "schemaVersion": "PptxVideoProjectV1", "id": "pptx-1",
            "source": { "sha256": "aa".repeat(32) },
            "slides": [
                { "id": "slide-1", "selected": true },
                { "id": "slide-1", "selected": true },
            ],
        });
        assert!(check_manifest_shape("pptx-1", &dup_slide).is_err());
        let no_selection = serde_json::json!({
            "schemaVersion": "PptxVideoProjectV1", "id": "pptx-1",
            "source": { "sha256": "aa".repeat(32) },
            "slides": [{ "id": "slide-1" }],
        });
        assert!(check_manifest_shape("pptx-1", &no_selection).is_err());
    }

    #[test]
    fn atomic_write_round_trips() {
        let dir = std::env::temp_dir().join(format!(
            "pptx-video-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let path = dir.join("project.json");
        write_atomic(&path, b"{\"a\":1}").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "{\"a\":1}");
        write_atomic(&path, b"{\"a\":2}").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "{\"a\":2}");
        assert!(std::fs::read_dir(&dir)
            .unwrap()
            .all(|e| !e.unwrap().file_name().to_string_lossy().contains(".tmp-")));
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
