// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CallShieldHome, { CaseTimeline, ImportCountLine } from "./CallShieldHome.jsx";
import { clearSWRCache, seedCacheEntry } from "@/hooks/swrCache.js";
import { fetchAllImports } from "@/domains/callShield/callShieldImport";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;


const TIMELINE_EVENTS = [
  {
    id: "event-opened",
    type: "CASE_OPENED",
    payload: { caseId: "case-1", reportedBusinessName: "Cruise Co", notes: "Called twice today" },
    recordedAt: "2026-09-23T16:00:00.000Z",
  },
  {
    id: "event-call",
    type: "CALL_LOGGED",
    payload: {
      caseId: "case-1",
      callId: "call-1",
      numberShown: "(713) 239-9946",
      occurredAt: "2026-09-23T15:23:00.000Z",
      direction: "incoming",
      businessNameStated: "Cruise Co",
      agentName: "Mike",
      pitchNotes: "Offered a free cruise.",
    },
    recordedAt: "2026-09-23T16:01:00.000Z",
  },
  {
    id: "event-optout",
    type: "OPT_OUT_RECORDED",
    payload: {
      caseId: "case-1",
      optOutId: "oo-1",
      channel: "verbal",
      occurredAt: "2026-09-24T10:00:00.000Z",
      notes: "Said stop calling",
    },
    recordedAt: "2026-09-24T10:05:00.000Z",
  },
];

describe("CaseTimeline", () => {
  it("renders the case's events in order with human-readable labels", () => {
    const html = renderToStaticMarkup(<CaseTimeline events={TIMELINE_EVENTS} />);
    expect(html).toContain("Case opened");
    expect(html).toContain("Reported as Cruise Co.");
    expect(html).toContain("Called twice today");
    expect(html).toContain("Call logged");
    expect(html).toContain("(713) 239-9946");
    expect(html).toContain("Claimed to represent Cruise Co.");
    expect(html).toContain("Agent: Mike.");
    expect(html).toContain("Offered a free cruise.");
    expect(html).toContain("Opt-out recorded");
    expect(html).toContain("Channel: verbal.");
    // Chronological: opened before the call, the call before the opt-out.
    const opened = html.indexOf("Case opened");
    const call = html.indexOf("Call logged");
    const optOut = html.indexOf("Opt-out recorded");
    expect(opened).toBeLessThan(call);
    expect(call).toBeLessThan(optOut);
  });

  it("renders an empty state when the case has no events", () => {
    const html = renderToStaticMarkup(<CaseTimeline events={[]} />);
    expect(html).toContain("No timeline events yet.");
  });

  it("falls back to the raw type for unknown event types", () => {
    const html = renderToStaticMarkup(
      <CaseTimeline
        events={[
          { id: "e", type: "SOMETHING_NEW", payload: {}, recordedAt: "2026-09-23T16:00:00.000Z" },
        ]}
      />,
    );
    expect(html).toContain("SOMETHING_NEW");
  });
});

describe("ImportCountLine", () => {
  it("shows how many staged calls are visible out of the total", () => {
    const html = renderToStaticMarkup(<ImportCountLine visible={3} total={350} />);
    expect(html).toContain("Showing 3 of 350 staged calls.");
  });

  it("renders nothing when the total is unknown", () => {
    expect(renderToStaticMarkup(<ImportCountLine visible={3} total={null} />)).toBe("");
  });
});

describe("fetchAllImports", () => {
  it("pages through the full queue and returns the total", async () => {
    const seen = [];
    const apiFn = async (path) => {
      seen.push(path);
      const page = Number(new URL(path, "https://test").searchParams.get("page"));
      const total = 450;
      const start = (page - 1) * 200;
      const batch = Array.from({ length: Math.min(200, total - start) }, (_, i) => ({
        id: `row-${start + i}`,
      }));
      return { items: batch, total, page, pageSize: 200 };
    };
    const { items, total } = await fetchAllImports(apiFn);
    expect(items).toHaveLength(450);
    expect(total).toBe(450);
    expect(seen).toEqual([
      "/api/call-shield/imports?page=1&pageSize=200",
      "/api/call-shield/imports?page=2&pageSize=200",
      "/api/call-shield/imports?page=3&pageSize=200",
    ]);
  });

  it("stops after a single page when the queue fits", async () => {
    let calls = 0;
    const apiFn = async () => {
      calls += 1;
      return { items: [{ id: "row-1" }], total: 1, page: 1, pageSize: 200 };
    };
    const { items, total } = await fetchAllImports(apiFn);
    expect(items).toHaveLength(1);
    expect(total).toBe(1);
    expect(calls).toBe(1);
  });
});

const stagedImport = {
  id: "imp_1",
  phone_number: "5550100001",
  caller_name: "Acme Supplies",
  started_at: new Date(2026, 8, 25, 9).toISOString(),
  duration_seconds: 30,
  call_type: "incoming",
};

let fetchMock;
let mounted;

function seed(imports = [stagedImport]) {
  clearSWRCache();
  seedCacheEntry("call-shield:home", {
    cases: [{ id: "case_1", reportedBusinessName: "Acme" }],
    imports,
  });
  seedCacheEntry("call-shield:labels", []);
  fetchMock = vi.fn(async (url, init) => {
    if (init?.method === "PATCH" && String(url).includes("/api/call-shield/imports/imp_1")) {
      return { ok: true, json: async () => ({ success: true }) };
    }
    if (String(url).includes("/api/call-shield/cases")) {
      return { ok: true, json: async () => ({ items: [{ id: "case_1", reportedBusinessName: "Acme" }] }) };
    }
    if (String(url).includes("/api/call-shield/imports")) {
      return { ok: true, json: async () => ({ items: [] }) };
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
}

async function mountHome() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(<CallShieldHome />); });
  mounted = { container, root };
  return mounted;
}

function dismissButton(container) {
  const button = [...container.querySelectorAll("button")].find((b) => b.textContent === "Dismiss");
  expect(button).not.toBeUndefined();
  return button;
}

beforeEach(() => { vi.clearAllMocks(); });

afterEach(() => {
  if (mounted) { act(() => mounted.root.unmount()); mounted.container.remove(); mounted = null; }
  vi.unstubAllGlobals();
  clearSWRCache();
  document.body.innerHTML = "";
});

describe("CallShieldHome web import fallback", () => {
  it("explains why auto-import is unavailable, what still works, and links onward — never a silent dead end", async () => {
    seed();
    const { container } = await mountHome();
    const heading = [...container.querySelectorAll("p")].find((p) =>
      p.textContent.includes("Automatic import needs the Call Shield Android app"),
    );
    expect(heading).not.toBeUndefined();
    const fallback = heading.closest("div");
    // Why it's unavailable
    expect(fallback.textContent).toContain("not allowed to read your call history");
    // What still works on the web anyway
    expect(fallback.textContent).toContain("Everything else on this page already works here");
    // Concrete next steps
    expect(fallback.textContent).toContain("Install the Call Shield app on your phone");
    // A clear action to continue in the full web view
    const continueLink = fallback.querySelector('a[href="#call-shield-cases"]');
    expect(continueLink).not.toBeNull();
    expect(continueLink.textContent).toContain("Continue working with your cases");
    // The cases section is a real anchor target for that link
    expect(container.querySelector("#call-shield-cases")).not.toBeNull();
  });

  it("does not show the fallback when running inside the native app shell", async () => {
    window.Capacitor = { isNativePlatform: () => true };
    try {
      seed();
      const { container } = await mountHome();
      const heading = [...container.querySelectorAll("p")].find((p) =>
        p.textContent.includes("Automatic import needs the Call Shield Android app"),
      );
      expect(heading).toBeUndefined();
      const importButton = [...container.querySelectorAll("button")].find((b) =>
        b.textContent.includes("Import last 30 days from this phone"),
      );
      expect(importButton).not.toBeUndefined();
    } finally {
      delete window.Capacitor;
    }
  });
});

describe("CallShieldHome dismiss confirmation", () => {
  it("gates dismissing a staged import behind a confirm naming the call — no PATCH fires on click alone", async () => {
    seed();
    const { container } = await mountHome();
    await act(async () => { dismissButton(container).click(); });

    const dialog = container.querySelector('[role="alertdialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog.textContent).toContain("5550100001");
    expect(dialog.textContent).toContain("Acme Supplies");
    expect(dialog.textContent).toContain("one-way");
    const patches = fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH");
    expect(patches).toHaveLength(0);
  });

  it("issues the dismiss PATCH only after the confirmation is confirmed", async () => {
    seed();
    const { container } = await mountHome();
    await act(async () => { dismissButton(container).click(); });
    const confirmButton = [...container.querySelector('[role="alertdialog"]').querySelectorAll("button")]
      .find((b) => b.textContent === "Confirm dismiss");
    expect(confirmButton).not.toBeUndefined();
    await act(async () => { confirmButton.click(); });

    const patches = fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH");
    expect(patches).toHaveLength(1);
    expect(String(patches[0][0])).toContain("/api/call-shield/imports/imp_1");
    expect(JSON.parse(patches[0][1].body)).toEqual({ dismissed: true });
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it("cancelling the dismiss confirmation never issues the PATCH", async () => {
    seed();
    const { container } = await mountHome();
    await act(async () => { dismissButton(container).click(); });
    const cancelButton = [...container.querySelector('[role="alertdialog"]').querySelectorAll("button")]
      .find((b) => b.textContent === "Cancel");
    await act(async () => { cancelButton.click(); });

    const patches = fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH");
    expect(patches).toHaveLength(0);
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it("Escape closes the dismiss confirmation without issuing the PATCH", async () => {
    seed();
    const { container } = await mountHome();
    await act(async () => { dismissButton(container).click(); });
    expect(container.querySelector('[role="alertdialog"]')).not.toBeNull();
    // The dialog handles keydown itself; dispatch on the dialog so it bubbles.
    await act(async () => {
      container.querySelector('[role="alertdialog"]')
        .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
    const patches = fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH");
    expect(patches).toHaveLength(0);
  });
});
