/**
 * retriever.js — extractive claim retrieval for the knowledge-vault
 * prototype.
 *
 * Source facts are derived by parsing source bytes against a bounded
 * exact-text fixture grammar — a candidate's own metadata is never
 * trusted as truth. Claims are returned as exact quoted extracts with
 * source attribution, never invented prose. Every selected source and
 * span is re-verified on every answer; there is no persistent cache.
 * Pure Node 24 ESM, zero dependencies.
 */

import { createHash } from "node:crypto";
import { sha256HexUtf8 } from "./canonical.js";
import { resolveSourceRef, verifySpan, hasReadGrant, ResolutionError } from "./resolver.js";
import { selectEffectiveRevision } from "./supersession.js";
import { scanSourceText } from "./injection.js";
import { isPartialCoverage } from "./vocabulary.js";

const STRICT_CLAIM_RE =
  /^claim:\s*([a-z][a-z0-9-]{0,63})\s*=\s*([^;]+?)\s*;\s*units:\s*([^;]+?)\s*;\s*scopes:\s*([a-z][a-z0-9-]*(?:\s*,\s*[a-z][a-z0-9-]*)*)\s*$/;
const DEGRADED_CLAIM_RE =
  /^claim:\s*([a-z][a-z0-9-]{0,63})\s*=\s*([^;]+?)\s*(?:;\s*scopes:\s*([a-z][a-z0-9-]*(?:\s*,\s*[a-z][a-z0-9-]*)*))?\s*$/;
const SCOPE_TOKEN_RE = /^[a-z][a-z0-9-]{0,63}$/;

/**
 * Parse source text into claim facts against the bounded exact-text
 * grammar. Returns [{claim_key, canonical_value, units, scope_ids,
 * validity:"GROUNDED"|"UNVERIFIABLE", line}]. Lines that do not parse
 * (including source-internal `supersedes:` directives) yield no facts —
 * they are never claims and never chain evidence.
 */
export function parseClaims(text) {
  const facts = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (line.trim().length === 0) continue;
    const strict = STRICT_CLAIM_RE.exec(line);
    if (strict) {
      const scopes = strict[4].split(",").map((s) => s.trim()).filter((s) => s.length > 0);
      if (scopes.length === 0 || !scopes.every((s) => SCOPE_TOKEN_RE.test(s))) continue;
      const value = strict[2].trim();
      const units = strict[3].trim();
      if (value.length === 0 || units.length === 0) continue;
      facts.push({
        claim_key: strict[1],
        canonical_value: value,
        units,
        scope_ids: scopes,
        validity: "GROUNDED",
        line,
      });
      continue;
    }
    if (line.startsWith("claim:")) {
      const degraded = DEGRADED_CLAIM_RE.exec(line);
      if (!degraded) continue; // malformed claim line: no fact
      const value = degraded[2].trim();
      if (value.length === 0) continue;
      const scopes = degraded[3]
        ? degraded[3].split(",").map((s) => s.trim()).filter((s) => s.length > 0)
        : [];
      if (!scopes.every((s) => SCOPE_TOKEN_RE.test(s))) continue;
      facts.push({
        claim_key: degraded[1],
        canonical_value: value,
        units: "unspecified",
        scope_ids: scopes,
        validity: "UNVERIFIABLE",
        line,
      });
    }
    // note:/supersedes:/other lines: no facts, never claims.
  }
  return facts;
}

/** Union of scope_ids for facts with the query_key across revisions. */
function queryScopesFor(sourceKey, query_key, ctx) {
  const entry = ctx.sources[sourceKey];
  const scopes = new Set();
  for (const commit of Object.keys(entry.revisions)) {
    const rev = entry.revisions[commit];
    if (typeof rev.text !== "string") continue;
    for (const f of parseClaims(rev.text)) {
      if (f.claim_key === query_key) for (const s of f.scope_ids) scopes.add(s);
    }
  }
  return [...scopes].sort();
}

function claimIdOf(query_key, sourceKey, commit) {
  return `claim-${createHash("sha256").update(`${query_key}${sourceKey}${commit}`, "utf8").digest("hex").slice(0, 12)}`;
}

function diagnostic(code, severity, reason, source_ref = null, record_id = null) {
  return { code, severity, source_ref, record_id, reason };
}

/**
 * Retrieve and extract claims for a mapped query_key.
 * Returns the domain payload (no outer envelope).
 */
export function retrieveAnswer({ query, query_key, matchedPhrases, task, ctx, clockMs, budget }) {
  const diagnostics = [];
  const quarantined = [];
  const stewardFlags = [];
  const supersessionNotes = [];
  const claims = [];
  const contradictions = [];

  const asOfMs = task.filters.as_of_date === null ? null : Date.parse(task.filters.as_of_date);
  const sourceKeys = Object.keys(ctx.sources).sort();

  // Explicit applicable pin (historical queries): use exactly it.
  if (task.source_pin) {
    const pin = task.source_pin;
    const key = `${pin.repo}|${pin.path}`;
    if (!ctx.sources[key]) {
      diagnostics.push(diagnostic("SOURCE_UNVERIFIED", "error", `pinned source key not registered: ${pin.repo}/${pin.path}`));
    } else if (!hasReadGrant(pin, ctx.readGrants)) {
      diagnostics.push(diagnostic("READ_DENIED", "error", `no read grant for pinned source ${pin.repo}/${pin.path}`, { ...pin }));
    } else {
      try {
        const { bytes, text, meta } = resolveSourceRef(pin, ctx.sources, budget);
        collectFromRevision({ sourceKey: key, commit: pin.commit, bytes, text, meta, pin });
      } catch (e) {
        diagnostics.push(diagnostic(e instanceof ResolutionError ? e.code : "SOURCE_UNVERIFIED", "error", `pinned source failed verification: ${e.message}`, { ...pin }));
      }
    }
  } else {
    for (const sourceKey of sourceKeys) {
      // Source tags filter is metadata-only: applied before any
      // revision selection so filtered sources leave no notes.
      const entry0 = ctx.sources[sourceKey];
      const tags0 = Array.isArray(entry0.tags) ? entry0.tags : [];
      if (task.filters.source_tags.length > 0 && !task.filters.source_tags.some((t) => tags0.includes(t))) {
        continue;
      }
      const scopes = queryScopesFor(sourceKey, query_key, ctx);
      if (scopes.length === 0) continue; // no claim facts for this key here
      const sel = selectEffectiveRevision(sourceKey, scopes, ctx, clockMs, asOfMs, budget);
      stewardFlags.push(...(sel.stewardFlags ?? []));
      if (sel.status === "ok") {
        for (const rid of sel.appliedRecords) {
          const rec = ctx.supersessionRecords.find((r) => r.record_id === rid);
          supersessionNotes.push({
            record_id: rid,
            source: sourceKey,
            old_commit: rec.old_ref.commit,
            new_commit: rec.new_ref.commit,
            effective_at: rec.effective_at,
          });
        }
        // The effective ref may name a replacement on another path; the
        // permission gate in selectEffectiveRevision already approved it.
        const refKey = `${sel.ref.repo}|${sel.ref.path}`;
        const entry = ctx.sources[refKey];
        const meta = entry.revisions[sel.ref.commit];
        const pin = { repo: sel.ref.repo, path: sel.ref.path, commit: sel.ref.commit, blob: meta.blob, algorithm: meta.algorithm ?? "git-sha1", revision: meta.revision ?? "" };
        try {
          const { bytes, text } = resolveSourceRef(pin, ctx.sources, budget);
          collectFromRevision({ sourceKey: refKey, commit: sel.ref.commit, bytes, text, meta, pin });
        } catch (e) {
          diagnostics.push(diagnostic(e instanceof ResolutionError ? e.code : "SOURCE_UNVERIFIED", "error", `effective revision failed verification: ${e.message}`, { ...pin }));
        }
      } else if (sel.status === "read-denied") {
        diagnostics.push(diagnostic("READ_DENIED", "error", sel.reason));
      } else {
        diagnostics.push(diagnostic(sel.code ?? "STALE_EVIDENCE", "warning", sel.reason));
      }
    }
  }

  function collectFromRevision({ sourceKey, commit, bytes, text, meta, pin }) {
    // Age comes from the authenticated effective/verification ledger
    // times, never file mtime.
    const effectiveMs = Date.parse(meta.effective_at);
    if (task.filters.max_source_age_days !== null) {
      const ageDays = (clockMs - effectiveMs) / 86400000;
      if (ageDays > task.filters.max_source_age_days) {
        diagnostics.push(
          diagnostic("STALE_EVIDENCE", "warning", `source ${sourceKey} excluded: age ${ageDays.toFixed(1)}d exceeds max_source_age_days=${task.filters.max_source_age_days}`, { ...pin })
        );
        return;
      }
    }
    // Injection: quarantine before any claim extraction.
    const inj = scanSourceText(text);
    if (inj.injected) {
      quarantined.push({ ...pin });
      diagnostics.push(
        diagnostic("INSTRUCTION_INJECTION", "critical", `source ${sourceKey} contains seeded directive content; quarantined, its claims cannot be used`, { ...pin })
      );
      return;
    }
    const facts = parseClaims(text).filter((f) => f.claim_key === query_key);
    for (const fact of facts) {
      let span;
      try {
        span = verifySpan(bytes, fact.line, budget);
      } catch (e) {
        diagnostics.push(diagnostic("SPAN_MISMATCH", "error", `quoted span verification failed for claim '${fact.claim_key}' in ${sourceKey}: ${e.message}`, { ...pin }));
        continue;
      }
      const citation = {
        ...pin,
        quoted_span: fact.line,
        span: { start_byte: span.start_byte, end_byte: span.end_byte, quoted_text: span.quoted_text },
        verification: "VERIFIED",
      };
      claims.push({
        claim_id: claimIdOf(query_key, sourceKey, commit),
        text: fact.line,
        validity: fact.validity,
        canonical_value: fact.canonical_value,
        units: fact.units,
        scope_ids: [...fact.scope_ids],
        source_key: sourceKey,
        citations: [citation],
      });
    }
  }

  // Contradictions: same claim_key, overlapping scopes, same units,
  // different canonical values. Different units/times/scopes are not
  // automatically conflicts.
  const byKey = new Map();
  for (const c of claims) {
    if (!byKey.has(query_key)) byKey.set(query_key, []);
    byKey.get(query_key).push(c);
  }
  const seenPairs = new Set();
  for (const list of byKey.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        if (a.source_key === b.source_key) continue;
        const scopeOverlap = a.scope_ids.some((s) => b.scope_ids.includes(s));
        if (!scopeOverlap) continue;
        if (a.units.toLowerCase() !== b.units.toLowerCase()) continue;
        if (a.canonical_value === b.canonical_value) continue;
        const pairKey = [a.claim_id, b.claim_id].sort().join("|");
        if (seenPairs.has(pairKey)) continue;
        seenPairs.add(pairKey);
        contradictions.push({
          source_a: a.source_key,
          source_b: b.source_key,
          span_a: { ...a.citations[0].span },
          span_b: { ...b.citations[0].span },
          claim_key: query_key,
        });
      }
    }
  }

  // Confidence.
  let confidence = "HIGH";
  let status = "ANSWERED";
  if (claims.length === 0) {
    status = "UNVERIFIABLE";
    confidence = "LOW";
  } else if (contradictions.length > 0) {
    confidence = "LOW";
  } else if (claims.some((c) => c.validity !== "GROUNDED")) {
    confidence = "LOW"; // mixed validity: a degraded claim is present
  } else if (isPartialCoverage(query, matchedPhrases ?? [])) {
    confidence = "MEDIUM";
  }

  // Extractive answer text: templated sentences embedding exact quotes.
  let answer_text;
  if (claims.length === 0) {
    answer_text = `No verifiable claims found for '${query_key}'.`;
  } else {
    const sentences = claims.map(
      (c) => `According to ${c.source_key.replace("|", "/")}: "${c.text}"`
    );
    answer_text = sentences.join(" ");
    if (contradictions.length > 0) {
      answer_text += ` These sources disagree on '${query_key}'; no single current value can be stated.`;
    }
  }

  // Public claim shape (strip internal helpers).
  const publicClaims = claims.map((c) => ({
    claim_id: c.claim_id,
    text: c.text,
    validity: c.validity,
    citations: c.citations,
  }));

  return {
    status,
    answer_text,
    claims: publicClaims,
    confidence,
    contradictions,
    contradiction_count: contradictions.length,
    supersession_notes: supersessionNotes,
    steward_flags: stewardFlags,
    diagnostics,
    quarantined_sources: quarantined,
  };
}
