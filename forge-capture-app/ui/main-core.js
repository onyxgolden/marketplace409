// FORGE Capture — main window pure logic (ui/main-core.js).
//
// Framework-neutral, DOM-free pure logic for the main capture window. Runs
// unmodified under vitest (node) and in the Tauri webview; main.js owns the
// DOM/IPC. Mirrors the overlay.js / overlay-core.js split already used for
// the region picker.

/** The status-bar text/kind for a capture failure, from either the
 * capture-failed event's payload (a plain string) or a rejected invoke()
 * (a string, an Error, or occasionally something stranger). */
export function formatCaptureFailedStatus(reason) {
  const text = reason === undefined || reason === null || reason === "" ? "unknown error" : String(reason);
  return { text: `Capture failed: ${text}`, kind: "error" };
}

/** A data: URL for displaying a capture's bytes in an <img>, from the same
 * base64 + MIME payload shape get_capture_upload_payload/get_capture_preview_payload
 * both return. Pure string construction — no DOM, no fetch. */
export function previewDataUrl(payload) {
  if (!payload || typeof payload.bytes_b64 !== "string" || typeof payload.mime !== "string") {
    return null;
  }
  return `data:${payload.mime};base64,${payload.bytes_b64}`;
}
