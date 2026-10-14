/** Trusted context + corpus authentication tests (CI-001, CI-006). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createTrustedContext,
  validateTrustedContext,
  confirmedSetDigest,
  admitSubject,
  admitForgePin,
  resolveCitation,
  sourceFreshness,
  verifyCorpusManifest,
  manifestDigest,
  sha256Hex,
  APPROVED_ROOT_DIGEST,
} from "../src/trust.js";
import { trustedContext } from "./helpers.js";

test("valid trusted context passes", () => {
  assert.deepEqual(validateTrustedContext(trustedContext()), []);
});

test("missing context fails closed", () => {
  assert.ok(validateTrustedContext(null).length > 0);
  assert.ok(validateTrustedContext({}).length > 0);
});

test("confirmed set digest is self-checking", () => {
  const t = trustedContext();
  const tampered = {
    ...t,
    confirmedSet: { vendors: [...t.confirmedSet.vendors, { vendor_id: "evil", product_id: "e" }], digest: t.confirmedSet.digest },
  };
  assert.ok(validateTrustedContext(tampered).some((e) => e.includes("digest")));
});

test("admitSubject: forge always, vendors only if confirmed", () => {
  const t = trustedContext();
  assert.equal(admitSubject(t, "forge").ok, true);
  assert.equal(admitSubject(t, "compa").ok, true);
  const r = admitSubject(t, "shadow");
  assert.equal(r.ok, false);
  assert.equal(r.reason, "SUBJECT_UNCONFIRMED");
});

test("admitForgePin requires exact match", () => {
  const t = trustedContext();
  assert.equal(admitForgePin(t, { ...t.forgeSnapshot }).ok, true);
  const r = admitForgePin(t, { repo: "onyxgolden/marketplace409", commit: "0".repeat(40), tree: "treex" });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "FORGE_PIN_UNVERIFIED");
});

test("resolveCitation enforces admission, access, vendor", () => {
  const t = trustedContext();
  const ok = resolveCitation(t, "compa-src-1", "compa");
  assert.equal(ok.ok, true);
  assert.equal(ok.freshness, "fresh");
  assert.equal(resolveCitation(t, "nope", "compa").reason, "SOURCE_UNVERIFIED");
  assert.equal(resolveCitation(t, "compa-src-1", "compb").reason, "VENDOR_MISMATCH");
  const restricted = trustedContext();
  restricted.admittedSources["compa-src-1"] = { ...restricted.admittedSources["compa-src-1"], access_status: "expired" };
  assert.equal(resolveCitation(restricted, "compa-src-1", "compa").reason, "ACCESS_RESTRICTED");
});

test("sourceFreshness: stale after 180 days", () => {
  const t = trustedContext();
  const old = { ...t.admittedSources["compa-src-1"], accessed_at: "2025-01-01T00:00:00Z" };
  assert.equal(sourceFreshness(t, old), "stale");
  assert.equal(sourceFreshness(t, t.admittedSources["compa-src-1"]), "fresh");
});

test("manifestDigest is deterministic", () => {
  const files = { "a.js": "console.log(1);", "b.js": "export const x = 2;" };
  const hashes = Object.fromEntries(Object.entries(files).map(([p, c]) => [p, sha256Hex(c)]));
  assert.equal(manifestDigest(hashes), manifestDigest({ "b.js": hashes["b.js"], "a.js": hashes["a.js"] }));
  assert.match(manifestDigest(hashes), /^[0-9a-f]{64}$/);
});

test("verifyCorpusManifest: tampered file content fails", () => {
  const root = new URL("..", import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL("corpus/manifest.json", root), "utf8"));
  const paths = Object.keys(manifest.files);
  const victim = paths[0];
  const r = verifyCorpusManifest(
    manifest,
    (p) => (p === victim ? "TAMPERED CONTENT" : readFileSync(new URL(p, root), "utf8")),
  );
  assert.equal(r.ok, false);
  assert.equal(r.reason, "file_tampered");
  assert.equal(r.path, victim);
});

test("verifyCorpusManifest: manifest tamper fails the root check", () => {
  const root = new URL("..", import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL("corpus/manifest.json", root), "utf8"));
  const paths = Object.keys(manifest.files);
  const modified = { files: { ...manifest.files, [paths[0]]: "0".repeat(64) } };
  const r = verifyCorpusManifest(modified, (p) => readFileSync(new URL(p, root), "utf8"));
  assert.equal(r.ok, false);
  assert.equal(r.reason, "root_digest_mismatch");
});

test("verifyCorpusManifest: malformed manifest fails", () => {
  assert.equal(verifyCorpusManifest(null, () => "").ok, false);
  assert.equal(verifyCorpusManifest({ nope: 1 }, () => "").ok, false);
});

test("real corpus: manifest authenticates the frozen tree", () => {
  const root = new URL("..", import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL("corpus/manifest.json", root), "utf8"));
  const r = verifyCorpusManifest(manifest, (p) => readFileSync(new URL(p, root), "utf8"));
  assert.equal(r.ok, true, `corpus authentication failed: ${r.reason || "ok"} ${r.path || ""}`);
  assert.ok(r.files > 10, `expected the full corpus, got ${r.files} files`);
});

test("corpus root digest is frozen (not the placeholder)", () => {
  assert.match(APPROVED_ROOT_DIGEST, /^[0-9a-f]{64}$/);
});
