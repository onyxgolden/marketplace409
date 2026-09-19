import { describe, expect, it } from "vitest";
import { buildReservationLifecycleSteps } from "./lifecycleTimeline";

describe("buildReservationLifecycleSteps", () => {
  it("renders the forward chain with the record's stage as current", () => {
    const steps = buildReservationLifecycleSteps({ status: "confirmed" });
    expect(steps.map(step => [step.label, step.state])).toEqual([
      ["Requested", "complete"],
      ["Confirmed", "current"],
      ["Checked in", "upcoming"],
      ["Checked out", "upcoming"],
    ]);
  });

  it("marks every stage complete when the stay is checked out", () => {
    const steps = buildReservationLifecycleSteps({ status: "checked_out" });
    expect(steps.every(step => step.state === "complete")).toBe(true);
    expect(steps).toHaveLength(4);
  });

  it("attaches event dates to the stages the immutable history records", () => {
    const steps = buildReservationLifecycleSteps({
      status: "checked_in",
      events: [
        { event_type: "created", occurred_at: "2026-09-01T12:00:00.000Z" },
        { event_type: "confirmed", occurred_at: "2026-09-02T12:00:00.000Z" },
        { event_type: "note_added", occurred_at: "2026-09-03T12:00:00.000Z" },
        { event_type: "checked_in", occurred_at: "2026-09-10T12:00:00.000Z" },
      ],
    });
    expect(steps.map(step => [step.label, step.state])).toEqual([
      ["Requested", "complete"],
      ["Confirmed", "complete"],
      ["Checked in", "current"],
      ["Checked out", "upcoming"],
    ]);
    expect(steps[0].detail).toBe("Sep 1, 2026");
    expect(steps[2].detail).toBe("Sep 10, 2026");
  });

  it("ends a cancelled stay with a failed terminal step and never pretends later stages happened", () => {
    const steps = buildReservationLifecycleSteps({
      status: "cancelled",
      events: [
        { event_type: "created", occurred_at: "2026-09-01T12:00:00.000Z" },
        { event_type: "cancelled", occurred_at: "2026-09-05T12:00:00.000Z" },
      ],
    });
    expect(steps.map(step => [step.label, step.state])).toEqual([
      ["Requested", "complete"],
      ["Cancelled", "failed"],
    ]);
    expect(steps[1].detail).toBe("Sep 5, 2026");
  });

  it("shows only the terminal step when nothing earlier was recorded", () => {
    const steps = buildReservationLifecycleSteps({ status: "cancelled", events: [] });
    expect(steps).toEqual([{ label: "Cancelled", state: "failed" }]);
  });

  it("treats held as created-but-not-confirmed", () => {
    const steps = buildReservationLifecycleSteps({ status: "held" });
    expect(steps.map(step => [step.label, step.state])).toEqual([
      ["Requested", "current"],
      ["Confirmed", "upcoming"],
      ["Checked in", "upcoming"],
      ["Checked out", "upcoming"],
    ]);
  });

  it("is honest about an unrecognized status instead of inventing stages", () => {
    const steps = buildReservationLifecycleSteps({ status: "mystery" });
    expect(steps).toHaveLength(1);
    expect(steps[0].state).toBe("current");
  });
});
