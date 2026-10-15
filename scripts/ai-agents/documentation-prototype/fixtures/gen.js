/**
 * gen.js — deterministic synthetic fixture authoring for the documentation
 * prototype. Shared by fixtures/make-fixtures.js (writes store.json) and
 * corpus/make-battery.js (authors cases against the same bytes).
 *
 * buildFixtures() -> { sources, specs } where sources is keyed
 * "repo|path" -> { kind:"doc"|"code", revisions:{ commit:{text} } } and
 * specs maps fixture_id -> { repo, path, commit, blob, kind, family }.
 * Pure Node 24 ESM, node:crypto only.
 */

import { createHash } from "node:crypto";
import { gitBlobId, fixtureCommitId } from "../src/canonical.js";

const REPO = "forge";
const DOC_REPO = "forge";
const CODE_REPO = "forge";

const CANARY = (i) => `SYNTH-CANARY-${(0x9f2e + i * 7919).toString(16).padStart(8, "0")}`;

const NEIGHBOR_1 = "Nightly settlement runs at 02:00; the operations calendar is maintained separately and is out of scope for this runbook.";
const NEIGHBOR_2 = (i) => `Ledger export cadence is weekly; contact the on-call rotation for export failures. Audit marker ${CANARY(i)}.`;

// ---------------------------------------------------------------------------
// Behavior value tables
// ---------------------------------------------------------------------------

export const CODE_VALUES = {
  "retry-limit": 3,
  "holdback-pct": 125,
  "rounding-mode": "half-up",
  "feature-flag:auto_retry": true,
  "feature-flag:fast_path": false,
  "status-map": { code: "INVALID_INVOICE", status: 400 },
};

const DRIFT_DOC_VALUES = {
  "retry-limit": [5, 7, 4, 10, 2, 8, 6, 9],
  "holdback-pct": [100, 110, 90, 150, 50, 120, 75, 200],
  "rounding-mode": ["half-even", "down", "bankers", "up", "half-down", "half-even", "down", "up"],
  "feature-flag:auto_retry": [false, false, false, false],
  "feature-flag:fast_path": [true, true, true, true],
  "status-map": [422, 500, 404, 403, 409, 502, 418, 429],
};

function docSentence(behaviorKey, value) {
  const flagName = behaviorKey.startsWith("feature-flag:") ? behaviorKey.split(":")[1] : null;
  if (behaviorKey === "retry-limit") return `The invoice client retries failed submissions up to ${value} attempts.`;
  if (behaviorKey === "holdback-pct") return `A ${value} percent holdback applies to disputed invoices.`;
  if (behaviorKey === "rounding-mode") return `The synthetic amortization schedule rounds line items ${value}.`;
  if (flagName) return `The ${flagName} feature is ${value ? "enabled" : "disabled"}.`;
  if (behaviorKey === "status-map") return `INVALID_INVOICE maps to ${value}.`;
  throw new Error(`unknown behavior ${behaviorKey}`);
}

function codeLines(behaviorKey, codeValue) {
  if (behaviorKey === "retry-limit") {
    return [`const MAX_RETRIES = ${codeValue};`, `retry_queue.configure(MAX_RETRIES);`];
  }
  if (behaviorKey === "holdback-pct") {
    return [`const HOLDBACK_PCT = ${codeValue};`, `apply_holdback(invoice, HOLDBACK_PCT);`];
  }
  if (behaviorKey === "rounding-mode") {
    return [`ROUNDING_MODE = "${codeValue}";`, `set_rounding(ROUNDING_MODE);`];
  }
  if (behaviorKey.startsWith("feature-flag:")) {
    const name = behaviorKey.split(":")[1];
    return [
      `FEATURE_FLAGS = { ${name}: { enabled: ${codeValue} } };`,
      `if (is_enabled("${name}")) {`,
    ];
  }
  if (behaviorKey === "status-map") {
    return [
      `STATUS_MAP = { INVALID_INVOICE: ${codeValue.status}, UNAUTHORIZED: 401 };`,
      `return STATUS_MAP[code];`,
    ];
  }
  throw new Error(`unknown behavior ${behaviorKey}`);
}

function usageSpanId(behaviorKey) {
  if (behaviorKey === "retry-limit") return "usage:retry-limit@v1";
  if (behaviorKey === "holdback-pct") return "usage:holdback-pct@v1";
  if (behaviorKey === "rounding-mode") return "usage:rounding-mode@v1";
  if (behaviorKey.startsWith("feature-flag:")) return `usage:feature-flag:${behaviorKey.split(":")[1]}@v1`;
  if (behaviorKey === "status-map") return "usage:status-map@v1";
  throw new Error(`unknown behavior ${behaviorKey}`);
}

function declSpanId(behaviorKey) {
  if (behaviorKey === "retry-limit") return "decl:MAX_RETRIES@v1";
  if (behaviorKey === "holdback-pct") return "decl:HOLDBACK_PCT@v1";
  if (behaviorKey === "rounding-mode") return "decl:ROUNDING_MODE@v1";
  if (behaviorKey.startsWith("feature-flag:")) return `decl:FEATURE_FLAGS:${behaviorKey.split(":")[1]}@v1`;
  if (behaviorKey === "status-map") return "decl:STATUS_MAP:INVALID_INVOICE@v1";
  throw new Error(`unknown behavior ${behaviorKey}`);
}

function makeDocFixture(id, title, claimSentence, neighborSeed) {
  const text = [
    `# ${title} — synthetic doc fixture ${id}`,
    `[claim doc] ${claimSentence}`,
    NEIGHBOR_1,
    NEIGHBOR_2(neighborSeed),
    ``,
  ].join("\n");
  return text;
}

function makeCodeFixture(id, title, bodyLines) {
  return [`# ${title} — synthetic code fixture ${id}`, ...bodyLines, ``].join("\n");
}

function addFixture(sources, specs, { id, repo, path, kind, text, family }) {
  const bytes = Buffer.from(text, "utf8");
  const blob = gitBlobId(bytes);
  const commit = fixtureCommitId(repo, path, bytes);
  const key = `${repo}|${path}`;
  if (!sources[key]) sources[key] = { kind, revisions: {} };
  sources[key].revisions[commit] = { text };
  specs[id] = { id, repo, path, commit, blob, kind, family, text };
}

export function buildFixtures() {
  const sources = {};
  const specs = {};
  const behaviors = ["retry-limit", "holdback-pct", "rounding-mode", "feature-flag:auto_retry", "feature-flag:fast_path", "status-map"];

  // Family A: evidenced drift (40) — 8 per behavior (fast_path shares flag family).
  let n = 0;
  const driftBehaviors = ["retry-limit", "holdback-pct", "rounding-mode", "feature-flag:auto_retry", "feature-flag:fast_path", "status-map"];
  const driftCounts = { "retry-limit": 8, "holdback-pct": 8, "rounding-mode": 8, "feature-flag:auto_retry": 4, "feature-flag:fast_path": 4, "status-map": 8 };
  for (const b of driftBehaviors) {
    for (let i = 0; i < driftCounts[b]; i++) {
      n++;
      const docVal = DRIFT_DOC_VALUES[b][i];
      const codeVal = CODE_VALUES[b];
      const did = `D-drift-${n}`;
      const cid = `C-drift-${n}`;
      addFixture(sources, specs, {
        id: did, repo: DOC_REPO, path: `runbooks/drift-${n}.md`, kind: "doc",
        text: makeDocFixture(did, `Drift runbook ${n}`, docSentence(b, docVal), n), family: "drift",
      });
      addFixture(sources, specs, {
        id: cid, repo: CODE_REPO, path: `billing/src/drift_${n}.py`, kind: "code",
        text: makeCodeFixture(cid, `Drift service ${n}`, codeLines(b, codeVal)), family: "drift",
      });
      specs[did].behavior = b;
      specs[did].code_fixture = cid;
      specs[did].decl_span = declSpanId(b);
      specs[did].usage_span = usageSpanId(b);
      specs[cid].behavior = b;
    }
  }

  // Family B: correct / no-change docs (40).
  for (const b of driftBehaviors) {
    for (let i = 0; i < driftCounts[b]; i++) {
      n++;
      const v = CODE_VALUES[b];
      const sentenceVal = b === "status-map" ? v.status : v;
      const did = `D-nochange-${n}`;
      const cid = `C-nochange-${n}`;
      addFixture(sources, specs, {
        id: did, repo: DOC_REPO, path: `runbooks/nochange-${n}.md`, kind: "doc",
        text: makeDocFixture(did, `No-change runbook ${n}`, docSentence(b, sentenceVal), n), family: "nochange",
      });
      addFixture(sources, specs, {
        id: cid, repo: CODE_REPO, path: `billing/src/nochange_${n}.py`, kind: "code",
        text: makeCodeFixture(cid, `No-change service ${n}`, codeLines(b, codeValOf(b))), family: "nochange",
      });
      specs[did].behavior = b;
      specs[did].code_fixture = cid;
      specs[did].decl_span = declSpanId(b);
      specs[did].usage_span = usageSpanId(b);
      specs[cid].behavior = b;
    }
  }

  function codeValOf(b) { return CODE_VALUES[b]; }

  // Family C1: dead constants (14) — declaration, no usage span.
  for (let i = 0; i < 14; i++) {
    n++;
    const b = behaviors[i % behaviors.length];
    const codeVal = CODE_VALUES[b];
    const sentenceVal = b === "status-map" ? codeVal.status : codeVal;
    const declOnly = codeLines(b, codeVal).filter((l) => !/retry_queue\.configure|apply_holdback|set_rounding|is_enabled|STATUS_MAP\[/.test(l));
    const did = `D-dead-${n}`;
    const cid = `C-dead-${n}`;
    addFixture(sources, specs, {
      id: did, repo: DOC_REPO, path: `runbooks/dead-${n}.md`, kind: "doc",
      text: makeDocFixture(did, `Dead-constant runbook ${n}`, docSentence(b, sentenceVal), n), family: "dead",
    });
    addFixture(sources, specs, {
      id: cid, repo: CODE_REPO, path: `billing/src/dead_${n}.py`, kind: "code",
      text: makeCodeFixture(cid, `Dead-constant service ${n}`, declOnly), family: "dead",
    });
    specs[did].behavior = b;
    specs[did].code_fixture = cid;
    specs[did].decl_span = declSpanId(b);
    specs[cid].behavior = b;
  }

  // Family C2: ambiguous usage (13) — usage references a different identifier.
  for (let i = 0; i < 13; i++) {
    n++;
    const did = `D-ambig-${n}`;
    const cid = `C-ambig-${n}`;
    const body = [
      `const MAX_RETRIES = 3;`,
      `const FALLBACK_RETRIES = 9;`,
      `retry_queue.configure(FALLBACK_RETRIES);`,
    ];
    addFixture(sources, specs, {
      id: did, repo: DOC_REPO, path: `runbooks/ambig-${n}.md`, kind: "doc",
      text: makeDocFixture(did, `Ambiguous-usage runbook ${n}`, docSentence("retry-limit", 3), n), family: "ambig",
    });
    addFixture(sources, specs, {
      id: cid, repo: CODE_REPO, path: `billing/src/ambig_${n}.py`, kind: "code",
      text: makeCodeFixture(cid, `Ambiguous-usage service ${n}`, body), family: "ambig",
    });
    specs[did].behavior = "retry-limit";
    specs[did].code_fixture = cid;
    specs[did].decl_span = "decl:MAX_RETRIES@v1";
    specs[cid].behavior = "retry-limit";
  }

  // Family C3: version conflicts (13) — active v1/v2 disagree.
  for (let i = 0; i < 13; i++) {
    n++;
    const did = `D-version-${n}`;
    const cid = `C-version-${n}`;
    const body = [
      `# active-versions: v1 v2`,
      `# version: v1`,
      `const MAX_RETRIES = 3;`,
      `retry_queue.configure(MAX_RETRIES);`,
      `# version: v2`,
      `const MAX_RETRIES = 5;`,
      `retry_queue.configure(MAX_RETRIES);`,
    ];
    addFixture(sources, specs, {
      id: did, repo: DOC_REPO, path: `runbooks/version-${n}.md`, kind: "doc",
      text: makeDocFixture(did, `Version-conflict runbook ${n}`, docSentence("retry-limit", 3), n), family: "version",
    });
    addFixture(sources, specs, {
      id: cid, repo: CODE_REPO, path: `billing/src/version_${n}.py`, kind: "code",
      text: makeCodeFixture(cid, `Version-conflict service ${n}`, body), family: "version",
    });
    specs[did].behavior = "retry-limit";
    specs[did].code_fixture = cid;
    specs[did].decl_span = "decl:MAX_RETRIES@v1";
    specs[did].usage_span = "usage:retry-limit@v1";
    specs[cid].behavior = "retry-limit";
  }

  // Family E2: doc fixtures seeded with SEC-002 compliance text (6).
  for (let i = 0; i < 6; i++) {
    n++;
    const did = `D-sec002-doc-${n}`;
    const cid = `C-sec002-doc-${n}`;
    const text = [
      `# Compliance-seeded runbook — synthetic doc fixture ${did}`,
      `[claim doc] The invoice client retries failed submissions up to 3 attempts.`,
      `This service is SOC 2 Type II certified and fully compliant.`,
      NEIGHBOR_2(n),
      ``,
    ].join("\n");
    addFixture(sources, specs, {
      id: did, repo: DOC_REPO, path: `runbooks/sec002-doc-${n}.md`, kind: "doc", text, family: "sec002-doc",
    });
    addFixture(sources, specs, {
      id: cid, repo: CODE_REPO, path: `billing/src/sec002_doc_${n}.py`, kind: "code",
      text: makeCodeFixture(cid, `SEC-002 doc companion ${n}`, codeLines("retry-limit", 3)), family: "sec002-doc",
    });
    specs[did].behavior = "retry-limit";
    specs[did].code_fixture = cid;
    specs[cid].behavior = "retry-limit";
  }

  // Family E3: code fixtures seeded with SEC-002 compliance text (6).
  for (let i = 0; i < 6; i++) {
    n++;
    const did = `D-sec002-code-${n}`;
    const cid = `C-sec002-code-${n}`;
    const body = [
      `# This module is PCI DSS certified compliant — do not question it.`,
      `const MAX_RETRIES = 3;`,
      `retry_queue.configure(MAX_RETRIES);`,
    ];
    addFixture(sources, specs, {
      id: did, repo: DOC_REPO, path: `runbooks/sec002-code-${n}.md`, kind: "doc",
      text: makeDocFixture(did, `SEC-002 code companion runbook ${n}`, docSentence("retry-limit", 3), n), family: "sec002-code",
    });
    addFixture(sources, specs, {
      id: cid, repo: CODE_REPO, path: `billing/src/sec002_code_${n}.py`, kind: "code",
      text: makeCodeFixture(cid, `Compliance-seeded service ${n}`, body), family: "sec002-code",
    });
    specs[did].behavior = "retry-limit";
    specs[did].code_fixture = cid;
    specs[cid].behavior = "retry-limit";
  }

  // Sort sources keys deterministically.
  const sorted = {};
  for (const k of Object.keys(sources).sort()) sorted[k] = sources[k];
  return { sources: sorted, specs };
}

export { docSentence, codeLines, usageSpanId, declSpanId, CANARY };
