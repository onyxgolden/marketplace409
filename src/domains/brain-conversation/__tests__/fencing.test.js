import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SENSITIVE_KINDS,
  assertModelPayloadSafe,
  buildModelPayload,
} from "../fencing.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const DOMAIN_DIR = join(HERE, "..");
const ROUTES_DIR = join(HERE, "..", "..", "..", "app", "api", "brain");

function collectFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name === "__tests__") continue;
      collectFiles(path, out);
    } else if (!name.endsWith(".test.js") && !name.endsWith(".test.jsx")) {
      out.push(path);
    }
  }
  return out;
}

describe("model-payload fencing (A5)", () => {
  it("refuses every sensitive kind", () => {
    for (const kind of SENSITIVE_KINDS) {
      expect(() => assertModelPayloadSafe([{ content: "note", sensitivity: kind }])).toThrow(
        /Refusing model payload/,
      );
    }
  });

  it("refuses resolved record details even without a sensitivity tag", () => {
    expect(() =>
      assertModelPayloadSafe([{ content: "note", recordDetails: { name: "someone" } }]),
    ).toThrow(/pointers only/);
  });

  it("passes pointer-only entries through as type + id and nothing more", () => {
    const payload = buildModelPayload([
      { content: "note about a lease record", recordType: "lease", recordId: "lease-42" },
    ]);
    expect(payload).toEqual([
      {
        kind: "memory",
        text: "note about a lease record",
        salience: null,
        provenance: null,
        pointer: { type: "lease", id: "lease-42" },
      },
    ]);
  });

  it("passes plain entries with no pointer", () => {
    expect(() => assertModelPayloadSafe([{ content: "plain note" }])).not.toThrow();
  });

  it("no model SDK import or endpoint string exists anywhere in the harness or its routes", () => {
    const banned = /openai|anthropic|generative-ai|chat\/completions|api\.openai\.com/i;
    const files = [...collectFiles(DOMAIN_DIR), ...collectFiles(ROUTES_DIR)];
    expect(files.length).toBeGreaterThan(0);
    const offenders = files.filter((path) => banned.test(readFileSync(path, "utf8")));
    expect(offenders).toEqual([]);
  });
});
