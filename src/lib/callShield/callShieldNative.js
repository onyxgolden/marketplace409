// Call Shield native bridge (web side).
//
// When FORGE runs inside the Android companion shell, window.Capacitor
// exposes the CallShieldBridge plugin. On the plain web this module is inert:
// every function degrades to a clear "native-unavailable" error so the UI
// can explain that automatic call-log import needs the Android app.
//
// The native layer is deliberately thin: it only reads the call log (an OS
// API the browser can never reach). Normalizing, hashing, staging, and case
// association all happen in the web app through the normal API routes.

const PLUGIN_NAME = "CallShieldBridge";
const DEVICE_ID_KEY = "callShieldDeviceId";

export function isNativeShell() {
  if (typeof window === "undefined") return false;
  try {
    return !!window.Capacitor?.isNativePlatform?.();
  } catch {
    return false;
  }
}

function getPlugin() {
  const plugin = typeof window !== "undefined" ? window.Capacitor?.Plugins?.[PLUGIN_NAME] : null;
  if (!plugin) {
    throw new Error("Automatic call-log import needs the Call Shield Android app.");
  }
  return plugin;
}

/** Stable per-install device id (the plugin may also supply ANDROID_ID). */
export function getDeviceId() {
  if (typeof window === "undefined") return "unknown";
  try {
    let id = window.localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now());
      window.localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  } catch {
    return "unknown";
  }
}

/**
 * Read call records from the Android call log via the native plugin.
 * Returns [{ androidCallId, phoneNumber, callerName, startedAt (ISO),
 * durationSeconds, callType, deviceId }]. The plugin prompts for the
 * READ_CALL_LOG permission with an explanation on first use.
 */
export async function fetchNativeCallRecords({ days = 30 } = {}) {
  const plugin = getPlugin();
  const result = await plugin.getCallRecords({ days: Math.max(1, Math.min(90, days)) });
  const records = Array.isArray(result?.records) ? result.records : [];
  const deviceId = typeof result?.deviceId === "string" && result.deviceId ? result.deviceId : getDeviceId();
  return records.map((r) => ({
    androidCallId: r.androidCallId ?? null,
    phoneNumber: r.phoneNumber ?? "",
    callerName: r.callerName ?? null,
    startedAt: r.startedAt ?? null,
    durationSeconds: Number(r.durationSeconds) || 0,
    callType: r.callType ?? "other",
    deviceId,
  }));
}
