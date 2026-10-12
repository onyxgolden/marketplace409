/**
 * em-regressions.test.js — regression probes for the EM-001..EM-005 review
 * findings (engineering-manager Phase 2 slice 1 re-review).
 *
 * These are inline synthetic fixtures (not part of the frozen 100-case
 * corpus) that exercise each finding's Required fix directly:
 *  EM-001: blob recomputation, objective binding, span validation, evidence
 *  EM-002: subject binding, relay registration, coverage, contradictions
 *  EM-003: duplicate keys invalidate the whole graph
 *  EM-004: canonical semantic comparison over all control-bearing fields
 *  EM-005: exact-limit/+1 budget tests for related sources, approval
 *          records, metadata, and the complete output envelope
 *
 * Trust: pre-import authentication (builtins only) in before().
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname, normalize } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function authenticateTrustRoot() {
  const approved = process.env.EM_APPROVED_ROOT;
  assert.ok(typeof approved === "string" && /^[0-9a-f]{64}$/.test(approved), "trust: missing EM_APPROVED_ROOT");
  const sha = (b) => createHash("sha256").update(b).digest("hex");
  const manifest = JSON.parse(readFileSync(join(ROOT, "corpus", "manifest.json"), "utf8"));
  const seen = new Set();
  for (const e of manifest.files) {
    const p = e?.path;
    assert.ok(typeof p === "string" && p.length > 0 && !p.startsWith("/") && !p.includes("\\") && normalize(p) === p && !p.startsWith("..") && !p.includes("../") && !seen.has(p));
    seen.add(p);
    assert.equal(sha(readFileSync(join(ROOT, p))), e.sha256, `trust: hash mismatch: ${p}`);
  }
  const want = ["package.json", "README.md"];
  for (const dir of ["corpus", "src", "runner", "fixtures", "tests"]) {
    for (const f of readdirSync(join(ROOT, dir)).filter((x) => !x.startsWith("."))) {
      const p2 = `${dir}/${f}`;
      if (p2 === "corpus/manifest.json" || p2 === "corpus/corpus_digest.txt") continue;
      if (dir === "fixtures" || dir === "corpus") {
        if (f.endsWith(".json") || f.endsWith(".js")) want.push(p2);
      } else if (f.endsWith(".js")) {
        want.push(p2);
      }
    }
  }
  for (const p of want.sort()) assert.ok(seen.has(p), `trust: unlisted file: ${p}`);
  const digest = sha(Buffer.from(JSON.stringify(manifest.files.filter((e) => e.path !== "package.json").map((e) => ({ path: e.path, sha256: e.sha256 }))), "utf8"));
  assert.equal(digest, manifest.corpus_digest);
  assert.equal(digest, approved);
  return digest;
}

let run;
let canonicalJson;
let buildPlan;

before(async () => {
  authenticateTrustRoot();
  const mod = await import(pathToFileURL(join(ROOT, "src", "index.js")).href);
  run = mod.run;
  canonicalJson = mod.canonicalJson;
  buildPlan = mod.buildPlan;
});

/* ---------------- fixture builders ---------------- */

const REPO = "forge-fixture-briefs";
const CLOCK = "2026-10-12T12:00:00Z";
const OWNERS = ["muse", "claude", "chatgpt", "jason"];
const NUL = String.fromCharCode(0);
const briefKey = (ref) => ref.repo + NUL + ref.path + NUL + ref.commit;
const stdConstraints = (over = {}) => ({ budget_units: 256, max_nodes: 256, owner_allowlist: [...OWNERS], ...over });

function gitBlobSha1(s) {
  const b = Buffer.from(s, "utf8");
  return createHash("sha1").update(Buffer.from(`blob ${b.length}\0`, "utf8")).update(b).digest("hex");
}
const commitFor = (path) => createHash("sha1").update("fixture-commit:" + path, "utf8").digest("hex");

function spec(key, o = {}) {
  return {
    local_key: key,
    title: o.title ?? `Task ${key}`,
    owner_proposal: o.owner ?? "muse",
    action_ids: o.actions ?? ["draft_plan"],
    dependency_keys: o.deps ?? [],
    acceptance_checks:
      o.checks ?? [{ check_id: `${key}-ac1`, expected: "complete", evidence_kind: "fixture_record" }],
    external_gate_ids: o.gates ?? [],
    source_spans: o.spans ?? [],
  };
}

function brief(objectiveId, scopeIds, specs) {
  return { objective_id: objectiveId, scope_ids: scopeIds, task_specs: specs, non_goals: [] };
}

function briefRef(path, br, over = {}) {
  return {
    repo: over.repo ?? REPO,
    path,
    commit: over.commit ?? commitFor(path),
    blob: over.blob ?? gitBlobSha1(canonicalJson(br)),
    algorithm: "git-sha1",
    revision: "fixture-main",
  };
}

/**
 * Plan one synthetic case. briefForPin is the brief the pin is computed
 * from; briefForStore is the bytes actually placed in the host store
 * (defaults to briefForPin). Returns { out, ref, task }.
 */
function planCase({
  briefForPin,
  briefForStore,
  path = "commands/chatgpt/brief-em.md",
  refOver = {},
  taskOver = {},
  approvals = [],
  related = [],
  owners = OWNERS,
  relays = [],
  clock = CLOCK,
} = {}) {
  const storeBrief = briefForStore ?? briefForPin;
  const ref = briefRef(path, briefForPin, refOver);
  const task = {
    brief_ref: ref,
    objective_id: taskOver.objective_id ?? briefForPin.objective_id,
    constraints: stdConstraints(taskOver.constraints),
    requested_action: "plan",
    related_brief_refs: related.map((r) => briefRef(r.path, r.brief, r.refOver ?? {})),
  };
  const briefs = {};
  briefs[briefKey(ref)] = { brief: storeBrief, blob: refOver.blob ?? ref.blob };
  related.forEach((r, i) => {
    const rref = task.related_brief_refs[i];
    briefs[briefKey(rref)] = { brief: r.storeBrief ?? r.brief, blob: r.refOver?.blob ?? rref.blob };
  });
  const context = { clock, briefs, approvals, owners, relays };
  return { out: run(task, context), ref, task };
}

function diagCodes(out) {
  return [...new Set(out.diagnostics.map((d) => d.code))].sort();
}

/* ---------------- EM-001: source binding ---------------- */

describe("EM-001 source content/objective/evidence binding", () => {
  it("changed bytes under the same pin fail closed (HASH_MISMATCH)", () => {
    const original = brief("objective-em1a", ["general"], [spec("a", {}), spec("b", { deps: ["a"] })]);
    const tampered = JSON.parse(JSON.stringify(original));
    tampered.task_specs[0].title = "MODIFIED UNDER SAME PIN";
    const { out } = planCase({ briefForPin: original, briefForStore: tampered });
    assert.equal(out.status, "BLOCKED");
    assert.ok(diagCodes(out).includes("HASH_MISMATCH"));
    assert.ok(out.nodes.every((n) => n.state === "BLOCKED"));
    assert.equal(out.complete, true);
  });

  it("wrong objective_id fails closed (OBJECTIVE_MISMATCH)", () => {
    const br = brief("objective-em1b", ["general"], [spec("a", {})]);
    const { out } = planCase({ briefForPin: br, taskOver: { objective_id: "objective-evil" } });
    assert.equal(out.status, "BLOCKED");
    assert.ok(diagCodes(out).includes("OBJECTIVE_MISMATCH"));
  });

  it("forged span shapes fail closed (SPAN_INVALID)", () => {
    const br = brief("objective-em1c", ["general"], [spec("a", { spans: [{ garbage: "not a citation" }] })]);
    const { out } = planCase({ briefForPin: br });
    assert.equal(out.status, "BLOCKED");
    assert.ok(diagCodes(out).includes("SPAN_INVALID"));
  });

  it("malformed spans (missing byte_end) fail closed", () => {
    const br = brief("objective-em1d", ["general"], [spec("a", { spans: [{ byte_start: 0 }] })]);
    const { out } = planCase({ briefForPin: br });
    assert.equal(out.status, "BLOCKED");
    assert.ok(diagCodes(out).includes("SPAN_INVALID"));
  });

  it("out-of-range spans fail closed", () => {
    const br = brief("objective-em1e", ["general"], [spec("a", { spans: [{ byte_start: 0, byte_end: 999999 }] })]);
    const { out } = planCase({ briefForPin: br });
    assert.equal(out.status, "BLOCKED");
    assert.ok(diagCodes(out).includes("SPAN_INVALID"));
  });

  it("spans splitting a UTF-8 multibyte character fail closed", () => {
    // The multibyte character lives in the objective_id, which precedes
    // task_specs in canonical key order — so the cited offset is stable
    // when the span values are filled in.
    const br = brief("objective-é", ["general"], [spec("a", { title: "Plain" })]);
    br.task_specs[0].source_spans = [{ byte_start: 0, byte_end: 1 }]; // placeholder
    const bytes = Buffer.from(canonicalJson(br), "utf8");
    const idx = bytes.indexOf(Buffer.from("é", "utf8"));
    assert.ok(idx >= 0, "fixture must contain a multibyte character");
    br.task_specs[0].source_spans = [{ byte_start: idx, byte_end: idx + 1 }];
    const { out } = planCase({ briefForPin: br });
    assert.equal(out.status, "BLOCKED");
    assert.ok(diagCodes(out).includes("SPAN_INVALID"));
  });

  it("detached-snapshot spans (valid for a longer revision) fail closed", () => {
    const long = brief("objective-em1g", ["general"], [spec("a", { title: "x".repeat(100) }), spec("b", {})]);
    const longBytes = canonicalJson(long);
    const staleSpans = [{ byte_start: longBytes.length - 10, byte_end: longBytes.length }];
    const short = brief("objective-em1g", ["general"], [spec("a", {}), spec("b", {})]);
    short.task_specs[0].source_spans = staleSpans;
    const { out } = planCase({ briefForPin: short });
    assert.equal(out.status, "BLOCKED");
    assert.ok(diagCodes(out).includes("SPAN_INVALID"));
  });

  it("valid spans plan and emit contract-conforming SourceRef/Citation evidence", () => {
    const br = brief("objective-em1h", ["general"], [spec("a", {}), spec("b", { deps: ["a"] })]);
    // Cite the objective_id region: it precedes task_specs in canonical key
    // order, so the offset is stable when the span values are filled in.
    br.task_specs[0].source_spans = [{ byte_start: 0, byte_end: 1 }]; // placeholder
    const bytes = canonicalJson(br);
    const target = '"objective_id":"objective-em1h"';
    const start = bytes.indexOf(target);
    assert.ok(start >= 0);
    const end = start + target.length;
    br.task_specs[0].source_spans = [{ byte_start: start, byte_end: end, label: "objective" }];
    assert.equal(canonicalJson(br).slice(start, end), target, "cited slice is stable");
    const { out, ref } = planCase({ briefForPin: br });
    assert.equal(out.status, "PLANNED");
    const node = out.nodes.find((n) => n.local_key === "a");
    // Whole-brief evidence: a complete verified SourceRef with an explicit
    // evidence role (common contract provenance schema).
    const briefCite = node.evidence.find((e) => e.kind === "brief_citation");
    assert.ok(briefCite, "node carries a brief citation");
    assert.equal(briefCite.role, "whole-brief-verified-source");
    assert.equal(briefCite.objective_id, "objective-em1h");
    assert.equal(briefCite.verification, "VERIFIED");
    assert.deepEqual(briefCite.source_ref, {
      repo: ref.repo,
      path: ref.path,
      commit: ref.commit,
      blob: ref.blob, // independently recomputed, never the supplied label alone
      algorithm: "git-sha1",
      revision: ref.revision,
    });
    // Span evidence: contract Citation records. Derived excerpts equal BOTH
    // quoted fields AND the exact UTF-8 slice of the resolved bytes.
    const spanCite = node.evidence.find((e) => e.kind === "source_citation");
    assert.ok(spanCite, "node carries a source citation");
    assert.equal(spanCite.label, "objective");
    const c = spanCite.citation;
    assert.deepEqual(
      { repo: c.repo, path: c.path, commit: c.commit, blob: c.blob, algorithm: c.algorithm, revision: c.revision },
      { repo: ref.repo, path: ref.path, commit: ref.commit, blob: ref.blob, algorithm: "git-sha1", revision: ref.revision }
    );
    assert.equal(c.quoted_span, target);
    assert.deepEqual(c.span, { start_byte: start, end_byte: end, quoted_text: target });
    assert.equal(c.quoted_span, c.span.quoted_text, "quoted_span and span.quoted_text are exactly equal");
    assert.equal(c.verification, "VERIFIED");
  });

  it("evidence is a detached snapshot: mutating a result cannot alter the next run", () => {
    const br = brief("objective-em1i", ["general"], [spec("a", { spans: [{ byte_start: 0, byte_end: 10 }] })]);
    const first = planCase({ briefForPin: br }).out;
    assert.equal(first.status, "PLANNED");
    const canon1 = canonicalJson(first);
    // Hostile caller mutation of the returned object.
    first.nodes[0].evidence.push({ kind: "forged" });
    first.nodes[0].evidence[1].citation.quoted_span = "MUTATED";
    first.status = "MUTATED";
    const second = planCase({ briefForPin: br }).out;
    assert.equal(canonicalJson(second), canon1, "re-run is byte-identical: returned objects are detached");
  });
});

/* ---------------- EM-002: approval target/authenticated binding ---------------- */

function approvalFor(br, path, o = {}) {
  const blob = gitBlobSha1(canonicalJson(br));
  const commit = commitFor(path);
  const scopes = o.scopes ?? ["financial"];
  const actions = o.actions ?? ["process_payment"];
  return {
    record_id: o.record_id ?? "appr-em2",
    issuer: o.issuer ?? "jason",
    subject_ref:
      o.subject_ref !== undefined
        ? o.subject_ref
        : { repo: REPO, path, commit, blob, algorithm: "git-sha1", revision: "fixture-main" },
    resource: path,
    scope_ids: scopes,
    action_ids: actions,
    valid_from: "2026-01-01T00:00:00Z",
    expires_at: "2027-01-01T00:00:00Z",
    revoked: false,
    nonce: "nonce-em2",
    source_ref: {
      repo: "forge-fixture-trust",
      path: "approvals/registry.md",
      commit: commitFor("approvals"),
      blob: gitBlobSha1("fixture-approvals"),
      algorithm: "git-sha1",
      revision: "fixture-main",
    },
    brief_blob: o.brief_blob ?? blob,
    approved_scope_ids: o.approvedScopes ?? scopes,
    approved_action_ids: o.approvedActions ?? actions,
    authority_origin: o.origin ?? o.issuer ?? "jason",
    relay_record_id: o.relay ?? null,
  };
}

function restrictedBrief() {
  return brief("objective-em2", ["financial"], [spec("f1", { title: "Move money", actions: ["process_payment"] })]);
}

function blockedApprovalCodes(out) {
  const nodes = out.nodes.filter((n) => n.local_key !== "__missing_source__");
  return { status: out.status, codes: diagCodes(out), nodeCodes: nodes.map((n) => n.blocking_codes.slice().sort()) };
}

describe("EM-002 approval target and authenticated binding", () => {
  it("wrong subject repo fails closed (TARGET_MISMATCH)", () => {
    const br = restrictedBrief();
    const path = "commands/chatgpt/brief-em2a.md";
    const appr = approvalFor(br, path, {
      subject_ref: { repo: "other-repo", path, commit: commitFor(path), blob: gitBlobSha1(canonicalJson(br)), algorithm: "git-sha1", revision: "fixture-main" },
    });
    const { out } = planCase({ briefForPin: br, path, approvals: [appr] });
    const r = blockedApprovalCodes(out);
    assert.equal(r.status, "BLOCKED");
    assert.ok(r.codes.includes("TARGET_MISMATCH"), `codes: ${r.codes}`);
    assert.ok(r.nodeCodes.every((c) => c.includes("APPROVAL_REQUIRED") && c.includes("TARGET_MISMATCH")));
  });

  it("same blob/path in another repo cannot reuse the approval", () => {
    const br = restrictedBrief();
    const path = "commands/chatgpt/brief-em2b.md";
    const appr = approvalFor(br, path); // subject bound to forge-fixture-briefs
    const { out } = planCase({ briefForPin: br, path, refOver: { repo: "other-repo" }, approvals: [appr] });
    const r = blockedApprovalCodes(out);
    assert.equal(r.status, "BLOCKED");
    assert.ok(r.codes.includes("TARGET_MISMATCH"), `codes: ${r.codes}`);
  });

  it("cross-head subject (different commit) fails closed", () => {
    const br = restrictedBrief();
    const path = "commands/chatgpt/brief-em2c.md";
    const appr = approvalFor(br, path, {
      subject_ref: { repo: REPO, path, commit: "0".repeat(40), blob: gitBlobSha1(canonicalJson(br)), algorithm: "git-sha1", revision: "fixture-main" },
    });
    const { out } = planCase({ briefForPin: br, path, approvals: [appr] });
    assert.ok(blockedApprovalCodes(out).codes.includes("TARGET_MISMATCH"));
  });

  it("missing subject_ref fails closed (AUTH_UNVERIFIED)", () => {
    const br = restrictedBrief();
    const path = "commands/chatgpt/brief-em2d.md";
    const appr = approvalFor(br, path, { subject_ref: null });
    const { out } = planCase({ briefForPin: br, path, approvals: [appr] });
    assert.ok(blockedApprovalCodes(out).codes.includes("AUTH_UNVERIFIED"));
  });

  it("contradictory supplemental permission sets fail closed (AUTH_CONTRADICTORY)", () => {
    const br = restrictedBrief();
    const path = "commands/chatgpt/brief-em2e.md";
    const appr = approvalFor(br, path, { approvedScopes: ["financial", "tenant"] });
    const { out } = planCase({ briefForPin: br, path, approvals: [appr] });
    assert.ok(blockedApprovalCodes(out).codes.includes("AUTH_CONTRADICTORY"));
  });

  it("absent relay registration fails closed (RELAY_UNREGISTERED)", () => {
    const br = restrictedBrief();
    const path = "commands/chatgpt/brief-em2f.md";
    const appr = approvalFor(br, path, { issuer: "authorized_muse_relay", origin: "authorized_muse_relay", relay: "relay-99" });
    const { out } = planCase({ briefForPin: br, path, approvals: [appr], relays: [] });
    assert.ok(blockedApprovalCodes(out).codes.includes("RELAY_UNREGISTERED"));
  });

  it("revoked relay registration fails closed", () => {
    const br = restrictedBrief();
    const path = "commands/chatgpt/brief-em2g.md";
    const appr = approvalFor(br, path, { issuer: "authorized_muse_relay", origin: "authorized_muse_relay", relay: "relay-1" });
    const relays = [{ relay_record_id: "relay-1", registered_by: "jason", valid_from: "2026-01-01T00:00:00Z", expires_at: "2027-01-01T00:00:00Z", revoked: true }];
    const { out } = planCase({ briefForPin: br, path, approvals: [appr], relays });
    assert.ok(blockedApprovalCodes(out).codes.includes("RELAY_UNREGISTERED"));
  });

  it("valid jason approval verifies (positive)", () => {
    const br = restrictedBrief();
    const path = "commands/chatgpt/brief-em2h.md";
    const appr = approvalFor(br, path, { record_id: "appr-ok" });
    const { out } = planCase({ briefForPin: br, path, approvals: [appr] });
    assert.equal(out.status, "PLANNED");
    assert.equal(out.planning_state, "approval_verified");
    assert.equal(out.approval_ref.record_id, "appr-ok");
    assert.ok(diagCodes(out).includes("APPROVAL_VERIFIED"));
    assert.ok(out.nodes.every((n) => n.routing_clearance === "simulated_approved"));
  });

  it("valid authorized-relay approval with a registered relay verifies (positive)", () => {
    const br = restrictedBrief();
    const path = "commands/chatgpt/brief-em2i.md";
    const appr = approvalFor(br, path, { record_id: "appr-relay-ok", issuer: "authorized_muse_relay", origin: "authorized_muse_relay", relay: "relay-1" });
    const relays = [{ relay_record_id: "relay-1", registered_by: "jason", valid_from: "2026-01-01T00:00:00Z", expires_at: "2027-01-01T00:00:00Z", revoked: false }];
    const { out } = planCase({ briefForPin: br, path, approvals: [appr], relays });
    assert.equal(out.status, "PLANNED");
    assert.equal(out.planning_state, "approval_verified");
  });

  it("relay registration with a rollover date (2026-02-30) fails closed", () => {
    const br = restrictedBrief();
    const path = "commands/chatgpt/brief-em2k.md";
    const appr = approvalFor(br, path, { issuer: "authorized_muse_relay", origin: "authorized_muse_relay", relay: "relay-x" });
    const relays = [{
      relay_record_id: "relay-x",
      registered_by: "jason",
      valid_from: "2026-02-30T00:00:00Z", // impossible date: must not authenticate
      expires_at: "2027-01-01T00:00:00Z",
      revoked: false,
    }];
    const { out } = planCase({ briefForPin: br, path, approvals: [appr], relays });
    const r = blockedApprovalCodes(out);
    assert.equal(r.status, "BLOCKED");
    assert.ok(r.codes.includes("RELAY_UNREGISTERED"), `codes: ${r.codes}`);
  });

  it("relay registration with a missing revoked field fails closed", () => {
    const br = restrictedBrief();
    const path = "commands/chatgpt/brief-em2l.md";
    const appr = approvalFor(br, path, { issuer: "authorized_muse_relay", origin: "authorized_muse_relay", relay: "relay-x" });
    const relays = [{
      relay_record_id: "relay-x",
      registered_by: "jason",
      valid_from: "2026-01-01T00:00:00Z",
      expires_at: "2027-01-01T00:00:00Z",
      // no revoked field: must never default to unrevoked
    }];
    const { out } = planCase({ briefForPin: br, path, approvals: [appr], relays });
    assert.ok(blockedApprovalCodes(out).codes.includes("RELAY_UNREGISTERED"));
  });

  it("relay registration with an unknown control field fails closed", () => {
    const br = restrictedBrief();
    const path = "commands/chatgpt/brief-em2m.md";
    const appr = approvalFor(br, path, { issuer: "authorized_muse_relay", origin: "authorized_muse_relay", relay: "relay-x" });
    const relays = [{
      relay_record_id: "relay-x",
      registered_by: "jason",
      valid_from: "2026-01-01T00:00:00Z",
      expires_at: "2027-01-01T00:00:00Z",
      revoked: false,
      extra_control: "smuggled",
    }];
    const { out } = planCase({ briefForPin: br, path, approvals: [appr], relays });
    assert.ok(blockedApprovalCodes(out).codes.includes("RELAY_UNREGISTERED"));
  });

  it("duplicate conflicting registration IDs fail closed", () => {
    const br = restrictedBrief();
    const path = "commands/chatgpt/brief-em2n.md";
    const appr = approvalFor(br, path, { issuer: "authorized_muse_relay", origin: "authorized_muse_relay", relay: "relay-x" });
    const relays = [
      { relay_record_id: "relay-x", registered_by: "jason", valid_from: "2026-01-01T00:00:00Z", expires_at: "2027-01-01T00:00:00Z", revoked: false },
      { relay_record_id: "relay-x", registered_by: "mallory", valid_from: "2026-01-01T00:00:00Z", expires_at: "2027-01-01T00:00:00Z", revoked: false },
    ];
    const { out } = planCase({ briefForPin: br, path, approvals: [appr], relays });
    assert.ok(blockedApprovalCodes(out).codes.includes("RELAY_UNREGISTERED"));
  });

  it("relay registration outside the clock window fails closed", () => {
    const br = restrictedBrief();
    const path = "commands/chatgpt/brief-em2o.md";
    const appr = approvalFor(br, path, { issuer: "authorized_muse_relay", origin: "authorized_muse_relay", relay: "relay-x" });
    const relays = [{
      relay_record_id: "relay-x",
      registered_by: "jason",
      valid_from: "2027-01-01T00:00:00Z",
      expires_at: "2028-01-01T00:00:00Z",
      revoked: false,
    }];
    const { out } = planCase({ briefForPin: br, path, approvals: [appr], relays });
    assert.ok(blockedApprovalCodes(out).codes.includes("RELAY_UNREGISTERED"));
  });

  it("host revalidation rejects a changed target (approval for brief A, planning brief B)", () => {
    const briefA = brief("objective-em2j", ["financial"], [spec("f1", { title: "Move money A", actions: ["process_payment"] })]);
    const briefB = brief("objective-em2j", ["financial"], [spec("f1", { title: "Move money B", actions: ["process_payment"] })]);
    const path = "commands/chatgpt/brief-em2j.md";
    const appr = approvalFor(briefA, path, { record_id: "appr-a" });
    const { out } = planCase({ briefForPin: briefB, path, approvals: [appr] });
    const r = blockedApprovalCodes(out);
    assert.equal(r.status, "BLOCKED");
    assert.ok(r.codes.includes("TARGET_MISMATCH") || r.codes.includes("STALE_APPROVAL"), `codes: ${r.codes}`);
  });
});

/* ---------------- EM-003: duplicate keys invalidate the graph ---------------- */

describe("EM-003 duplicate local keys", () => {
  function dupResult(specs) {
    const br = brief("objective-em3", ["general"], specs);
    return planCase({ briefForPin: br });
  }

  it("duplicates with different actions block every node (no first-wins PLANNED)", () => {
    const { out } = dupResult([
      spec("d", { actions: ["draft_plan"] }),
      spec("d", { title: "Second d", actions: ["send_tenant_notice"] }),
      spec("e", { deps: ["d"] }),
    ]);
    assert.equal(out.status, "BLOCKED");
    assert.equal(out.nodes.length, 2);
    assert.ok(out.nodes.every((n) => n.state === "BLOCKED"), "every retained node is blocked");
    assert.ok(out.nodes.every((n) => n.blocking_codes.includes("DUPLICATE_LOCAL_KEY")));
    assert.ok(diagCodes(out).includes("DUPLICATE_LOCAL_KEY"));
    assert.ok(out.nodes.every((n) => n.routing_clearance === "unapproved"), "no simulated clearance");
  });

  it("duplicates with different dependencies block every node", () => {
    const { out } = dupResult([
      spec("d", { deps: [] }),
      spec("d", { title: "Second d", deps: ["e"] }),
      spec("e", {}),
    ]);
    assert.equal(out.status, "BLOCKED");
    assert.ok(out.nodes.every((n) => n.state === "BLOCKED" && n.blocking_codes.includes("DUPLICATE_LOCAL_KEY")));
  });

  it("duplicates with different external gates block every node", () => {
    const { out } = dupResult([
      spec("d", { gates: ["ext-a"] }),
      spec("d", { title: "Second d", gates: ["ext-b"] }),
    ]);
    assert.equal(out.status, "BLOCKED");
    assert.ok(out.nodes.every((n) => n.state === "BLOCKED" && n.blocking_codes.includes("DUPLICATE_LOCAL_KEY")));
  });

  it("reversed declaration order is equally blocked (neither order yields PLANNED)", () => {
    const fwd = dupResult([spec("d", { title: "First" }), spec("d", { title: "Second" })]).out;
    const rev = dupResult([spec("d", { title: "Second" }), spec("d", { title: "First" })]).out;
    for (const out of [fwd, rev]) {
      assert.equal(out.status, "BLOCKED");
      assert.ok(out.nodes.every((n) => n.state === "BLOCKED" && n.blocking_codes.includes("DUPLICATE_LOCAL_KEY")));
    }
  });
});

/* ---------------- EM-004: semantic conflict comparison ---------------- */

describe("EM-004 canonical semantic task-spec comparison", () => {
  function conflictCase(mutator) {
    const main = spec("k", { title: "Build it", owner: "muse", actions: ["draft_plan"], deps: [], gates: ["ext-a"] });
    const relSpec = mutator(
      spec("k", { title: "Build it", owner: "muse", actions: ["draft_plan"], deps: [], gates: ["ext-a"] })
    );
    const br = brief("objective-em4", ["general"], [main]);
    const rbr = brief("objective-em4-rel", ["general"], [relSpec]);
    return planCase({
      briefForPin: br,
      path: "commands/chatgpt/brief-em4.md",
      related: [{ path: "commands/chatgpt/brief-em4-rel.md", brief: rbr }],
    });
  }

  function expectConflict(out, field) {
    assert.equal(out.status, "BLOCKED");
    const node = out.nodes.find((n) => n.local_key === "k");
    assert.equal(node.state, "BLOCKED");
    assert.ok(node.blocking_codes.includes("CONFLICTING_SPEC"));
    assert.ok(diagCodes(out).includes("CONFLICTING_SPEC"));
    const conflict = out.conflicts.find((c) => c.local_key === "k");
    assert.ok(conflict, "conflict record exists");
    assert.ok(conflict.fields.includes(field), `conflict fields ${conflict.fields} include ${field}`);
    assert.equal(conflict.brief_refs.length, 2, "conflict links both brief refs as evidence");
  }

  it("owner conflict blocks", () => {
    expectConflict(conflictCase((s) => ({ ...s, owner_proposal: "claude" })).out, "owner_proposal");
  });

  it("action_ids conflict blocks", () => {
    expectConflict(conflictCase((s) => ({ ...s, action_ids: ["send_tenant_notice"] })).out, "action_ids");
  });

  it("dependency_keys conflict blocks", () => {
    const { out } = planCase({
      briefForPin: brief("objective-em4d", ["general"], [spec("k", {}), spec("j", {})]),
      path: "commands/chatgpt/brief-em4d.md",
      related: [{
        path: "commands/chatgpt/brief-em4d-rel.md",
        brief: brief("objective-em4d-rel", ["general"], [spec("k", { deps: ["j"] }), spec("j", {})]),
      }],
    });
    expectConflict(out, "dependency_keys");
  });

  it("acceptance expected conflict blocks", () => {
    expectConflict(
      conflictCase((s) => ({ ...s, acceptance_checks: [{ check_id: "k-ac1", expected: "partial", evidence_kind: "fixture_record" }] })).out,
      "acceptance_checks"
    );
  });

  it("acceptance evidence_kind conflict blocks", () => {
    expectConflict(
      conflictCase((s) => ({ ...s, acceptance_checks: [{ check_id: "k-ac1", expected: "complete", evidence_kind: "other_kind" }] })).out,
      "acceptance_checks"
    );
  });

  it("external gate conflict blocks", () => {
    expectConflict(conflictCase((s) => ({ ...s, external_gate_ids: ["ext-b"] })).out, "external_gate_ids");
  });

  it("equivalent reordered sets do not conflict (positive)", () => {
    const main = spec("k", {
      title: "Build it",
      actions: ["b-act", "a-act"],
      checks: [
        { check_id: "k-2", expected: "complete", evidence_kind: "fixture_record" },
        { check_id: "k-1", expected: "complete", evidence_kind: "fixture_record" },
      ],
      gates: ["ext-b", "ext-a"],
    });
    const relSpec = spec("k", {
      title: "Build it",
      actions: ["a-act", "b-act"],
      checks: [
        { check_id: "k-1", expected: "complete", evidence_kind: "fixture_record" },
        { check_id: "k-2", expected: "complete", evidence_kind: "fixture_record" },
      ],
      gates: ["ext-a", "ext-b"],
    });
    const br = brief("objective-em4p", ["general"], [main]);
    const rbr = brief("objective-em4p-rel", ["general"], [relSpec]);
    const { out } = planCase({
      briefForPin: br,
      path: "commands/chatgpt/brief-em4p.md",
      related: [{ path: "commands/chatgpt/brief-em4p-rel.md", brief: rbr }],
    });
    assert.equal(out.status, "PLANNED");
    assert.equal(out.conflicts.length, 0);
    assert.ok(!diagCodes(out).includes("CONFLICTING_SPEC"));
  });

  it("unverifiable related source yields explicit uncertainty, not silent success", () => {
    const br = brief("objective-em4u", ["general"], [spec("k", {})]);
    const rbr = brief("objective-em4u-rel", ["general"], [spec("k", { title: "Different" })]);
    const { out } = planCase({
      briefForPin: br,
      path: "commands/chatgpt/brief-em4u.md",
      related: [{ path: "commands/chatgpt/brief-em4u-rel.md", brief: rbr, refOver: { blob: "0".repeat(40) } }],
    });
    // The related pin is forged: the source cannot be verified, so conflict
    // coverage is explicitly incomplete — but the primary brief itself plans.
    assert.equal(out.status, "PLANNED");
    assert.ok(diagCodes(out).includes("RELATED_SOURCE_UNVERIFIED"));
    assert.ok(
      out.nodes.every((n) => n.uncertainty_flags.includes("UNRESOLVED_RELATED_SOURCE")),
      "uncertainty is explicit on every node"
    );
    assert.ok(!diagCodes(out).includes("CONFLICTING_SPEC"));
    assert.equal(out.complete, false, "public complete reflects unresolved related coverage");
  });

  it("hash-mismatched related source marks coverage incomplete (complete:false)", () => {
    const br = brief("objective-em4v", ["general"], [spec("k", {})]);
    const rbr = brief("objective-em4v-rel", ["general"], [spec("k", {})]);
    const { out } = planCase({
      briefForPin: br,
      path: "commands/chatgpt/brief-em4v.md",
      related: [{ path: "commands/chatgpt/brief-em4v-rel.md", brief: rbr, storeBrief: brief("objective-em4v-rel", ["general"], [spec("k", { title: "Tampered" })]) }],
    });
    assert.equal(out.status, "PLANNED");
    assert.ok(diagCodes(out).includes("RELATED_SOURCE_UNVERIFIED"));
    assert.equal(out.complete, false, "changed related bytes under the pin are incomplete coverage");
  });

  it("resolvable related brief with no conflicts stays complete:true", () => {
    const br = brief("objective-em4w", ["general"], [spec("k", {})]);
    const rbr = brief("objective-em4w-rel", ["general"], [spec("k", {})]);
    const { out } = planCase({
      briefForPin: br,
      path: "commands/chatgpt/brief-em4w.md",
      related: [{ path: "commands/chatgpt/brief-em4w-rel.md", brief: rbr }],
    });
    assert.equal(out.status, "PLANNED");
    assert.ok(!diagCodes(out).includes("RELATED_SOURCE_UNVERIFIED"));
    assert.equal(out.complete, true, "fully resolved coverage is complete");
  });
});

/* ---------------- EM-005: budgets and the host watchdog ---------------- */

describe("EM-005 scoped budgets (exact limit / limit+1)", () => {
  it("related sources: 62 resolve within the 64-object budget, the 63rd exceeds it", () => {
    // Object budget: 1 (primary brief) + 1 (owner registry, one consulted
    // store object) + 1 per related brief = 64 at 62 related sources.
    const mkRelated = (n) =>
      Array.from({ length: n }, (_, i) => ({
        path: `commands/chatgpt/brief-em5r-${i}.md`,
        brief: brief(`objective-em5r-${i}`, ["general"], [spec(`rk${i}`, { title: `Related ${i}` })]),
      }));
    const br = brief("objective-em5s", ["general"], [spec("a", {})]);
    const okOut = planCase({ briefForPin: br, path: "commands/chatgpt/brief-em5s.md", related: mkRelated(62) }).out;
    assert.equal(okOut.status, "PLANNED", `62 related sources must plan, got ${okOut.status}`);
    const overOut = planCase({ briefForPin: br, path: "commands/chatgpt/brief-em5s.md", related: mkRelated(63) }).out;
    assert.equal(overOut.status, "REFUSED");
    assert.ok(diagCodes(overOut).includes("BUDGET_EXCEEDED"), `codes: ${diagCodes(overOut)}`);
    assert.equal(overOut.complete, false, "no partial success on exhaustion");
  });

  it("approval records: 62 inspected within budget, the 63rd exceeds it", () => {
    // Object budget: 1 (primary brief) + 1 (owner registry) + 1 per
    // inspected approval record = 64 at 62 records.
    const br = restrictedBrief();
    const path = "commands/chatgpt/brief-em5t.md";
    const mkApprovals = (n) =>
      Array.from({ length: n }, (_, i) => approvalFor(br, path, { record_id: `appr-bad-${i}`, issuer: "mallory", origin: "jason" }));
    // 62 invalid records: every record is inspected and budgeted, then the
    // plan is blocked for lack of a valid approval (not refused).
    const okOut = planCase({ briefForPin: br, path, approvals: mkApprovals(62) }).out;
    assert.equal(okOut.status, "BLOCKED", `62 records must block (not refuse), got ${okOut.status}`);
    assert.ok(diagCodes(okOut).includes("AUTH_UNVERIFIED"));
    const overOut = planCase({ briefForPin: br, path, approvals: mkApprovals(63) }).out;
    assert.equal(overOut.status, "REFUSED");
    assert.ok(diagCodes(overOut).includes("BUDGET_EXCEEDED"), `codes: ${diagCodes(overOut)}`);
    assert.equal(overOut.complete, false, "no partial success on exhaustion");
  });

  it("metadata: owner registry at exactly the input byte limit plans, one entry more refuses", () => {
    const br = brief("objective-em5m", ["general"], [spec("a", {})]);
    // Measure the fixed task+brief bytes, then solve for the owner count
    // that lands exactly at / just over the 256 KiB input budget.
    const probe = planCase({ briefForPin: br, path: "commands/chatgpt/brief-em5m.md", owners: ["muse"] });
    const fixed = Buffer.byteLength(canonicalJson(probe.task), "utf8") + Buffer.byteLength(canonicalJson(br), "utf8");
    const LIMIT = 256 * 1024;
    const ownersBytes = (m) => Buffer.byteLength(canonicalJson(["muse", ...Array.from({ length: m - 1 }, (_, i) => "o".repeat(60) + String(i).padStart(4, "0") )]), "utf8");
    let m = 1;
    while (fixed + ownersBytes(m + 1) <= LIMIT) m++;
    assert.ok(fixed + ownersBytes(m) <= LIMIT && fixed + ownersBytes(m + 1) > LIMIT, "test boundary is exact");
    const mkOwners = (n) => ["muse", ...Array.from({ length: n - 1 }, (_, i) => "o".repeat(60) + String(i).padStart(4, "0"))];
    const okOut = planCase({ briefForPin: br, path: "commands/chatgpt/brief-em5m.md", owners: mkOwners(m) }).out;
    assert.equal(okOut.status, "PLANNED", `metadata at exactly the limit must plan, got ${okOut.status}`);
    const overOut = planCase({ briefForPin: br, path: "commands/chatgpt/brief-em5m.md", owners: mkOwners(m + 1) }).out;
    assert.equal(overOut.status, "REFUSED");
    assert.ok(diagCodes(overOut).includes("INPUT_LIMIT"), `codes: ${diagCodes(overOut)}`);
  });

  it("complete output: exactly 256 records plans, 257 refuses (OUTPUT_LIMIT)", () => {
    // N-node chain with M empty acceptance gates:
    // records = N nodes + (N-1) edges + M diagnostics.
    const mkBrief = (m) => {
      const specs = [];
      for (let i = 0; i < 100; i++) {
        specs.push(spec(`n${i}`, { deps: i === 0 ? [] : [`n${i - 1}`], checks: i < m ? [] : undefined }));
      }
      return brief("objective-em5o", ["general"], specs);
    };
    const atLimit = planCase({ briefForPin: mkBrief(57), path: "commands/chatgpt/brief-em5o.md" }).out;
    assert.equal(100 + 99 + 57, 256);
    assert.notEqual(atLimit.status, "REFUSED", `256 output records must not refuse, got ${atLimit.status}`);
    assert.equal(atLimit.complete, true);
    const over = planCase({ briefForPin: mkBrief(58), path: "commands/chatgpt/brief-em5o.md" }).out;
    assert.equal(over.status, "REFUSED");
    assert.ok(diagCodes(over).includes("OUTPUT_LIMIT"), `codes: ${diagCodes(over)}`);
    assert.equal(over.complete, false, "no partial success on exhaustion");
    assert.equal(over.nodes.length, 0);
  });

  it("missing-source refusals are output-budget checked (no bypass)", () => {
    const ref = briefRef("commands/chatgpt/brief-em5x.md", brief("objective-em5x", ["general"], [spec("a", {})]));
    const task = {
      brief_ref: ref,
      objective_id: "objective-em5x",
      constraints: stdConstraints(),
      requested_action: "plan",
      related_brief_refs: [],
    };
    // empty store: SOURCE_UNVERIFIED refusal still carries a counted envelope
    const out = run(task, { clock: CLOCK, briefs: {}, approvals: [], owners: OWNERS, relays: [] });
    assert.equal(out.status, "BLOCKED");
    assert.ok(diagCodes(out).includes("SOURCE_UNVERIFIED"));
    assert.equal(out.complete, true);
  });

  it("relay registry: consulted relay bytes at exactly the input cap plan, one byte more refuses", () => {
    const LIMIT = 256 * 1024;
    const br = restrictedBrief();
    const path = "commands/chatgpt/brief-em5u.md";
    const mkRelays = (pad) => [
      { relay_record_id: "relay-1", registered_by: "jason", valid_from: "2026-01-01T00:00:00Z", expires_at: "2027-01-01T00:00:00Z", revoked: false },
      { relay_record_id: "relay-pad", padding: "x".repeat(pad) },
    ];
    const mkAppr = () => [approvalFor(br, path, { record_id: "appr-relay-cap", issuer: "authorized_muse_relay", origin: "authorized_muse_relay", relay: "relay-1" })];
    const inputBytesOf = (relays, owners) => {
      const ref = briefRef(path, br);
      const task = { brief_ref: ref, objective_id: br.objective_id, constraints: stdConstraints(), requested_action: "plan", related_brief_refs: [] };
      const briefs = {};
      briefs[briefKey(ref)] = { brief: br, blob: ref.blob };
      const context = { clock: CLOCK, briefs, approvals: mkAppr(), owners, relays };
      return buildPlan(task, context).budget.inputBytes;
    };
    // Charging model: each pad char costs exactly 2 counted bytes — once in
    // the registry-envelope read, once in the per-record read. An odd slack
    // is finished with one owner-registry char (counted once).
    const base = inputBytesOf(mkRelays(0), OWNERS);
    const slack = LIMIT - base;
    assert.ok(slack >= 0, "base input must fit within the cap");
    const pad = Math.floor(slack / 2);
    const oddOwners = slack % 2 === 1 ? [...OWNERS, "z"] : OWNERS;
    assert.equal(inputBytesOf(mkRelays(pad), oddOwners), LIMIT, "input lands exactly on the cap");
    const atOut = planCase({ briefForPin: br, path, approvals: mkAppr(), relays: mkRelays(pad), owners: oddOwners }).out;
    assert.equal(atOut.status, "PLANNED", `relay bytes exactly at the cap must plan, got ${atOut.status}`);
    assert.equal(atOut.planning_state, "approval_verified");
    // One more byte anywhere in the consulted relay input refuses.
    const overOut = planCase({ briefForPin: br, path, approvals: mkAppr(), relays: mkRelays(pad + 1), owners: oddOwners }).out;
    assert.equal(overOut.status, "REFUSED");
    assert.ok(diagCodes(overOut).includes("INPUT_LIMIT"), `codes: ${diagCodes(overOut)}`);
    assert.equal(overOut.complete, false, "no partial success on exhaustion");
  });

  it("final output envelope: exactly at the byte cap plans, one byte more refuses (OUTPUT_LIMIT)", () => {
    const LIMIT = 256 * 1024;
    const N = 64;
    const PATH = "commands/chatgpt/brief-em5v.md";
    const mkBrief = (len, tune = "") => {
      const specs = [];
      for (let i = 0; i < N; i++) {
        specs.push(
          spec(`z${i}`, {
            title: `Node ${i}${i === 0 ? tune : ""}`,
            checks: [{ check_id: `z${i}-ac1`, expected: "x".repeat(len), evidence_kind: "fixture_record" }],
          })
        );
      }
      return brief("objective-em5v", ["general"], specs);
    };
    // Measure the EXACT final public envelope (planner payload + envelope
    // fields) without the cap, via buildPlan + the same envelope math as
    // run(). buildPlan throwing (input cap) counts as over.
    const probeBytes = (len, tune = "") => {
      const b = mkBrief(len, tune);
      const ref = briefRef(PATH, b);
      const task = { brief_ref: ref, objective_id: b.objective_id, constraints: stdConstraints(), requested_action: "plan", related_brief_refs: [] };
      const briefs = {};
      briefs[briefKey(ref)] = { brief: b, blob: ref.blob };
      const context = { clock: CLOCK, briefs, approvals: [], owners: OWNERS, relays: [] };
      try {
        const { payload } = buildPlan(task, context);
        const tid = "em-" + createHash("sha256").update(canonicalJson(task), "utf8").digest("hex").slice(0, 16);
        const result = {
          schema_version: "1", agent: "engineering-manager", task_id: tid,
          advisory: true, fixture_only: true, source_refs: [{ ...task.brief_ref }], ...payload,
        };
        return Buffer.byteLength(canonicalJson(result), "utf8");
      } catch {
        return Infinity;
      }
    };
    let lo = 0;
    let hi = 1;
    while (probeBytes(hi) <= LIMIT) hi *= 2;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (probeBytes(mid) <= LIMIT) lo = mid;
      else hi = mid - 1;
    }
    const L = lo;
    const atBytes = probeBytes(L);
    assert.ok(atBytes <= LIMIT, "binary search lands at or under the cap");
    assert.ok(probeBytes(L + 1) > LIMIT, "one more char per node exceeds the cap");
    // Fine-tune a single title (each char is 1 output byte, well under the
    // 512-char title cap) to land EXACTLY on the cap.
    const tune = "t".repeat(LIMIT - atBytes);
    assert.ok(tune.length < 64, "tune-up stays within one node's granularity");
    const exactOut = planCase({ briefForPin: mkBrief(L, tune), path: PATH }).out;
    assert.equal(probeBytes(L, tune), LIMIT, "final envelope is exactly 256 KiB");
    assert.equal(exactOut.status, "PLANNED", `envelope exactly at the cap must plan, got ${exactOut.status}`);
    assert.equal(exactOut.complete, true);
    // One more byte: a small complete:false refusal with no domain success.
    const overOut = planCase({ briefForPin: mkBrief(L, tune + "t"), path: PATH }).out;
    assert.equal(overOut.status, "REFUSED");
    assert.ok(diagCodes(overOut).includes("OUTPUT_LIMIT"), `codes: ${diagCodes(overOut)}`);
    assert.equal(overOut.complete, false, "no domain success on exhaustion");
    assert.equal(overOut.nodes.length, 0);
    assert.ok(Buffer.byteLength(canonicalJson(overOut), "utf8") < 2048, "the refusal itself is small");
  });
});
