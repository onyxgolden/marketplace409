import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { collectMachineStatus, runPowerShellJson } from "./collectMachineStatus.mjs";

describe("runPowerShellJson", () => {
  it("parses JSON output from the injected exec function", () => {
    const fakeExec = () => '{"Name":"Domain","Enabled":1}';
    const result = runPowerShellJson("Get-NetFirewallProfile", fakeExec);
    expect(result).toEqual({ raw: { Name: "Domain", Enabled: 1 }, error: null });
  });

  it("treats empty output as a successful, empty result — not an error", () => {
    const fakeExec = () => "";
    expect(runPowerShellJson("Get-HotFix", fakeExec)).toEqual({ raw: null, error: null });
  });

  it("captures a thrown error rather than letting it propagate", () => {
    const boom = new Error("powershell.exe not found");
    const fakeExec = () => {
      throw boom;
    };
    const result = runPowerShellJson("Get-MpComputerStatus", fakeExec);
    expect(result.raw).toBeNull();
    expect(result.error).toBe(boom);
  });
});

describe("collectMachineStatus", () => {
  let tmpDir;

  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("assembles a full snapshot from three independently-successful sources", () => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "forge-security-collect-test-"));
    const machineIdPath = path.join(tmpDir, "machine-id.json");
    const responses = {
      "Get-MpComputerStatus": '{"RealTimeProtectionEnabled":true,"AntivirusEnabled":true,"AntispywareEnabled":true}',
      "Get-NetFirewallProfile": '[{"Name":"Domain","Enabled":1},{"Name":"Private","Enabled":1},{"Name":"Public","Enabled":1}]',
      "Get-HotFix": '[{"HotFixID":"KB1","InstalledOn":{"value":"/Date(1789880400000)/"}}]',
    };
    const fakeExec = (_cmd, args) => {
      const expression = args[args.length - 1];
      const key = Object.keys(responses).find((k) => expression.startsWith(k));
      return responses[key];
    };

    const snapshot = collectMachineStatus({
      exec: fakeExec,
      machineIdPath,
      now: () => new Date("2026-09-30T12:00:00.000Z"),
    });

    expect(snapshot.observedAt).toBe("2026-09-30T12:00:00.000Z");
    expect(typeof snapshot.machineId).toBe("string");
    expect(snapshot.defender.state).toBe("protected");
    expect(snapshot.firewall.state).toBe("protected");
    expect(snapshot.update.state).toBe("best-effort");
    expect(snapshot.update.installedCount).toBe(1);
    expect(snapshot.os.platform).toBe(os.platform());
  });

  it("fails each source closed to unknown independently — one failure doesn't sink the others", () => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "forge-security-collect-test-"));
    const machineIdPath = path.join(tmpDir, "machine-id.json");
    const fakeExec = (_cmd, args) => {
      const expression = args[args.length - 1];
      if (expression.startsWith("Get-MpComputerStatus")) throw new Error("Defender module not found");
      if (expression.startsWith("Get-NetFirewallProfile")) {
        return '[{"Name":"Domain","Enabled":1},{"Name":"Private","Enabled":1},{"Name":"Public","Enabled":1}]';
      }
      return "";
    };

    const snapshot = collectMachineStatus({ exec: fakeExec, machineIdPath });

    expect(snapshot.defender.state).toBe("unknown");
    expect(snapshot.defender.collection.ok).toBe(false);
    expect(snapshot.firewall.state).toBe("protected");
    expect(snapshot.update.state).toBe("best-effort");
    expect(snapshot.update.installedCount).toBe(0);
  });

  it("reuses the same machine id across repeated collections", () => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "forge-security-collect-test-"));
    const machineIdPath = path.join(tmpDir, "machine-id.json");
    const fakeExec = () => "";

    const first = collectMachineStatus({ exec: fakeExec, machineIdPath });
    const second = collectMachineStatus({ exec: fakeExec, machineIdPath });

    expect(second.machineId).toBe(first.machineId);
  });
});
