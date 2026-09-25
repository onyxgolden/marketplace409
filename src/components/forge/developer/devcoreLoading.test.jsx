// Slice warm-switch contract (developer + core): the converted panels serve
// cached data on first paint with no loading flash, and keep last-good data
// when a refresh fails.
import { beforeEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { clearSWRCache, fetchWithDedupe } from "../../../hooks/swrCache";
import EngineeringBrainPanel from "./EngineeringBrainPanel.jsx";
import UiImprovementManagerPanel from "./UiImprovementManagerPanel.jsx";
import CallShieldHome from "../callShield/CallShieldHome.jsx";
import HealthDashboard from "../health/HealthDashboard.jsx";
import BudgetPanel from "../budget/BudgetPanel.jsx";
import WorkspaceMembersPanel from "../workspace/WorkspaceMembersPanel.jsx";

// The supabase browser client is constructed during render; it never issues a
// request in these static-markup tests, but it requires non-empty env values.
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "dummy-publishable-key";

const brainKey = `engineering-brain:${JSON.stringify({ queryText: "", sourceType: "", authorityLevel: "" })}`;
const brainPayload = {
  latestRun: { commitSha: "abc123def456", generatedAt: "2026-09-24T10:00:00Z" },
  insufficient_evidence: false,
  conflicts: [],
  results: [{
    source_path: "src/lib/budgeting/plan.js",
    symbol_or_section: "buildPlan",
    source_type: "application_source_file",
    authority_level: "current",
    freshness: "fresh",
    confidence: "high",
    commit_sha: "abc123def456789",
    content_hash: "def456abc123789",
  }],
};

const proposalsPayload = [{
  findingId: "finding_1",
  findingClass: "deterministic",
  severity: "high",
  confidence: "high",
  status: "new",
  category: "horizontal_overflow",
  application: "rental",
  routePath: "/rental",
  viewport: "desktop",
  affectedComponent: "LedgerTable",
  screenshotHash: "screenshot-hash-1",
  explanation: "The ledger table overflows its container on narrow viewports.",
  proposedImprovement: "Allow horizontal scroll inside the card.",
  probableSourceFiles: ["src/components/forge/rental/LedgerTable.jsx"],
  validationRequirements: ["Re-run the screenshot CLI at 390px."],
  prohibitedScope: ["Do not restyle other tables."],
  rollbackDescription: "Revert the overflow class.",
}];

const membersPayload = {
  viewerRole: "primary_owner",
  viewerId: "user_1",
  members: [{
    id: "member_1",
    memberUserId: "user_1",
    invitedEmail: "brandy@example.com",
    role: "co_owner",
    status: "active",
  }],
};

const callShieldPayload = {
  cases: [{ id: "case_1", reported_business_name: "Cruise Agency" }],
  imports: [{
    id: "import_1",
    phone_number: "555-0100",
    caller_name: "Unknown caller",
    started_at: "2026-09-20T10:00:00Z",
    duration_seconds: 45,
    call_type: "incoming",
    matched_case_id: null,
  }],
};

function budgetMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

const budgetPayload = {
  lines: [{
    categoryId: "cat_1",
    displayLabel: "Groceries",
    normalizedCategory: "groceries",
    plannedAmountCents: 50000,
    actualAmountCents: 20000,
    note: null,
  }],
  totalIncomeCents: 500000,
  incomeByCategory: [],
  suggestions: [],
  recurringPatterns: [],
};

const healthPayload = {
  profiles: [{ id: "profile_1", display_name: "jason@example.com", profile_type: "primary" }],
  conditions: [],
  careTeam: [],
  labs: [{
    id: "lab_1",
    profile_id: "profile_1",
    marker_name: "Hemoglobin A1c",
    value_numeric: 5.7,
    unit: "%",
    flag: "normal",
    collected_on: "2026-08-01",
  }],
  regimen: [],
  measurements: [],
  workouts: [],
  timeline: [],
  programs: [],
  programDays: [],
};

beforeEach(() => { clearSWRCache(); });

describe("developer slice warm-switch behavior", () => {
  it("renders cached engineering-brain results instantly with no loading flash", async () => {
    await fetchWithDedupe(brainKey, () => Promise.resolve(brainPayload));
    const html = renderToStaticMarkup(<EngineeringBrainPanel />);
    expect(html).toContain("src/lib/budgeting/plan.js");
    expect(html).not.toContain("Searching the engineering brain");
  });

  it("shows the engineering-brain skeleton only when nothing is cached", () => {
    const html = renderToStaticMarkup(<EngineeringBrainPanel />);
    expect(html).toContain("Searching the engineering brain…");
  });

  it("keeps the last good brain results visible when a refresh fails", async () => {
    await fetchWithDedupe(brainKey, () => Promise.resolve(brainPayload));
    await fetchWithDedupe(brainKey, () => Promise.reject(new Error("refresh failed"))).catch(() => {});
    const html = renderToStaticMarkup(<EngineeringBrainPanel />);
    expect(html).toContain("src/lib/budgeting/plan.js");
    expect(html).not.toContain("Searching the engineering brain");
  });

  it("renders cached UI-improvement proposals instantly with no loading flash", async () => {
    await fetchWithDedupe("ui-improvement:proposals", () => Promise.resolve(proposalsPayload));
    const html = renderToStaticMarkup(<UiImprovementManagerPanel />);
    expect(html).toContain("Horizontal overflow");
    expect(html).not.toContain("Loading proposals");
  });

  it("shows the proposals skeleton only when nothing is cached", () => {
    const html = renderToStaticMarkup(<UiImprovementManagerPanel />);
    expect(html).toContain("Loading proposals…");
  });

  it("keeps the last good proposals visible when a refresh fails", async () => {
    await fetchWithDedupe("ui-improvement:proposals", () => Promise.resolve(proposalsPayload));
    await fetchWithDedupe("ui-improvement:proposals", () => Promise.reject(new Error("refresh failed"))).catch(() => {});
    const html = renderToStaticMarkup(<UiImprovementManagerPanel />);
    expect(html).toContain("Horizontal overflow");
    expect(html).not.toContain("Loading proposals");
  });
});

describe("call shield + workspace warm-switch behavior", () => {
  it("renders cached call-shield cases and imports instantly with no loading flash", async () => {
    await fetchWithDedupe("call-shield:home", () => Promise.resolve(callShieldPayload));
    const html = renderToStaticMarkup(<CallShieldHome />);
    expect(html).toContain("Cruise Agency");
    expect(html).toContain("555-0100");
    expect(html).not.toContain("Loading Call Shield");
  });

  it("shows the call-shield skeleton only when nothing is cached", () => {
    const html = renderToStaticMarkup(<CallShieldHome />);
    expect(html).toContain("Loading Call Shield…");
  });

  it("keeps the last good call-shield lists visible when a refresh fails", async () => {
    await fetchWithDedupe("call-shield:home", () => Promise.resolve(callShieldPayload));
    await fetchWithDedupe("call-shield:home", () => Promise.reject(new Error("refresh failed"))).catch(() => {});
    const html = renderToStaticMarkup(<CallShieldHome />);
    expect(html).toContain("Cruise Agency");
    expect(html).not.toContain("Loading Call Shield");
  });

  it("renders cached workspace members instantly with no loading flash", async () => {
    await fetchWithDedupe("workspace:members", () => Promise.resolve(membersPayload));
    const html = renderToStaticMarkup(<WorkspaceMembersPanel />);
    expect(html).toContain("brandy@example.com");
    expect(html).not.toContain("Loading membership status");
  });

  it("shows the members skeleton only when nothing is cached", () => {
    const html = renderToStaticMarkup(<WorkspaceMembersPanel />);
    expect(html).toContain("Loading membership status…");
  });
});

describe("health + budget warm-switch behavior", () => {
  it("renders cached health records instantly with no loading flash", async () => {
    await fetchWithDedupe("health:dashboard:ws_test", () => Promise.resolve(healthPayload));
    const html = renderToStaticMarkup(<HealthDashboard initialMembership={{ workspace_id: "ws_test" }} />);
    expect(html).toContain("jason@example.com");
    expect(html).not.toContain("Loading private health records");
  });

  it("shows the health skeleton only when nothing is cached", () => {
    const html = renderToStaticMarkup(<HealthDashboard initialMembership={{ workspace_id: "ws_cold" }} />);
    expect(html).toContain("Loading private health records…");
  });

  it("keeps the last good health records visible when a refresh fails", async () => {
    await fetchWithDedupe("health:dashboard:ws_test", () => Promise.resolve(healthPayload));
    await fetchWithDedupe("health:dashboard:ws_test", () => Promise.reject(new Error("refresh failed"))).catch(() => {});
    const html = renderToStaticMarkup(<HealthDashboard initialMembership={{ workspace_id: "ws_test" }} />);
    expect(html).toContain("jason@example.com");
    expect(html).not.toContain("Loading private health records");
  });

  it("renders the cached budget instantly with no loading flash", async () => {
    await fetchWithDedupe(`budget:${budgetMonth()}:personal`, () => Promise.resolve(budgetPayload));
    const html = renderToStaticMarkup(<BudgetPanel />);
    expect(html).toContain("Groceries");
    expect(html).not.toContain("Loading your budget");
  });

  it("shows the budget skeleton only when nothing is cached", () => {
    const html = renderToStaticMarkup(<BudgetPanel />);
    expect(html).toContain("Loading your budget…");
  });

  it("keeps the last good budget visible when a refresh fails", async () => {
    await fetchWithDedupe(`budget:${budgetMonth()}:personal`, () => Promise.resolve(budgetPayload));
    await fetchWithDedupe(`budget:${budgetMonth()}:personal`, () => Promise.reject(new Error("refresh failed"))).catch(() => {});
    const html = renderToStaticMarkup(<BudgetPanel />);
    expect(html).toContain("Groceries");
    expect(html).not.toContain("Loading your budget");
  });
});
