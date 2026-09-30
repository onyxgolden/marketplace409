import { describe, expect, it } from "vitest";
import {
  UNKNOWN,
  buildMachineStatusSnapshot,
  normalizeDefenderStatus,
  normalizeFirewallStatus,
  normalizeUpdatePosture,
  parsePowerShellDate,
} from "./machineStatus.js";

describe("normalizeDefenderStatus", () => {
  it("reports protected when real-time protection is enabled", () => {
    const result = normalizeDefenderStatus(
      { RealTimeProtectionEnabled: true, AntivirusEnabled: true, AntispywareEnabled: true, AMEngineVersion: "1.1.1", AntivirusSignatureVersion: "1.2.3", AntivirusSignatureAge: 0 },
      null,
    );
    expect(result.state).toBe("protected");
    expect(result.realTimeProtectionEnabled).toBe(true);
    expect(result.collection).toEqual({ ok: true, error: null });
  });

  it("reports unprotected when real-time protection is disabled (confirmed real-machine shape)", () => {
    const result = normalizeDefenderStatus({ RealTimeProtectionEnabled: false, AntivirusEnabled: true, AntispywareEnabled: true }, null);
    expect(result.state).toBe("unprotected");
    expect(result.realTimeProtectionEnabled).toBe(false);
  });

  it("fails closed to unknown, never protected, when the source errors", () => {
    const result = normalizeDefenderStatus(null, new Error("Defender module not found"));
    expect(result.state).toBe(UNKNOWN);
    expect(result.realTimeProtectionEnabled).toBe(UNKNOWN);
    expect(result.collection).toEqual({ ok: false, error: "Defender module not found" });
  });

  it("fails closed to unknown on missing/malformed raw data even without an explicit error", () => {
    expect(normalizeDefenderStatus(null, null).state).toBe(UNKNOWN);
    expect(normalizeDefenderStatus("not an object", null).state).toBe(UNKNOWN);
  });
});

describe("normalizeFirewallStatus", () => {
  it("reports protected when every profile is enabled, including the real 1/0 wire shape", () => {
    const result = normalizeFirewallStatus(
      [
        { Name: "Domain", Enabled: 1 },
        { Name: "Private", Enabled: 1 },
        { Name: "Public", Enabled: 1 },
      ],
      null,
    );
    expect(result.state).toBe("protected");
    expect(result.profiles).toEqual({ Domain: true, Private: true, Public: true });
  });

  it("reports unprotected when any profile is disabled", () => {
    const result = normalizeFirewallStatus(
      [
        { Name: "Domain", Enabled: 1 },
        { Name: "Private", Enabled: 0 },
        { Name: "Public", Enabled: 1 },
      ],
      null,
    );
    expect(result.state).toBe("unprotected");
    expect(result.profiles.Private).toBe(false);
  });

  it("fails closed to unknown on a partial read of one profile, never protected (ChatGPT review of PR #498, finding 1)", () => {
    const result = normalizeFirewallStatus([{ Name: "Domain", Enabled: 1 }], null);
    expect(result.state).toBe(UNKNOWN);
    expect(result.profiles).toEqual({ Domain: true });
  });

  it("fails closed to unknown on a partial read of two of three profiles, never protected", () => {
    const result = normalizeFirewallStatus(
      [
        { Name: "Domain", Enabled: 1 },
        { Name: "Private", Enabled: 1 },
      ],
      null,
    );
    expect(result.state).toBe(UNKNOWN);
  });

  it("still reports unprotected from a partial read if the observed profile is disabled", () => {
    const result = normalizeFirewallStatus([{ Name: "Private", Enabled: 0 }], null);
    expect(result.state).toBe("unprotected");
  });

  it("fails closed to unknown on a collection error", () => {
    const result = normalizeFirewallStatus(null, new Error("access denied"));
    expect(result.state).toBe(UNKNOWN);
    expect(result.profiles).toEqual({});
    expect(result.collection).toEqual({ ok: false, error: "access denied" });
  });

  it("fails closed to unknown on an empty profile list even without an explicit error", () => {
    expect(normalizeFirewallStatus([], null).state).toBe(UNKNOWN);
  });

  it("never claims protected/unprotected for a profile whose Enabled value doesn't parse", () => {
    const result = normalizeFirewallStatus([{ Name: "Domain", Enabled: "maybe" }], null);
    expect(result.state).toBe(UNKNOWN);
    expect(result.profiles.Domain).toBe(UNKNOWN);
  });
});

describe("parsePowerShellDate", () => {
  it("parses the real /Date(ticks)/-wrapped shape confirmed from a live machine", () => {
    const d = parsePowerShellDate({ value: "/Date(1789880400000)/", DateTime: "Sunday, September 20, 2026 12:00:00 AM" });
    expect(d.getTime()).toBe(1789880400000);
  });

  it("parses a plain ISO string", () => {
    const d = parsePowerShellDate("2026-09-20T00:00:00.000Z");
    expect(d.toISOString()).toBe("2026-09-20T00:00:00.000Z");
  });

  it("returns null for missing or unparseable values, never a fabricated date", () => {
    expect(parsePowerShellDate(null)).toBeNull();
    expect(parsePowerShellDate(undefined)).toBeNull();
    expect(parsePowerShellDate({ value: "garbage" })).toBeNull();
    expect(parsePowerShellDate("not a date")).toBeNull();
  });
});

describe("normalizeUpdatePosture", () => {
  it("reports the most recent installed date and count, tagged best-effort (never 'compliant')", () => {
    const result = normalizeUpdatePosture(
      [
        { HotFixID: "KB1", InstalledOn: { value: "/Date(1777957200000)/" } },
        { HotFixID: "KB2", InstalledOn: { value: "/Date(1789880400000)/" } },
      ],
      null,
    );
    expect(result.state).toBe("best-effort");
    expect(result.installedCount).toBe(2);
    expect(result.mostRecentInstalledOn).toBe(new Date(1789880400000).toISOString());
  });

  it("fails closed to unknown on a collection error", () => {
    const result = normalizeUpdatePosture(null, new Error("Get-HotFix failed"));
    expect(result.state).toBe(UNKNOWN);
    expect(result.mostRecentInstalledOn).toBeNull();
    expect(result.installedCount).toBeNull();
  });

  it("treats a genuinely empty hotfix list as a valid zero-count result, not unknown", () => {
    const result = normalizeUpdatePosture([], null);
    expect(result.state).toBe("best-effort");
    expect(result.installedCount).toBe(0);
    expect(result.mostRecentInstalledOn).toBeNull();
  });
});

describe("buildMachineStatusSnapshot", () => {
  it("assembles every field into one frozen snapshot", () => {
    const snapshot = buildMachineStatusSnapshot({
      machineId: "abc-123",
      observedAt: "2026-09-30T12:00:00.000Z",
      osInfo: { platform: "win32", release: "10.0.26200", arch: "x64" },
      defender: { state: "protected" },
      firewall: { state: "protected" },
      update: { state: "best-effort" },
    });
    expect(snapshot).toEqual({
      machineId: "abc-123",
      observedAt: "2026-09-30T12:00:00.000Z",
      agentVersion: "0.1.0-rung1",
      os: { platform: "win32", release: "10.0.26200", arch: "x64" },
      defender: { state: "protected" },
      firewall: { state: "protected" },
      update: { state: "best-effort" },
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
  });
});
