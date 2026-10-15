/**
 * resolver.js — bounded fixture resolver with task budgets.
 *
 * All fixture reads go through this module. It enforces the common caps:
 * 256 KiB total input, 64 source objects, 512 evidence spans, 256 output
 * records, 256 KiB output, and a 5-second host watchdog handled by the test
 * harness. Budget exhaustion fails closed — never a partial ALLOWED.
 */

import { canonicalByteLength, gitBlobSha1Hex } from "./canonical.js";

export const BUDGET_LIMITS = {
  maxInputBytes: 256 * 1024,
  maxOutputBytes: 256 * 1024,
  maxSourceObjects: 64,
  maxSpans: 512,
  maxOutputRecords: 256,
  watchdogMs: 5000,
};

export class BudgetError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "BudgetError";
    this.code = code;
  }
}

export function makeBudget() {
  const b = {
    bytesIn: 0,
    objects: 0,
    contextObjects: 0,
    spans: 0,
    // GOV-003: every SourceRef verified through resolveSourceRef is recorded
    // here so the output envelope can cite the exact consulted sources.
    // Quarantined sources are dropped and never listed. The full six-field
    // common SourceRef identity {repo,path,commit,blob,algorithm,revision}
    // is preserved — truncating to four fields breaks the fixture
    // revision/algorithm binding required by the provenance contract.
    sourceRefs: new Map(),
    noteSourceRef(sr) {
      const key = `${sr.repo}|${sr.path}|${sr.commit}|${sr.blob}|${sr.algorithm}|${sr.revision}`;
      if (!this.sourceRefs.has(key)) {
        this.sourceRefs.set(key, {
          repo: sr.repo, path: sr.path, commit: sr.commit,
          blob: sr.blob, algorithm: sr.algorithm, revision: sr.revision,
        });
      }
    },
    dropSourceRef(sr) {
      this.sourceRefs.delete(`${sr.repo}|${sr.path}|${sr.commit}|${sr.blob}|${sr.algorithm}|${sr.revision}`);
    },
    listedSourceRefs() {
      return [...this.sourceRefs.values()].sort((a, b) =>
        a.repo < b.repo ? -1 : a.repo > b.repo ? 1 :
        a.path < b.path ? -1 : a.path > b.path ? 1 :
        a.commit < b.commit ? -1 : a.commit > b.commit ? 1 :
        a.blob < b.blob ? -1 : a.blob > b.blob ? 1 :
        a.algorithm < b.algorithm ? -1 : a.algorithm > b.algorithm ? 1 :
        a.revision < b.revision ? -1 : a.revision > b.revision ? 1 : 0
      );
    },
    countPayload(value, label) {
      const n = canonicalByteLength(value);
      this.bytesIn += n;
      if (this.bytesIn > BUDGET_LIMITS.maxInputBytes) {
        throw new BudgetError("INPUT_LIMIT", `${label} exceeds the 256 KiB input budget`);
      }
      return n;
    },
    countObject(label) {
      this.objects += 1;
      if (this.objects > BUDGET_LIMITS.maxSourceObjects) {
        throw new BudgetError("BUDGET_EXCEEDED", `object-resolution budget exceeded resolving ${label}`);
      }
    },
    countSpans(n, label) {
      this.spans += n;
      if (this.spans > BUDGET_LIMITS.maxSpans) {
        throw new BudgetError("BUDGET_EXCEEDED", `span budget exceeded checking ${label}`);
      }
    },
    countContextObjects(counts) {
      this.contextObjects +=
        (counts.principals?.length ?? 0) +
        (counts.policies?.length ?? 0) +
        (counts.registrations?.length ?? 0) +
        (counts.verdicts?.length ?? 0) +
        (counts.agreements?.length ?? 0) +
        (counts.relays?.length ?? 0) +
        (counts.heads?.length ?? 0) +
        (counts.blobs ?? 0) +
        (counts.evidence ?? 0);
      if (this.contextObjects > BUDGET_LIMITS.maxSourceObjects * 64) {
        throw new BudgetError("BUDGET_EXCEEDED", "context carries more trusted records than the fixture budget allows");
      }
    },
  };
  return b;
}

/** Read grant check: repo/path must be allowlisted in context.readGrants. */
export function checkGrant(ctx, repo, path) {
  return ctx.readGrants.some((g) => g.repo === repo && g.path === path);
}

/**
 * Resolve a SourceRef through the isolated fixture Git store. Verifies:
 * the blob entry exists for repo/path@commit, the recomputed Git blob
 * SHA-1 equals the pinned blob, and the read is grant-covered.
 */
export function resolveSourceRef(ctx, budget, sr) {
  const key = `${sr.repo}|${sr.path}|${sr.commit}`;
  budget.countObject(`source ${key}`);
  const entry = ctx.blobs[key];
  if (!entry) {
    return { ok: false, code: "SOURCE_UNVERIFIED", reason: `no fixture blob for ${key}` };
  }
  if (!checkGrant(ctx, sr.repo, sr.path)) {
    return { ok: false, code: "READ_DENIED", reason: `no read grant for ${sr.repo}/${sr.path}` };
  }
  const recomputed = gitBlobSha1Hex(entry.content);
  if (recomputed !== sr.blob) {
    return { ok: false, code: "HASH_MISMATCH", reason: `blob SHA-1 mismatch for ${sr.repo}/${sr.path}@${sr.commit.slice(0, 8)}` };
  }
  // GOV-003: record the verified source so the envelope cites it.
  budget.noteSourceRef(sr);
  return { ok: true, content: entry.content };
}

/**
 * Verify a rule citation: span bounds inside the resolved content, quoted
 * text exactly equals the sliced bytes, and quoted_span preserves the
 * same text (single-schema field compatibility).
 */
export function verifyCitation(ctx, budget, citationDoc, ruleSpan) {
  const res = resolveSourceRef(ctx, budget, citationDoc);
  if (!res.ok) return { ok: false, code: res.code, reason: res.reason };
  budget.countSpans(1, "citation span");
  const bytes = Buffer.from(res.content, "utf8");
  const { start_byte, end_byte, quoted_text } = ruleSpan;
  if (end_byte > bytes.length) {
    return { ok: false, code: "SPAN_MISMATCH", reason: "citation span exceeds document bytes" };
  }
  const sliced = bytes.subarray(start_byte, end_byte).toString("utf8");
  if (sliced !== quoted_text) {
    return { ok: false, code: "SPAN_MISMATCH", reason: "citation quoted text does not match document bytes at span" };
  }
  return {
    ok: true,
    citation: {
      ...citationDoc,
      quoted_span: quoted_text,
      span: { start_byte, end_byte, quoted_text },
      verification: "VERIFIED",
    },
  };
}
