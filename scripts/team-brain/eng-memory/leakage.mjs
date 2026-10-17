// Team Brain eng-memory slice 1 — leakage scanner.
// Pure, no I/O, no network, no model calls.
//
// After every battery/test run, all outputs, logs, and persisted test
// artifacts are scanned for forbidden content:
//   - any host prohibited-value canary appearing in a string value, and
//   - any forbidden key-name fragment appearing as an object key.
//
// The scan covers OUTPUTS only (serialized episodes, recall results,
// battery reports, store dumps). Test inputs and source code legitimately
// name these fragments; inputs are never outputs. Diagnostics in outputs
// must carry reason codes and safe IDs only — a canary in an output is a
// defect, never an expectation.

import { ENG_CODES, fail } from "./errors.mjs";

const FORBIDDEN_KEY_FRAGMENTS = [
  "tenant",
  "ledger",
  "financ",
  "payment",
  "schedul",
  "transcript",
  "cookie",
  "authoriz",
  "bearer",
  "token",
  "secret",
  "passwd",
  "vault",
  "ssn",
  "api_key",
  "apikey",
  "screenshot",
  "image_bytes",
  "card_",
  "bank_",
  "iban",
];

/**
 * Recursively scan a value. Returns an array of findings
 * {kind: "key"|"value", path}. Empty array means clean.
 */
export function scanArtifact(value, prohibitedValues, path = "$") {
  const findings = [];
  const walk = (v, p) => {
    if (typeof v === "string") {
      for (const canary of prohibitedValues || []) {
        if (typeof canary === "string" && canary !== "" && v.includes(canary)) {
          findings.push({ kind: "value", path: p });
        }
      }
      return;
    }
    if (v !== null && typeof v === "object") {
      for (const key of Object.keys(v)) {
        const lowered = key.toLowerCase();
        for (const frag of FORBIDDEN_KEY_FRAGMENTS) {
          if (lowered.includes(frag)) {
            findings.push({ kind: "key", path: `${p}.${key}` });
            break;
          }
        }
        walk(v[key], `${p}.${key}`);
      }
    }
  };
  walk(value, path);
  return findings;
}

/** Throw LEAKAGE_DETECTED when any finding exists; details carry counts and paths only. */
export function assertCleanArtifact(value, prohibitedValues, label = "artifact") {
  const findings = scanArtifact(value, prohibitedValues);
  if (findings.length > 0) {
    fail(ENG_CODES.LEAKAGE_DETECTED, `Forbidden content in ${label}: ${findings.length} finding(s)`, {
      label,
      count: findings.length,
      paths: findings.slice(0, 10).map((f) => `${f.kind}:${f.path}`),
    });
  }
  return true;
}
