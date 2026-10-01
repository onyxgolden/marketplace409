// machineIdentity.js — a stable, pseudonymous, locally-generated machine id.
//
// Per docs/forge-security/privacy-data-contract.md: not derived from the
// hostname or anything tied to a Microsoft account. Generated once with
// crypto.randomUUID() and persisted to a local file; every later read
// returns the same id.

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/** Reads the machine id at `idFilePath`, creating one if it doesn't exist yet. */
export function readOrCreateMachineId(idFilePath) {
  if (existsSync(idFilePath)) {
    try {
      const parsed = JSON.parse(readFileSync(idFilePath, "utf8"));
      if (parsed && typeof parsed.machineId === "string" && parsed.machineId) {
        return parsed.machineId;
      }
    } catch {
      // Corrupt/unreadable file — fall through and regenerate below.
    }
  }
  const machineId = randomUUID();
  mkdirSync(path.dirname(idFilePath), { recursive: true });
  writeFileSync(
    idFilePath,
    JSON.stringify({ machineId, createdAt: new Date().toISOString() }, null, 2),
  );
  return machineId;
}
