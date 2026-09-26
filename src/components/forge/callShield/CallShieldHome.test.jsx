import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CaseTimeline, ImportCountLine } from "./CallShieldHome";
import { fetchAllImports } from "@/domains/callShield/callShieldImport";

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
