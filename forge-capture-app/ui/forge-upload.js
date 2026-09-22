// FORGE Capture Rung 5 — "Save to FORGE" client.
//
// Opt-in cloud destination for captures. Local-first is unchanged: nothing in
// this module touches the network unless the user explicitly presses
// "Save to FORGE". There are no background uploads and no silent retries —
// every upload is a single user-initiated POST, and a failure only retries
// when the user presses Retry (the retry reuses the same captureId, so the
// server returns the existing artifact instead of duplicating it).
//
// Session handling (ChatGPT required change): the Supabase session lives in
// the OS credential store (Windows Credential Manager / macOS Keychain /
// Linux Secret Service) via the `forge_session_*` Tauri commands — never in
// a plaintext config file. Fail closed: no stored session → the button reads
// "Sign in to FORGE" and does nothing except open the connect dialog; it
// must never attempt an upload.
//
// Sign-in design (documented choice): the app performs the Supabase Auth
// email/password exchange itself, directly against Supabase Auth REST — the
// password never touches FORGE servers. The public Supabase URL + anon key
// come from GET /api/capture/config (both are public by design; they ship
// inside every browser bundle). The alternative considered — system-browser
// sign-in plus a pasted pairing code — needs a server-minted token scheme
// and new tables; the direct exchange needs neither.
//
// This file is an ES module: `ui/record.js` imports it, and the classic
// `ui/main.js` reaches it through `window.ForgeUpload` (module scripts run
// before DOMContentLoaded, so the namespace exists before any click).

export const DEFAULT_BASE_URL = "https://409marketplace.online";
const BASE_URL_STORAGE_KEY = "forge.baseUrl";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BYTES = 25 * 1024 * 1024;

export class ForgeUploadError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/// Production origin for the capture API. Overridable per-machine via
/// localStorage `forge.baseUrl` (handy for dev/staging).
export function resolveBaseUrl() {
  try {
    if (typeof localStorage !== "undefined") {
      const override = (localStorage.getItem(BASE_URL_STORAGE_KEY) || "").trim();
      if (/^https?:\/\//i.test(override)) return override.replace(/\/+$/, "");
    }
  } catch {
    /* storage unavailable — fall through to the default */
  }
  return DEFAULT_BASE_URL;
}

export function newCaptureId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  throw new ForgeUploadError("uuid", "This runtime cannot generate a capture id.");
}

export function isCaptureId(value) {
  return UUID_RE.test(String(value || "").trim());
}

/// Parses the opaque session JSON from the OS credential store. Returns null
/// when there is no usable session — the caller must treat that as
/// "not signed in" and never attempt an upload.
export function parseSession(json) {
  if (!json || typeof json !== "string") return null;
  try {
    const raw = JSON.parse(json);
    if (!raw || typeof raw.access_token !== "string" || !raw.access_token) return null;
    return {
      accessToken: raw.access_token,
      refreshToken: typeof raw.refresh_token === "string" ? raw.refresh_token : null,
      expiresAt: Number(raw.expires_at) || 0,
    };
  } catch {
    return null;
  }
}

export function isSessionExpired(session, nowSec = Date.now() / 1000) {
  if (!session) return true;
  if (!session.expiresAt) return false;
  return session.expiresAt <= nowSec + 30; // 30 s clock skew margin
}

async function fetchForgeConfig(baseUrl) {
  let res;
  try {
    res = await fetch(`${baseUrl}/api/capture/config`);
  } catch {
    throw new ForgeUploadError("network", "Could not reach FORGE. Check your connection.");
  }
  if (!res.ok) throw new ForgeUploadError("config", "FORGE did not return its connection settings.");
  return res.json();
}

function toSessionJson(data) {
  return JSON.stringify({
    access_token: data.access_token,
    refresh_token: data.refresh_token || null,
    expires_at: Math.floor(Date.now() / 1000) + (Number(data.expires_in) || 3600),
  });
}

/// Email/password sign-in directly against Supabase Auth. Stores the session
/// in the OS credential store on success.
export async function signInWithPassword({ invoke, baseUrl, email, password }) {
  const cleanEmail = String(email || "").trim();
  if (!cleanEmail || !password) {
    throw new ForgeUploadError("input", "Enter your FORGE email and password.");
  }
  const { supabaseUrl, supabaseAnonKey } = await fetchForgeConfig(baseUrl);
  let res;
  try {
    res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: supabaseAnonKey, "Content-Type": "application/json" },
      body: JSON.stringify({ email: cleanEmail, password }),
    });
  } catch {
    throw new ForgeUploadError("network", "Could not reach the sign-in service.");
  }
  if (!res.ok) {
    throw new ForgeUploadError("auth", "Sign-in failed. Check your email and password.");
  }
  const data = await res.json();
  if (!data || !data.access_token) throw new ForgeUploadError("auth", "Sign-in returned no session.");
  const sessionJson = toSessionJson(data);
  await invoke("forge_session_set", { sessionJson });
  return parseSession(sessionJson);
}

/// Refreshes an expired session when a refresh token is available. Clears a
/// dead session from the store so the UI falls back to the sign-in dialog.
export async function refreshSession({ invoke, baseUrl, session }) {
  if (!session || !session.refreshToken) {
    throw new ForgeUploadError("expired", "Session expired. Sign in to FORGE again.");
  }
  const { supabaseUrl, supabaseAnonKey } = await fetchForgeConfig(baseUrl);
  let res;
  try {
    res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { apikey: supabaseAnonKey, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: session.refreshToken }),
    });
  } catch {
    throw new ForgeUploadError("network", "Could not reach the sign-in service.");
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON body */
  }
  if (!res.ok || !data || !data.access_token) {
    try {
      await invoke("forge_session_clear");
    } catch {
      /* best effort */
    }
    throw new ForgeUploadError("expired", "Session expired. Sign in to FORGE again.");
  }
  const sessionJson = toSessionJson(data);
  await invoke("forge_session_set", { sessionJson });
  return parseSession(sessionJson);
}

/// Reads the session from the OS credential store, refreshing once when it
/// is expired. Returns null when there is no session — fail closed.
export async function getUsableSession({ invoke, baseUrl }) {
  let json = null;
  try {
    json = await invoke("forge_session_get");
  } catch {
    return null;
  }
  let session = parseSession(json);
  if (!session) return null;
  if (isSessionExpired(session)) {
    try {
      session = await refreshSession({ invoke, baseUrl, session });
    } catch {
      return null;
    }
  }
  return session;
}

export async function signOut(invoke) {
  try {
    await invoke("forge_session_clear");
  } catch {
    /* clearing is best effort; a missing store already means signed out */
  }
}

/// Builds the multipart upload body. Throws ForgeUploadError on any invalid
/// input — the caller surfaces the message and never sends the request.
export function buildUploadForm({ bytes, mime, kind, title, width, height, captureId, capturedAt }) {
  if (!isCaptureId(captureId)) throw new ForgeUploadError("input", "Capture id is missing.");
  const ext = { "image/png": "png", "image/jpeg": "jpg", "video/webm": "webm" }[mime];
  if (!ext) throw new ForgeUploadError("input", "This capture type cannot be saved to FORGE (PNG, JPEG, or WebM only).");
  const byteLength = bytes ? bytes.length || bytes.byteLength || bytes.size : 0;
  if (!byteLength) throw new ForgeUploadError("input", "Capture is empty.");
  if (byteLength > MAX_BYTES) throw new ForgeUploadError("input", "Capture exceeds the 25 MB FORGE limit.");
  const form = new FormData();
  form.set("captureId", captureId);
  form.set("kind", kind === "recording" ? "recording" : "screenshot");
  if (title) form.set("title", String(title).slice(0, 200));
  if (Number.isInteger(width) && width > 0) form.set("width", String(width));
  if (Number.isInteger(height) && height > 0) form.set("height", String(height));
  if (capturedAt) form.set("capturedAt", capturedAt);
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes], { type: mime });
  form.set("file", blob, `capture.${ext}`);
  return form;
}

/// One-shot upload. Exactly one POST per call — never retried here; the UI
/// only calls again when the user presses Retry, and the retry reuses the
/// same captureId so the server dedupes it.
export async function uploadCapture({ baseUrl, session, form, signal, onProgress }) {
  if (!session || !session.accessToken) {
    throw new ForgeUploadError("signin", "Sign in to FORGE before saving.");
  }
  let res;
  try {
    if (typeof onProgress === "function") onProgress(0);
    res = await fetch(`${baseUrl}/api/capture/upload`, {
      method: "POST",
      headers: { authorization: `Bearer ${session.accessToken}` },
      body: form,
      signal,
    });
  } catch (e) {
    if (e && e.name === "AbortError") throw new ForgeUploadError("cancelled", "Upload cancelled.");
    throw new ForgeUploadError("network", "Could not reach FORGE. Check your connection and retry.");
  }
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON error body */
  }
  if (!res.ok) {
    const message = (body && body.error) || "FORGE rejected the upload.";
    throw new ForgeUploadError(res.status === 401 ? "expired" : "rejected", message);
  }
  if (typeof onProgress === "function") onProgress(1);
  return { id: body.id, signedUrl: body.signedUrl, duplicate: !!body.duplicate };
}

export function libraryLink(baseUrl, captureId) {
  return `${baseUrl}/forge/capture?capture=${encodeURIComponent(captureId)}`;
}

// ---------------------------------------------------------------------------
// Interactive controller: connect dialog + per-item save flow.
//
// `wireForgeSave({ invoke, getButtonLabel })` is called once by the host page.
// `runForgeSave({ invoke, button, setStatus, getPayload, afterSave })` drives
// one item's button through: sign-in check → upload → done. Everything here
// requires a real DOM; the pure logic above stays DOM-free and unit-tested.

function requireDom() {
  if (typeof document === "undefined") throw new ForgeUploadError("dom", "No document.");
}

function dialogStyles() {
  return (
    "position:fixed;inset:0;display:flex;align-items:center;justify-content:center;" +
    "background:rgba(0,0,0,0.55);z-index:9999;"
  );
}

function panelStyles() {
  return (
    "background:#1e1e1e;color:#eee;border:1px solid #444;border-radius:8px;" +
    "padding:20px;min-width:320px;max-width:90vw;font:14px system-ui,sans-serif;"
  );
}

function inputStyles() {
  return "width:100%;box-sizing:border-box;margin:4px 0 10px;padding:8px;background:#111;color:#eee;border:1px solid #555;border-radius:4px;";
}

/**
 * Opens the "Connect FORGE account" dialog. On success stores the session in
 * the OS credential store and calls onSignedIn(). Never uploads anything.
 */
export function openConnectDialog({ invoke, baseUrl, onSignedIn, signedIn }) {
  requireDom();
  closeConnectDialog();
  const overlay = document.createElement("div");
  overlay.id = "forge-connect-dialog";
  overlay.setAttribute("style", dialogStyles());
  const panel = document.createElement("div");
  panel.setAttribute("style", panelStyles());

  const title = document.createElement("h3");
  title.textContent = "Connect FORGE account";
  title.setAttribute("style", "margin:0 0 4px;");
  const sub = document.createElement("div");
  sub.setAttribute("style", "color:#aaa;font-size:12px;margin-bottom:12px;");
  sub.textContent = signedIn
    ? "This device is connected. Your session is kept in the OS credential store — never in a file."
    : "Sign in once with your FORGE account. The session is kept in your OS credential store — never in a file — and is used only when you press “Save to FORGE”.";
  const err = document.createElement("div");
  err.setAttribute("style", "color:#ff7b72;min-height:18px;font-size:13px;margin-bottom:6px;");
  panel.append(title, sub, err);

  let emailInput = null;
  let passwordInput = null;
  if (!signedIn) {
    emailInput = document.createElement("input");
    emailInput.type = "email";
    emailInput.placeholder = "FORGE email";
    emailInput.autocomplete = "username";
    emailInput.setAttribute("style", inputStyles());
    passwordInput = document.createElement("input");
    passwordInput.type = "password";
    passwordInput.placeholder = "Password";
    passwordInput.autocomplete = "current-password";
    passwordInput.setAttribute("style", inputStyles());
    panel.append(emailInput, passwordInput);
  }

  const row = document.createElement("div");
  row.setAttribute("style", "display:flex;gap:8px;justify-content:flex-end;margin-top:8px;");
  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = "Cancel";
  cancelBtn.onclick = () => closeConnectDialog();
  row.append(cancelBtn);

  const busy = (on) => {
    [cancelBtn, actionBtn].forEach((b) => {
      if (b) b.disabled = on;
    });
  };

  let actionBtn;
  if (signedIn) {
    actionBtn = document.createElement("button");
    actionBtn.textContent = "Sign out";
    actionBtn.onclick = async () => {
      busy(true);
      await signOut(invoke);
      closeConnectDialog();
      if (typeof onSignedIn === "function") onSignedIn(false);
    };
    row.append(actionBtn);
  } else {
    actionBtn = document.createElement("button");
    actionBtn.textContent = "Sign in";
    actionBtn.onclick = async () => {
      err.textContent = "";
      busy(true);
      try {
        await signInWithPassword({ invoke, baseUrl, email: emailInput.value, password: passwordInput.value });
        closeConnectDialog();
        if (typeof onSignedIn === "function") onSignedIn(true);
      } catch (e) {
        err.textContent = e instanceof Error ? e.message : String(e);
        busy(false);
      }
    };
    row.append(actionBtn);
    passwordInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") actionBtn.click();
    });
  }

  panel.append(row);
  overlay.append(panel);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeConnectDialog();
  });
  document.body.append(overlay);
  if (emailInput) emailInput.focus();
}

export function closeConnectDialog() {
  if (typeof document === "undefined") return;
  document.getElementById("forge-connect-dialog")?.remove();
}

/**
 * One item's "Save to FORGE" flow.
 *
 * - getPayload: async () => ({ bytes, mime, kind, title, width, height, captureId })
 * - setStatus(text, kind): host status line ("", "ok", "error", "warning")
 * - afterSave({ id, duplicate }): host hook (e.g. add a "Copy link" button)
 *
 * Exactly one upload POST per invocation; failures never retry silently —
 * the user presses the button again (same captureId → server dedupes).
 */
export async function runForgeSave({ invoke, baseUrl, button, setStatus, getPayload, afterSave }) {
  requireDom();
  const setBtn = (label, disabled) => {
    button.textContent = label;
    button.disabled = !!disabled;
  };
  const fail = (message) => {
    setBtn("Save to FORGE", false);
    setStatus(message, "error");
  };

  // Fail closed: no session → offer sign-in, never upload.
  let session = await getUsableSession({ invoke, baseUrl });
  if (!session) {
    setBtn("Sign in to FORGE", false);
    openConnectDialog({
      invoke,
      baseUrl,
      signedIn: false,
      onSignedIn: (ok) => {
        setBtn(ok ? "Save to FORGE" : "Sign in to FORGE", false);
        if (ok) runForgeSave({ invoke, baseUrl, button, setStatus, getPayload, afterSave });
      },
    });
    setStatus("Sign in to FORGE to save this capture.", "");
    return;
  }

  let payload;
  try {
    payload = await getPayload();
  } catch (e) {
    fail(`Could not prepare the upload: ${e instanceof Error ? e.message : e}`);
    return;
  }

  let form;
  try {
    form = buildUploadForm(payload);
  } catch (e) {
    fail(e instanceof Error ? e.message : String(e));
    return;
  }

  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const originalOnClick = button.onclick;
  setBtn("Cancel", false);
  button.onclick = () => controller && controller.abort();
  setStatus("Uploading to FORGE…", "");

  try {
    const result = await uploadCapture({
      baseUrl,
      session,
      form,
      signal: controller ? controller.signal : undefined,
      onProgress: () => {},
    });
    setBtn("Saved ✓", true);
    button.onclick = null;
    setStatus(
      result.duplicate
        ? `Already in your FORGE library — id ${result.id}.`
        : `Saved to your FORGE library — id ${result.id}.`,
      "ok",
    );
    if (typeof afterSave === "function") afterSave(result);
  } catch (e) {
    if (e instanceof ForgeUploadError && (e.code === "expired" || e.code === "signin")) {
      // Session died mid-flight: offer sign-in, then let the user retry.
      setBtn("Sign in to FORGE", false);
      button.onclick = originalOnClick;
      setStatus("FORGE session expired. Sign in, then press the button again to retry.", "warning");
      openConnectDialog({
        invoke,
        baseUrl,
        signedIn: false,
        onSignedIn: (ok) => setBtn(ok ? "Save to FORGE" : "Sign in to FORGE", false),
      });
      return;
    }
    if (e instanceof ForgeUploadError && e.code === "cancelled") {
      setBtn("Save to FORGE", false);
      button.onclick = originalOnClick;
      setStatus("Upload cancelled.", "");
      return;
    }
    setBtn("Save to FORGE", false);
    button.onclick = originalOnClick;
    setStatus(e instanceof Error ? e.message : String(e), "error");
  }
}

// Namespace for the classic (non-module) ui/main.js.
if (typeof window !== "undefined") {
  window.ForgeUpload = {
    DEFAULT_BASE_URL,
    ForgeUploadError,
    resolveBaseUrl,
    newCaptureId,
    isCaptureId,
    parseSession,
    isSessionExpired,
    signInWithPassword,
    refreshSession,
    getUsableSession,
    signOut,
    buildUploadForm,
    uploadCapture,
    libraryLink,
    openConnectDialog,
    closeConnectDialog,
    runForgeSave,
  };
}
