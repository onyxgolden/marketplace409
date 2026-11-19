// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import HealthDashboard, { normalizeHealthSnapshot } from "./HealthDashboard";
import { clearSWRCache, seedCacheEntry } from "@/hooks/swrCache";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Minimal supabase stub: the seeded SWR cache is fresh, so the dashboard's
// snapshot fetch never runs in these tests; auth.getUser still runs (it drives
// the default "Viewing" profile), so it resolves the signed-in user.
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => {
    const node = {
      select: () => node,
      eq: () => node,
      order: () => Promise.resolve({ data: [], error: null }),
      insert: () => Promise.resolve({ error: null }),
      update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
    };
    return {
      from: () => node,
      auth: {
        getUser: () =>
          Promise.resolve({ data: { user: { id: "user-1", email: "jasonmorgan99@gmail.com" } } }),
      },
      rpc: vi.fn(() => Promise.resolve({ data: null, error: null })),
      storage: { from: () => ({ remove: () => Promise.resolve({ error: null }) }) },
    };
  },
}));

const WORKSPACE_ID = "ws-1";
const SNAPSHOT_KEY = `health:dashboard:${WORKSPACE_ID}`;

function buildSnapshot(overrides = {}) {
  return {
    profiles: [
      { id: "profile-1", display_name: "jasonmorgan99@gmail.com", profile_type: "self" },
    ],
    conditions: [
      { id: "cond-1", profile_id: "profile-1", name: "High cholesterol", status: "active" },
    ],
    careTeam: [],
    labs: [
      {
        id: "lab-2",
        profile_id: "profile-1",
        marker_name: "LDL cholesterol",
        collected_on: "2026-08-10",
        value_numeric: 200,
        unit: "mg/dL",
        flag: "high",
        reference_low: null,
        reference_high: 100,
      },
      {
        id: "lab-1",
        profile_id: "profile-1",
        marker_name: "LDL cholesterol",
        collected_on: "2026-05-01",
        value_numeric: 140,
        unit: "mg/dL",
        flag: "high",
        reference_low: null,
        reference_high: 100,
      },
    ],
    regimen: [],
    measurements: [],
    workouts: [],
    timeline: [],
    programs: [],
    programDays: [],
    documents: [
      {
        id: "doc-1",
        profile_id: "profile-1",
        category: "lab_report",
        title: "Nov 6 labs",
        document_date: "2026-11-06",
        review_status: "extraction_failed",
        bucket: "health-documents",
        object_path: "ws-1/doc-1.pdf",
      },
    ],
    ...overrides,
  };
}

// A pre-#833 persisted snapshot: every collection except `documents`, which
// PR #833 added to the snapshot shape. This is the exact shape that crashed
// production with `Cannot read properties of undefined (reading 'filter')`.
function buildPre833Snapshot() {
  const snapshot = buildSnapshot();
  delete snapshot.documents;
  return snapshot;
}

function mount(ui) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(ui));
  return { container, root };
}
function unmount({ container, root }) {
  act(() => root.unmount());
  container.remove();
}
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}
async function goToTab(container, label) {
  const tab = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === label,
  );
  await act(async () => {
    tab.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await flush();
  });
}

const ALL_KEYS = [
  "profiles",
  "conditions",
  "careTeam",
  "labs",
  "regimen",
  "measurements",
  "workouts",
  "timeline",
  "programs",
  "programDays",
  "documents",
];

describe("normalizeHealthSnapshot (P1-A stale-snapshot guard)", () => {
  it("(4) null/undefined snapshot resolves every expected collection to an array", () => {
    for (const snapshot of [null, undefined]) {
      const data = normalizeHealthSnapshot(snapshot);
      for (const key of ALL_KEYS) expect(data[key]).toEqual([]);
    }
  });

  it("(2) an arbitrarily omitted collection (conditions, timeline) safely becomes []", () => {
    const withoutConditions = buildSnapshot();
    delete withoutConditions.conditions;
    expect(normalizeHealthSnapshot(withoutConditions).conditions).toEqual([]);
    expect(normalizeHealthSnapshot(withoutConditions).labs).toHaveLength(2);

    const withoutTimeline = buildSnapshot();
    delete withoutTimeline.timeline;
    expect(normalizeHealthSnapshot(withoutTimeline).timeline).toEqual([]);
    expect(normalizeHealthSnapshot(withoutTimeline).documents).toHaveLength(1);
  });

  it("(3) malformed collection values (null, string, object) normalize to []", () => {
    const malformed = buildSnapshot({
      documents: null,
      labs: "not-an-array",
      regimen: { name: "not an array" },
      conditions: 42,
    });
    const data = normalizeHealthSnapshot(malformed);
    expect(data.documents).toEqual([]);
    expect(data.labs).toEqual([]);
    expect(data.regimen).toEqual([]);
    expect(data.conditions).toEqual([]);
    // Untouched keys are still intact.
    expect(data.profiles).toHaveLength(1);
  });

  it("(5) valid arrays are preserved by identity and value (no silent data loss)", () => {
    const snapshot = buildSnapshot();
    const data = normalizeHealthSnapshot(snapshot);
    for (const key of ALL_KEYS) {
      expect(data[key]).toBe(snapshot[key]);
      expect(data[key]).toEqual(snapshot[key]);
    }
  });
});

describe("HealthDashboard with a stale persisted snapshot (P1-A)", () => {
  let mounted;

  beforeEach(() => {
    clearSWRCache();
  });

  afterEach(() => {
    if (mounted) unmount(mounted);
    mounted = null;
  });

  it("(1) pre-#833 snapshot (no documents) renders the dashboard with no throw and normal content", async () => {
    seedCacheEntry(SNAPSHOT_KEY, buildPre833Snapshot());
    mounted = mount(
      <HealthDashboard initialMembership={{ workspace_id: WORKSPACE_ID, role: "owner" }} />,
    );
    await flush();

    // No error boundary, normal Overview content: the profile and its counts.
    expect(mounted.container.textContent).toContain("Health");
    expect(mounted.container.textContent).toContain("jasonmorgan99@gmail.com");
    expect(mounted.container.textContent).toContain("1 active conditions");

    // The Labs tab still works without a documents collection.
    await goToTab(mounted.container, "Labs");
    expect(mounted.container.textContent).toContain("LDL cholesterol");
  });

  it("(3) malformed snapshot values render without throwing", async () => {
    seedCacheEntry(
      SNAPSHOT_KEY,
      buildSnapshot({ documents: null, labs: "not-an-array", conditions: { nope: true } }),
    );
    mounted = mount(
      <HealthDashboard initialMembership={{ workspace_id: WORKSPACE_ID, role: "owner" }} />,
    );
    await flush();

    expect(mounted.container.textContent).toContain("Health");
    expect(mounted.container.textContent).toContain("jasonmorgan99@gmail.com");
    expect(mounted.container.textContent).toContain("0 active conditions");
  });

  it("(6) a complete current snapshot renders fully (normalization preserves valid data)", async () => {
    seedCacheEntry(SNAPSHOT_KEY, buildSnapshot());
    mounted = mount(
      <HealthDashboard initialMembership={{ workspace_id: WORKSPACE_ID, role: "owner" }} />,
    );
    await flush();

    expect(mounted.container.textContent).toContain("Health");
    expect(mounted.container.textContent).toContain("jasonmorgan99@gmail.com");
    expect(mounted.container.textContent).toContain("1 active conditions");

    await goToTab(mounted.container, "Labs");
    expect(mounted.container.textContent).toContain("LDL cholesterol");
    expect(mounted.container.textContent).toContain("Nov 6 labs");
  });
});
