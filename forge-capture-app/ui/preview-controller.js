// Capture preview controller (ui/preview-controller.js, ES module).
//
// One capture-bound preview state machine with generation guards on every
// async completion, close invalidation, and deduplication of event/direct
// opens. The controller owns: which capture's metadata is shown, which
// capture's image bytes are displayed, and which capture the action buttons
// (Copy / AI Edit / Save as) target. Those three can never disagree.
//
// Design rules (from PR #639 review findings):
// - Every async step captures the generation at start and re-checks it
//   after every await. A stale completion is dropped silently.
// - close() bumps the generation: a pending load can never reopen the
//   dialog or paint a stale image after close.
// - Actions are disabled until the image for the CURRENT capture has
//   actually decoded. They target displayedId, never a newer metadata id.
// - Display errors (empty payload, decode failure, IPC failure) go to the
//   status line. Capture warnings (e.g. solid-color frame) go to the
//   separate warnings line and never overwrite a display error.
// - The preview loads through get_capture_preview_payload, the bounded
//   LOCAL display path — never get_capture_upload_payload, whose 25MB cap
//   is a server-upload policy.

/**
 * @param {object} deps
 * @param {(cmd: string, args: object) => Promise<any>} deps.invoke
 * @param {object} deps.els - { meta, status, warnings, image }
 * @param {object} deps.dialog - { show(), close(), isOpen() }
 * @param {(img: HTMLImageElement, src: string, isCurrent: () => boolean) => Promise<void>} deps.loadImage
 *   Resolves when the image decodes; rejects on decode error. The
 *   isCurrent callback lets the loader abandon work for a stale
 *   generation. Production wires img onload/onerror; tests inject fakes.
 * @param {object} deps.actions - { copy(id), saveAs(id), edit(id) } thunks
 *   invoked by the UI buttons; the controller passes displayedId.
 */
export function createPreviewController(deps) {
  const { invoke, els, dialog, loadImage, actions } = deps;

  let generation = 0;
  /** Id whose image bytes are actually on screen, or null. */
  let displayedId = null;
  /** Id of the most recent open() call still in flight, or null. */
  let pendingId = null;

  function setStatus(text, kind) {
    els.status.textContent = text;
    els.status.className = "status" + (kind ? " " + kind : "");
  }

  function setWarnings(text) {
    els.warnings.textContent = text;
    els.warnings.className = "status warning";
    els.warnings.hidden = !text;
  }

  function setActionsEnabled(on) {
    for (const btn of actions.buttons) btn.disabled = !on;
  }

  function metaText(ref) {
    return `${ref.kind} — ${ref.width}×${ref.height} — ${ref.png_path || ""}`;
  }

  async function open(ref) {
    if (!ref || !ref.id) return;
    // Dedup: an event open and a direct-return open for the same capture
    // must not start two loads. If this exact capture is already displayed
    // (or already loading), there is nothing to do.
    if (ref.id === displayedId || ref.id === pendingId) return;

    const gen = ++generation;
    pendingId = ref.id;
    displayedId = null;

    els.meta.textContent = metaText(ref);
    setStatus("Loading preview…", "");
    setWarnings("");
    // Clear stale imagery immediately: until the new image decodes, the
    // dialog must not show the previous capture's pixels.
    els.image.removeAttribute("src");
    setActionsEnabled(false);
    if (!dialog.isOpen()) dialog.show();

    let payload;
    try {
      payload = await invoke("get_capture_preview_payload", { id: ref.id });
    } catch (e) {
      if (gen !== generation) return;
      pendingId = null;
      setStatus(`Could not load preview image: ${e}`, "error");
      return;
    }
    if (gen !== generation) return;

    const b64 = payload && payload.bytes_b64;
    if (typeof b64 !== "string" || b64.length === 0) {
      pendingId = null;
      setStatus("Preview failed: the capture has no image data.", "error");
      return;
    }

    const src = `data:${payload.mime || "image/png"};base64,${b64}`;
    try {
      await loadImage(els.image, src, () => gen === generation);
    } catch (e) {
      if (gen !== generation) return;
      pendingId = null;
      setStatus("Preview failed: the image could not be decoded.", "error");
      return;
    }
    if (gen !== generation) return;

    // The image on screen is now THIS capture's. Bind actions to it.
    pendingId = null;
    displayedId = ref.id;
    setActionsEnabled(true);
    setStatus("Preview loaded.", "ok");

    // Capture warnings are best-effort and live on their own line so a
    // delayed sidecar can never overwrite a display error above.
    try {
      const sidecar = JSON.parse(await invoke("get_sidecar", { id: ref.id }));
      if (gen !== generation) return;
      const warnings = (sidecar && sidecar.warnings) || [];
      if (warnings.length > 0) setWarnings(`Warning: ${warnings.join("; ")}`);
    } catch {
      /* warnings are advisory; the image is what matters */
    }
  }

  function close() {
    // Invalidate every in-flight load: a late payload/decode/sidecar
    // completion after close is dropped by its generation check.
    generation++;
    pendingId = null;
    displayedId = null;
    setActionsEnabled(false);
    dialog.close();
  }

  /** The id the action buttons currently target, or null. */
  function targetId() {
    return displayedId;
  }

  return { open, close, targetId };
}
