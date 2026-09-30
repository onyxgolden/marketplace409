// machineStatus.js — FORGE Security Rung 1: pure normalization of raw OS
// security-posture reads into the machine status snapshot.
//
// Framework-free, no OS access here (see docs/forge-security/architecture.md's
// DDD boundary: the collector script owns talking to the OS; this module only
// normalizes what it was handed). Every normalizer fails closed to `UNKNOWN`
// when its source didn't return usable data — never inferred as protected,
// per docs/forge-security/privacy-data-contract.md's "unknown is not healthy"
// rule. Raw PowerShell shapes here (booleans-as-1/0, /Date(ticks)/-wrapped
// dates) were confirmed against a real machine, not assumed from docs.

export const AGENT_VERSION = "0.1.0-rung1";
export const UNKNOWN = "unknown";

function errorMessage(error) {
  return error ? String((error && error.message) || error) : "no data";
}

/** Accepts JSON boolean, 0/1 (CimBoolean's real wire shape), or "True"/"False". */
function toTriBool(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const lower = value.toLowerCase();
    if (lower === "true" || value === "1") return true;
    if (lower === "false" || value === "0") return false;
  }
  return UNKNOWN;
}

/**
 * PowerShell's default JSON serializer wraps DateTime as either a plain
 * ISO-ish string or `{ value: "/Date(<ticks>)/", DateTime: "<locale string>" }`
 * (confirmed live via Get-HotFix). Parse both; never guess a date from
 * something that didn't parse.
 */
export function parsePowerShellDate(value) {
  if (!value) return null;
  if (typeof value === "string") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === "object") {
    const wireValue = value.value;
    if (typeof wireValue === "string") {
      const match = wireValue.match(/\/Date\((-?\d+)\)\//);
      if (match) return new Date(Number(match[1]));
    }
    if (typeof value.DateTime === "string") {
      const d = new Date(value.DateTime);
      if (!Number.isNaN(d.getTime())) return d;
    }
  }
  return null;
}

/**
 * `raw` is the parsed JSON from `Get-MpComputerStatus`, or null.
 * `error` is set when the PowerShell call itself failed (module missing,
 * access denied, Defender not installed, etc.) — distinct from a
 * successful call that returned nothing.
 */
export function normalizeDefenderStatus(raw, error) {
  if (error || !raw || typeof raw !== "object") {
    return Object.freeze({
      state: UNKNOWN,
      realTimeProtectionEnabled: UNKNOWN,
      antivirusEnabled: UNKNOWN,
      antispywareEnabled: UNKNOWN,
      engineVersion: null,
      signatureVersion: null,
      antivirusSignatureAge: null,
      collection: Object.freeze({ ok: false, error: errorMessage(error) }),
    });
  }
  const rtp = toTriBool(raw.RealTimeProtectionEnabled);
  return Object.freeze({
    state: rtp === true ? "protected" : rtp === false ? "unprotected" : UNKNOWN,
    realTimeProtectionEnabled: rtp,
    antivirusEnabled: toTriBool(raw.AntivirusEnabled),
    antispywareEnabled: toTriBool(raw.AntispywareEnabled),
    engineVersion: typeof raw.AMEngineVersion === "string" ? raw.AMEngineVersion : null,
    signatureVersion: typeof raw.AntivirusSignatureVersion === "string" ? raw.AntivirusSignatureVersion : null,
    antivirusSignatureAge: typeof raw.AntivirusSignatureAge === "number" ? raw.AntivirusSignatureAge : null,
    collection: Object.freeze({ ok: true, error: null }),
  });
}

/**
 * `rawProfiles` is the parsed JSON array from `Get-NetFirewallProfile`
 * (Domain/Private/Public), or null/non-array on failure.
 */
export function normalizeFirewallStatus(rawProfiles, error) {
  if (error || !Array.isArray(rawProfiles) || rawProfiles.length === 0) {
    return Object.freeze({
      state: UNKNOWN,
      profiles: Object.freeze({}),
      collection: Object.freeze({ ok: false, error: errorMessage(error) }),
    });
  }
  const profiles = {};
  for (const profile of rawProfiles) {
    const name = profile && profile.Name;
    if (!name) continue;
    profiles[name] = toTriBool(profile.Enabled);
  }
  const values = Object.values(profiles);
  const allKnown = values.length > 0 && values.every((v) => v === true || v === false);
  const state = !allKnown ? UNKNOWN : values.some((v) => v === false) ? "unprotected" : "protected";
  return Object.freeze({
    state,
    profiles: Object.freeze(profiles),
    collection: Object.freeze({ ok: true, error: null }),
  });
}

/**
 * `rawHotfixes` is the parsed JSON array from `Get-HotFix`, or null/non-array
 * on failure. Deliberately never claims "compliant"/"up to date" — Get-HotFix
 * is documented in windows-sources.md as best-effort/incomplete for modern
 * cumulative updates, so this only reports what it can actually see.
 */
export function normalizeUpdatePosture(rawHotfixes, error) {
  if (error || !Array.isArray(rawHotfixes)) {
    return Object.freeze({
      state: UNKNOWN,
      mostRecentInstalledOn: null,
      installedCount: null,
      collection: Object.freeze({ ok: false, error: errorMessage(error) }),
    });
  }
  const dates = rawHotfixes
    .map((h) => parsePowerShellDate(h && h.InstalledOn))
    .filter((d) => d !== null);
  const mostRecent = dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))) : null;
  return Object.freeze({
    state: "best-effort",
    mostRecentInstalledOn: mostRecent ? mostRecent.toISOString() : null,
    installedCount: rawHotfixes.length,
    collection: Object.freeze({ ok: true, error: null }),
  });
}

export function buildMachineStatusSnapshot({
  machineId,
  observedAt,
  agentVersion = AGENT_VERSION,
  osInfo,
  defender,
  firewall,
  update,
}) {
  return Object.freeze({
    machineId,
    observedAt,
    agentVersion,
    os: Object.freeze({ ...osInfo }),
    defender,
    firewall,
    update,
  });
}
