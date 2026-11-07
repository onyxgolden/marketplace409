#!/usr/bin/env node
/**
 * run-preview.mjs — INERT synthetic preview harness for P5-A.
 *
 *   node preview/run-preview.mjs --fixture <name> --out <dir> [--mode DISABLED|SYNTHETIC_PREVIEW]
 *
 * Loads ONE named synthetic fixture, validates it through
 * proposalSchema + receiptMapping + serializer + renderer, and
 * writes the private item JSON + rendered HTML to the explicit
 * --out dir only.
 *
 * What this harness NEVER does: create a worktree, execute a test,
 * run Git, touch the network, spawn a shell, write outside --out,
 * or open any adapter/store/source. DISABLED returns before opening
 * any fixture file (prove it: --mode DISABLED with a nonexistent
 * fixture still exits 10). Exit codes: 0 preview written ·
 * 10 DISABLED · 11 ACTIVATION_REQUIRED · 12 REFUSED · 2 usage error.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const WIRING = join(HERE, "..");
const SRC = join(WIRING, "..", "..", "..", "src", "application", "ai-lab", "programmer");

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

function fail(code, message, exitCode) {
  console.log(JSON.stringify({ ok: false, mode: code === "FEATURE_DISABLED" ? "DISABLED" : undefined, code, error: message }));
  process.exit(exitCode);
}

const fixtureName = arg("fixture");
const outDir = arg("out");
const modeArg = arg("mode") ?? "DISABLED";
if (!fixtureName || !outDir) {
  console.error("usage: node preview/run-preview.mjs --fixture <name> --out <dir> [--mode DISABLED|SYNTHETIC_PREVIEW]");
  process.exit(2);
}

const { resolveMode, JobRefusal } = await import(join(SRC, "jobContracts.js"));
let mode;
try {
  mode = resolveMode(modeArg, undefined);
} catch (e) {
  if (e instanceof JobRefusal && e.code === "ACTIVATION_REQUIRED") fail("ACTIVATION_REQUIRED", e.detail || e.message, 11);
  if (e instanceof JobRefusal) fail(e.code, e.detail || e.message, 12);
  throw e;
}
if (mode === "DISABLED") {
  // Returns before opening any fixture, manifest, adapter or store.
  console.log(JSON.stringify({ ok: false, mode: "DISABLED", code: "FEATURE_DISABLED", error: "programmer dry-run is DISABLED; synthetic preview requires --mode SYNTHETIC_PREVIEW" }));
  process.exit(10);
}

const { validateProposal } = await import(join(SRC, "proposalSchema.js"));
const { serializePrivateItem } = await import(join(SRC, "privateItemSerializer.js"));
const { renderDetail, renderListItem } = await import(join(SRC, "proposalRenderer.js"));

// Manifest-pinned fixture load: bytes must match the manifest digest.
const manifest = JSON.parse(readFileSync(join(WIRING, "fixtures", "manifest.json"), "utf8"));
const entry = manifest.fixtures?.[fixtureName];
if (!entry) fail("UNKNOWN_FIXTURE", `no fixture named '${fixtureName}'`, 12);
const fixturePath = join(WIRING, "fixtures", entry.file);
const fixtureBytes = readFileSync(fixturePath);
const digest = createHash("sha256").update(fixtureBytes).digest("hex");
if (digest !== entry.sha256) {
  fail("FIXTURE_DIGEST_MISMATCH", `fixture '${fixtureName}' bytes do not match the manifest digest`, 12);
}
let proposal;
try {
  proposal = JSON.parse(fixtureBytes.toString("utf8"));
} catch {
  fail("FIXTURE_MALFORMED", `fixture '${fixtureName}' is not valid JSON`, 12);
}

let item;
try {
  const valid = validateProposal(proposal);
  item = serializePrivateItem({ proposal: valid, publishedAt: "2026-11-07T12:00:00Z" });
} catch (e) {
  if (e instanceof JobRefusal) fail(e.code, e.detail || e.message, 12);
  throw e;
}

const out = resolve(outDir);
mkdirSync(out, { recursive: true });
const itemPath = join(out, `${fixtureName}.private-item.json`);
const htmlPath = join(out, `${fixtureName}.html`);
writeFileSync(itemPath, `${JSON.stringify(item, null, 2)}\n`, "utf8");
writeFileSync(
  htmlPath,
  `${renderDetail(item, { decisions: [], humanState: "PENDING", mode: "SYNTHETIC_PREVIEW", decisionsEnabled: false })}\n`,
  "utf8",
);
// The list rendering is exercised here too so a list/detail drift
// is caught by the harness, not only by unit tests.
void renderListItem(item, { mode: "SYNTHETIC_PREVIEW" });

console.log(
  JSON.stringify({
    ok: true,
    mode: "SYNTHETIC_PREVIEW",
    fixture: fixtureName,
    item_id: item.item_id,
    verification_state: item.verification.verification_state,
    lifecycle: item.verification.lifecycle,
    reason_codes: item.verification.reason_codes,
    item_path: itemPath,
    html_path: htmlPath,
  }),
);
process.exit(0);
