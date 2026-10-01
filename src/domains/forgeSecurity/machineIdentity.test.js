import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { readOrCreateMachineId } from "./machineIdentity.js";

describe("readOrCreateMachineId", () => {
  let tmpDir;

  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates a new pseudonymous id and persists it when none exists yet", () => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "forge-security-test-"));
    const idFilePath = path.join(tmpDir, "nested", "machine-id.json");

    const id = readOrCreateMachineId(idFilePath);

    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
    const persisted = JSON.parse(readFileSync(idFilePath, "utf8"));
    expect(persisted.machineId).toBe(id);
  });

  it("returns the same id on every subsequent read", () => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "forge-security-test-"));
    const idFilePath = path.join(tmpDir, "machine-id.json");

    const first = readOrCreateMachineId(idFilePath);
    const second = readOrCreateMachineId(idFilePath);

    expect(second).toBe(first);
  });

  it("regenerates rather than crashing when the id file is corrupt", () => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "forge-security-test-"));
    const idFilePath = path.join(tmpDir, "machine-id.json");
    writeFileSync(idFilePath, "{ not valid json");

    const id = readOrCreateMachineId(idFilePath);

    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });
});
