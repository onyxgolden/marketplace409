import { hashContent } from "../hashContent.mjs";

/**
 * diagnosticQualityCases.mjs — ground-truth cases for the diagnostic-quality proof.
 *
 * Two kinds:
 * 1. FIXTURE cases: synthetic mini-manifests modeling known bug shapes (wrong constant,
 *    missing null guard). Fully hermetic — manifest, reader, and bug records included.
 * 2. REAL cases: genuine historical fixes from this repo's git history. The query is a
 *    "why is X broken?" phrasing derived from the fix commit's subject; the expected
 *    implicated files are the source files that fix commit actually changed. Run against
 *    the committed manifest + real git history (like acceptanceQuestions.test.mjs).
 *    Ground truth was verified 2026-09-29: every expected path is indexed in the
 *    committed manifest (built at fe285b201d), and the query terms appear in the
 *    post-fix file content.
 */

function fixtureRecord(path, type, symbol, content, authority = "current") {
  return {
    source_path: path,
    source_type: type,
    symbol_or_section: symbol,
    commit_sha: "fixture-sha",
    content_hash: hashContent(content),
    authority_level: authority,
    version: null,
    details: {},
  };
}

function fixtureReader(byPath) {
  const provider = (sha, p) => byPath[p] || null;
  return {
    contentProvider: provider,
    excerptReader: {
      readFileAtCommit: provider,
      readMigrationsAtCommit: () => [],
    },
  };
}

// --- Fixture A: wrong-constant bug with a stale contradicting doc ---------------------------
const billingCode = `// Late fee calculation: 5% of the outstanding balance.
export function calculateLateFee(balance) { return balance * 0.05; }`;
const billingTest = `import { calculateLateFee } from './billing.js';
// pins the 5% behavior; content deliberately avoids query terms so it only
// surfaces via naming-convention pairing.
it('computes the documented rate', () => { expect(calculateLateFee(200)).toBe(10); });`;
const billingDoc = `# Billing\nLate fees are 5% of the outstanding balance, computed by calculateLateFee.`;
const billingDecision = `# Decision 12\nWe chose a flat 5% late fee for calculateLateFee after reviewing competitor pricing.`;
const billingStaleDoc = `# Billing (old)\nLate fees are 10% of the outstanding balance.`;

function billingManifest() {
  return {
    schema_version: "1.0",
    commit_sha: "fixture-sha",
    index_content_hash: "fixture-manifest-hash",
    records: [
      fixtureRecord("src/lib/billing.js", "application_source_symbol", "calculateLateFee", billingCode),
      fixtureRecord("src/lib/billing.test.js", "test_file", null, billingTest),
      fixtureRecord("docs/billing.md", "synchronized_document_section", "Billing", billingDoc),
      fixtureRecord("decisions/decision-12.md", "reviewed_decision", null, billingDecision, "reviewed_decision"),
      fixtureRecord("docs/archive/billing-old.md", "synchronized_document_section", "Billing", billingStaleDoc, "historical_snapshot"),
    ],
  };
}

const billingBugRecords = [
  { sha: "aaa", date: "2026-09-20", subject: "fix(billing): correct late fee rounding", pr: 100, class: "fix", files: ["src/lib/billing.js"] },
  { sha: "bbb", date: "2026-09-21", subject: "fix(auth): token refresh race", pr: 101, class: "fix", files: ["src/lib/auth.js"] },
];

// --- Fixture B: missing null guard ------------------------------------------------------------
const sessionCode = `// Returns the display name for the current session user.
export function getDisplayName(session) { return session.user.displayName; }`;
const sessionTest = `import { getDisplayName } from './session.js';
// behavior pin; avoids query terms so pairing is what surfaces it.
it('returns the name on a valid session', () => {
  expect(getDisplayName({ user: { displayName: 'Ada' } })).toBe('Ada');
});`;

function sessionManifest() {
  return {
    schema_version: "1.0",
    commit_sha: "fixture-sha",
    index_content_hash: "fixture-manifest-hash",
    records: [
      fixtureRecord("src/lib/session.js", "application_source_symbol", "getDisplayName", sessionCode),
      fixtureRecord("src/lib/session.test.js", "test_file", null, sessionTest),
    ],
  };
}

function buildFixtureCases() {
  const billing = fixtureReader({
    "src/lib/billing.js": billingCode,
    "src/lib/billing.test.js": billingTest,
    "docs/billing.md": billingDoc,
    "decisions/decision-12.md": billingDecision,
    "docs/archive/billing-old.md": billingStaleDoc,
  });
  const session = fixtureReader({
    "src/lib/session.js": sessionCode,
    "src/lib/session.test.js": sessionTest,
  });
  return [
    {
      id: "fixture-wrong-constant",
      kind: "fixture",
      queryText: "why is the late fee amount wrong",
      manifest: billingManifest(),
      excerptReader: billing.excerptReader,
      contentProvider: billing.contentProvider,
      bugRecords: billingBugRecords,
      expected: {
        implicated_code: ["src/lib/billing.js"],
        behavior_pins: ["src/lib/billing.test.js"],
        intended_behavior: ["docs/billing.md"],
        decisions: ["decisions/decision-12.md"],
        past_fix_subjects: ["late fee"],
        expect_contradiction: true,
      },
    },
    {
      id: "fixture-null-guard",
      kind: "fixture",
      queryText: "why does getDisplayName crash when the session has no user",
      manifest: sessionManifest(),
      excerptReader: session.excerptReader,
      contentProvider: session.contentProvider,
      bugRecords: [],
      expected: {
        implicated_code: ["src/lib/session.js"],
        behavior_pins: ["src/lib/session.test.js"],
      },
    },
  ];
}

// --- Real cases: verified against git history 2026-09-29 --------------------------------------
// bugRecords are reconstructed from each case's own fix commit (real SHA, subject, files) --
// the same shape the nightly sync mines into engineering_brain_bug_fixes. This proves the
// past-fix attachment path against genuine historical data.
function realBugRecord(sha, date, subject, files) {
  return { sha, date, subject, pr: null, class: "fix", files };
}

export const REAL_DIAGNOSTIC_CASES = [
  {
    id: "real-home-equity-mortgage",
    kind: "real",
    fix_commit: "8410fc3d",
    fix_subject: "fix(financial): categorize Home Equity payments as mortgage payments",
    queryText: "why aren't Home Equity payments categorized as mortgage payments",
    bugRecords: [
      realBugRecord("8410fc3d", "2026-09-18", "fix(financial): categorize Home Equity payments as mortgage payments", [
        "src/app/api/financial/reconcile-transfers/route.js",
        "src/components/forge/ReconcileTransfersPanel.jsx",
        "src/domains/financial-event/__tests__/loanPaymentCategory.test.js",
        "src/domains/financial-event/loanPaymentCategory.js",
      ]),
    ],
    expected: {
      implicated_code: ["src/domains/financial-event/loanPaymentCategory.js"],
      behavior_pins: ["src/domains/financial-event/__tests__/loanPaymentCategory.test.js"],
      past_fix_subjects: ["home equity payments as mortgage"],
    },
  },
  {
    id: "real-transfer-ambiguity-symmetric",
    kind: "real",
    fix_commit: "e6cfe634",
    fix_subject: "Make transfer-pair ambiguity detection symmetric (fix silent outbound-row drop)",
    queryText: "why do outbound transfer rows silently disappear from ambiguity detection",
    bugRecords: [
      realBugRecord("e6cfe634", "2026-09-18", "Make transfer-pair ambiguity detection symmetric (fix silent outbound-row drop)", [
        "src/app/api/financial/reconcile-transfers/route.js",
        "src/domains/financial-event/__tests__/classifyTransferPairs.test.js",
        "src/domains/financial-event/classifyTransferPairs.js",
      ]),
    ],
    expected: {
      // classifyTransferPairs.test.js is not in the committed manifest, so only the
      // implicated-code recall is asserted for this case.
      implicated_code: ["src/domains/financial-event/classifyTransferPairs.js"],
      past_fix_subjects: ["ambiguity detection symmetric"],
    },
  },
  {
    id: "real-dashboard-cache-swr",
    kind: "real",
    fix_commit: "0f24f07b",
    fix_subject: "fix(financial): stale-while-revalidate the dashboard cache instead of never refreshing",
    queryText: "why does the financial dashboard cache never refresh",
    bugRecords: [
      realBugRecord("0f24f07b", "2026-09-17", "fix(financial): stale-while-revalidate the dashboard cache instead of never refreshing", [
        "src/app/forge/financial/dashboardCache.js",
        "src/app/forge/financial/dashboardCache.test.js",
        "src/app/forge/financial/page.js",
        "src/components/forge/financial/FinancialApplicationShell.jsx",
        "src/components/forge/financial/__tests__/FinancialApplicationShell.test.jsx",
      ]),
    ],
    expected: {
      implicated_code: ["src/app/forge/financial/dashboardCache.js"],
      behavior_pins: ["src/app/forge/financial/dashboardCache.test.js"],
      past_fix_subjects: ["dashboard cache"],
    },
  },
];

export function getFixtureDiagnosticCases() {
  return buildFixtureCases();
}

export function getAllDiagnosticCases() {
  return [...buildFixtureCases(), ...REAL_DIAGNOSTIC_CASES];
}
