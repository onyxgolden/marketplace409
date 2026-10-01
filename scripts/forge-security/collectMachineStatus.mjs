// collectMachineStatus.mjs — FORGE Security Rung 1 collector.
//
// The one OS-touching piece of Rung 1 (see docs/forge-security/architecture.md's
// DDD boundary): shells out to a handful of standard, read-only Windows
// diagnostic cmdlets and hands their raw JSON to the pure normalizers in
// src/domains/forgeSecurity/machineStatus.js. No writes, no config changes,
// no remediation — read Defender/Firewall/update posture and OS/agent
// version, fail closed to "unknown" per source on any read error.
//
// Usage: node scripts/forge-security/collectMachineStatus.mjs [--out <path>]

import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";
import {
  AGENT_VERSION,
  buildMachineStatusSnapshot,
  normalizeDefenderStatus,
  normalizeFirewallStatus,
  normalizeUpdatePosture,
} from "../../src/domains/forgeSecurity/machineStatus.js";
import { readOrCreateMachineId } from "../../src/domains/forgeSecurity/machineIdentity.js";

export const DEFAULT_MACHINE_ID_PATH = path.join(os.homedir(), ".forge-security", "machine-id.json");

/**
 * Runs a PowerShell expression and parses its JSON output. `exec` is
 * injectable so tests never actually shell out. Returns `{ raw, error }`:
 * a genuinely empty result set (e.g. zero hotfixes) is `{ raw: null, error:
 * null }` — success, nothing to report — distinct from a failed call
 * (`{ raw: null, error }`), per the "unknown is not healthy" contract: only
 * the latter should make a normalizer fail closed.
 */
export function runPowerShellJson(expression, exec = execFileSync) {
  try {
    const output = exec(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", `${expression} | ConvertTo-Json -Depth 5 -Compress`],
      { encoding: "utf8", windowsHide: true },
    );
    const trimmed = typeof output === "string" ? output.trim() : "";
    if (!trimmed) return { raw: null, error: null };
    return { raw: JSON.parse(trimmed), error: null };
  } catch (error) {
    return { raw: null, error };
  }
}

/** PowerShell's ConvertTo-Json returns a bare object for a single result, not a one-element array. */
function asArray(raw) {
  if (Array.isArray(raw)) return raw;
  return raw ? [raw] : [];
}

export function collectMachineStatus({
  exec = execFileSync,
  machineIdPath = DEFAULT_MACHINE_ID_PATH,
  now = () => new Date(),
} = {}) {
  const machineId = readOrCreateMachineId(machineIdPath);
  const observedAt = now().toISOString();

  const defenderRaw = runPowerShellJson("Get-MpComputerStatus", exec);
  const firewallRaw = runPowerShellJson("Get-NetFirewallProfile", exec);
  const updateRaw = runPowerShellJson("Get-HotFix", exec);

  const defender = normalizeDefenderStatus(defenderRaw.raw, defenderRaw.error);
  const firewall = normalizeFirewallStatus(
    firewallRaw.error ? null : asArray(firewallRaw.raw),
    firewallRaw.error,
  );
  const update = normalizeUpdatePosture(
    updateRaw.error ? null : asArray(updateRaw.raw),
    updateRaw.error,
  );

  return buildMachineStatusSnapshot({
    machineId,
    observedAt,
    agentVersion: AGENT_VERSION,
    osInfo: { platform: os.platform(), release: os.release(), arch: os.arch() },
    defender,
    firewall,
    update,
  });
}

function parseArgs(argv) {
  const outIndex = argv.indexOf("--out");
  return { outPath: outIndex >= 0 ? argv[outIndex + 1] : null };
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  const { outPath } = parseArgs(process.argv.slice(2));
  const snapshot = collectMachineStatus();
  const json = JSON.stringify(snapshot, null, 2);
  if (outPath) {
    writeFileSync(outPath, json + "\n");
  } else {
    process.stdout.write(json + "\n");
  }
}
