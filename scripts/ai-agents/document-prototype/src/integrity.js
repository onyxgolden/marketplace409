/**
 * integrity.js — pure document-set integrity analysis for the Document
 * Agent prototype. Operates ONLY on already-validated, already-resolved
 * records (content bytes resolved, spans bounds-checked by the caller);
 * performs no I/O, no further charging. Pure Node 24 ESM, zero deps.
 *
 * evidence_state convention used throughout this module (matches the
 * brief's own wording, e.g. "missing named section/companion is
 * mismatch"): "verified" = a clean, independently-established fact with
 * no violation; "mismatch" = a genuine conflict/violation was found;
 * "unverifiable" = the fact cannot be established at all (missing
 * evidence, external/unfetched pointer, quarantined content).
 */

function sortStrings(arr) {
  return [...arr].sort();
}

/**
 * Exact duplicate detection: group admitted documents by independently
 * computed SHA-256 of resolved content bytes (never by doc_id, logical_id
 * or SourceRef identity — two documents with different SourceRefs but
 * byte-identical content are still an exact duplicate). Distinct doc_ids
 * are retained and grouped, never merged or deleted.
 */
export function computeDuplicateGroups(docs) {
  const byHash = new Map();
  for (const d of docs) {
    if (!byHash.has(d.contentSha256)) byHash.set(d.contentSha256, []);
    byHash.get(d.contentSha256).push(d.doc_id);
  }
  const groups = [];
  for (const [hash, ids] of byHash) {
    if (ids.length < 2) continue;
    groups.push({ content_sha256: hash, doc_ids: sortStrings(ids), evidence_state: "verified" });
  }
  groups.sort((a, b) => (a.content_sha256 < b.content_sha256 ? -1 : a.content_sha256 > b.content_sha256 ? 1 : 0));
  return groups;
}

/**
 * Version-conflict register, grouped by logical_id:
 *  - PARALLEL_VERSION: two or more admitted documents share the same
 *    logical_id + revision but have DIFFERING content (by the same
 *    content-hash computed for duplicate detection).
 *  - TIMELINE_MISMATCH: walking the logical_id's distinct revisions in
 *    increasing order, a later revision's declared_date is not strictly
 *    after the previous one's.
 * No "latest therefore authoritative" selection is made; FINAL/APPROVED/
 * certified metadata.status values carry zero authority and are never
 * consulted here.
 */
export function computeVersionConflicts(docs) {
  const byLogical = new Map();
  for (const d of docs) {
    if (!byLogical.has(d.logical_id)) byLogical.set(d.logical_id, []);
    byLogical.get(d.logical_id).push(d);
  }
  const conflicts = [];
  for (const [logical_id, group] of byLogical) {
    if (group.length < 2) continue;

    const byRevision = new Map();
    for (const d of group) {
      if (!byRevision.has(d.revision)) byRevision.set(d.revision, []);
      byRevision.get(d.revision).push(d);
    }
    for (const [revision, bucket] of byRevision) {
      const distinctHashes = new Set(bucket.map((d) => d.contentSha256));
      if (distinctHashes.size > 1) {
        conflicts.push({
          type: "PARALLEL_VERSION",
          logical_id,
          revision,
          doc_ids: sortStrings(bucket.map((d) => d.doc_id)),
          distinct_content_count: distinctHashes.size,
          evidence_state: "mismatch",
        });
      }
    }

    // One representative per revision (first encountered, stable) for the
    // timeline walk — same-revision collisions are already reported above.
    const repByRevision = new Map();
    for (const d of group) {
      if (!repByRevision.has(d.revision)) repByRevision.set(d.revision, d);
    }
    const sequence = [...repByRevision.values()].sort((a, b) => a.revision - b.revision);
    for (let i = 1; i < sequence.length; i++) {
      const prev = sequence[i - 1];
      const next = sequence[i];
      if (!(next.declared_date > prev.declared_date)) {
        conflicts.push({
          type: "TIMELINE_MISMATCH",
          logical_id,
          doc_ids: [prev.doc_id, next.doc_id],
          revisions: [prev.revision, next.revision],
          declared_dates: [prev.declared_date, next.declared_date],
          evidence_state: "mismatch",
        });
      }
    }
  }
  conflicts.sort((a, b) => (a.logical_id < b.logical_id ? -1 : a.logical_id > b.logical_id ? 1 : a.type < b.type ? -1 : a.type > b.type ? 1 : 0));
  return conflicts;
}

/**
 * Checklist coverage: exact case-sensitive section IDs and companion
 * logical IDs, from the trusted (host-injected) checklist criteria —
 * never from task/document content. Missing named section/companion is
 * "mismatch" (per the brief's own wording), present is "verified".
 */
export function computeChecklistResults(criteria, docs) {
  const sectionToDocIds = new Map();
  const logicalToDocIds = new Map();
  for (const d of docs) {
    for (const s of d.sections) {
      if (!sectionToDocIds.has(s.section_id)) sectionToDocIds.set(s.section_id, []);
      sectionToDocIds.get(s.section_id).push(d.doc_id);
    }
    if (!logicalToDocIds.has(d.logical_id)) logicalToDocIds.set(d.logical_id, []);
    logicalToDocIds.get(d.logical_id).push(d.doc_id);
  }

  const required_sections = criteria.required_sections.map((section_id) => {
    const doc_ids = sortStrings(sectionToDocIds.get(section_id) ?? []);
    return { section_id, present: doc_ids.length > 0, doc_ids, evidence_state: doc_ids.length > 0 ? "verified" : "mismatch" };
  });
  const required_companions = criteria.required_companions.map((logical_id) => {
    const doc_ids = sortStrings(logicalToDocIds.get(logical_id) ?? []);
    return { logical_id, present: doc_ids.length > 0, doc_ids, evidence_state: doc_ids.length > 0 ? "verified" : "mismatch" };
  });
  const overall = required_sections.every((r) => r.present) && required_companions.every((r) => r.present) ? "SATISFIED" : "MISMATCH";
  return { checklist_version: criteria.checklist_version, required_sections, required_companions, overall };
}

/**
 * Metadata-vs-content comparison: compares only the four declared keys
 * (author/date/id/status) against verified structured content markers
 * with exact spans. Absent marker => unverifiable (never guessed).
 */
export function computeMetadataVerification(doc, markerTexts) {
  const results = [];
  for (const key of ["author", "date", "id", "status"]) {
    const markerText = markerTexts.get(key);
    if (markerText === undefined) {
      results.push({ key, declared: doc.metadata[key], marker_value: null, evidence_state: "unverifiable" });
      continue;
    }
    const matches = markerText === doc.metadata[key];
    results.push({ key, declared: doc.metadata[key], marker_value: markerText, evidence_state: matches ? "verified" : "mismatch" });
  }
  return results;
}

/**
 * Cross-reference map: one entry per reference edge. INTERNAL edges are
 * checked for existence of the target document (and target section, if
 * named) within the admitted set — missing target is "mismatch", never a
 * network request. EXTERNAL edges are always EXTERNAL_REFERENCE /
 * unverifiable and are never fetched.
 */
export function computeReferenceEdges(docs) {
  const byId = new Map(docs.map((d) => [d.doc_id, d]));
  const edges = [];
  for (const d of docs) {
    for (const r of d.references) {
      if (r.target_kind === "EXTERNAL") {
        edges.push({
          ref_id: r.ref_id,
          from_doc_id: d.doc_id,
          kind: r.kind,
          target_kind: "EXTERNAL",
          target_doc_id: null,
          target_section_id: null,
          external_pointer: r.external_pointer,
          status: "EXTERNAL_REFERENCE",
          evidence_state: "unverifiable",
        });
        continue;
      }
      const target = byId.get(r.target_doc_id);
      if (!target) {
        edges.push({
          ref_id: r.ref_id,
          from_doc_id: d.doc_id,
          kind: r.kind,
          target_kind: "INTERNAL",
          target_doc_id: r.target_doc_id,
          target_section_id: r.target_section_id,
          external_pointer: null,
          status: "MISMATCH",
          reason: "missing internal document",
          evidence_state: "mismatch",
        });
        continue;
      }
      if (r.target_section_id !== null) {
        const hasSection = target.sections.some((s) => s.section_id === r.target_section_id);
        if (!hasSection) {
          edges.push({
            ref_id: r.ref_id,
            from_doc_id: d.doc_id,
            kind: r.kind,
            target_kind: "INTERNAL",
            target_doc_id: r.target_doc_id,
            target_section_id: r.target_section_id,
            external_pointer: null,
            status: "MISMATCH",
            reason: "missing internal section",
            evidence_state: "mismatch",
          });
          continue;
        }
      }
      edges.push({
        ref_id: r.ref_id,
        from_doc_id: d.doc_id,
        kind: r.kind,
        target_kind: "INTERNAL",
        target_doc_id: r.target_doc_id,
        target_section_id: r.target_section_id,
        external_pointer: null,
        status: "RESOLVED",
        evidence_state: "verified",
      });
    }
  }
  edges.sort((a, b) => (a.ref_id < b.ref_id ? -1 : a.ref_id > b.ref_id ? 1 : 0));
  return edges;
}

/**
 * Directed-cycle detection over INTERNAL edges of one kind
 * (PREREQUISITE or CITATION). Prerequisite cycles are reported as
 * mismatch findings; ordinary citation cycles are reported too, but only
 * as an observed structural fact — never assumed invalid. Returns
 * deduplicated cycles, each rotated to start at its lexicographically
 * smallest doc_id for a canonical, deterministic representation.
 */
export function detectCycles(docs, kind) {
  const adjacency = new Map(docs.map((d) => [d.doc_id, []]));
  for (const d of docs) {
    for (const r of d.references) {
      if (r.kind === kind && r.target_kind === "INTERNAL" && adjacency.has(r.target_doc_id)) {
        adjacency.get(d.doc_id).push(r.target_doc_id);
      }
    }
  }
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map(docs.map((d) => [d.doc_id, WHITE]));
  const stack = [];
  const onStack = new Set();
  const foundCanonical = new Set();
  const cycles = [];

  function canonicalRotation(path) {
    let minIdx = 0;
    for (let i = 1; i < path.length; i++) if (path[i] < path[minIdx]) minIdx = i;
    return [...path.slice(minIdx), ...path.slice(0, minIdx)];
  }

  function dfs(node) {
    color.set(node, GRAY);
    stack.push(node);
    onStack.add(node);
    for (const next of adjacency.get(node) ?? []) {
      if (onStack.has(next)) {
        const idx = stack.indexOf(next);
        const cyclePath = canonicalRotation(stack.slice(idx));
        const key = cyclePath.join(">");
        if (!foundCanonical.has(key)) {
          foundCanonical.add(key);
          cycles.push(cyclePath);
        }
      } else if (color.get(next) === WHITE) {
        dfs(next);
      }
    }
    stack.pop();
    onStack.delete(node);
    color.set(node, BLACK);
  }

  for (const d of docs) {
    if (color.get(d.doc_id) === WHITE) dfs(d.doc_id);
  }
  cycles.sort((a, b) => (a.join(">") < b.join(">") ? -1 : 1));
  return cycles;
}

/**
 * Cross-document conflicts: supplied structured assertions sharing equal
 * subject/property/scope keys but differing typed values, each tied to
 * an exact passage. Shows every passage in the group — never interprets
 * prose truth, picks a winner, or silently reconciles. Groups where all
 * assertions (across distinct doc_ids) agree are not reported.
 */
export function computeCrossDocumentConflicts(assertionsWithCitations) {
  const byKey = new Map();
  for (const a of assertionsWithCitations) {
    const key = `${a.subject}|${a.property}|${a.scope}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(a);
  }
  const conflicts = [];
  for (const [key, group] of byKey) {
    const distinctDocIds = new Set(group.map((a) => a.doc_id));
    if (distinctDocIds.size < 2) continue;
    const distinctValues = new Set(group.map((a) => `${a.value_type}:${JSON.stringify(a.value)}`));
    if (distinctValues.size < 2) continue;
    const [subject, property, scope] = key.split("|");
    conflicts.push({
      subject,
      property,
      scope,
      assertions: group
        .map((a) => ({ assertion_id: a.assertion_id, doc_id: a.doc_id, value_type: a.value_type, value: a.value, citation: a.citation }))
        .sort((a, b) => (a.assertion_id < b.assertion_id ? -1 : 1)),
      evidence_state: "mismatch",
    });
  }
  conflicts.sort((a, b) => {
    const ka = `${a.subject}|${a.property}|${a.scope}`;
    const kb = `${b.subject}|${b.property}|${b.scope}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  return conflicts;
}
