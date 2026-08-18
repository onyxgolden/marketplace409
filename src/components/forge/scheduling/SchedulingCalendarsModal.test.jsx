import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import SchedulingCalendarsModal from "./SchedulingCalendarsModal";
import { defaultBoardState } from "./schedulingBoardState";

const noop = () => {};

describe("SchedulingCalendarsModal", () => {
  it("renders every preset calendar, the default badge, and its working days", () => {
    const board = defaultBoardState();
    const markup = renderToStaticMarkup(
      <SchedulingCalendarsModal board={board} onClose={noop} onAddCalendar={noop} onRemoveCalendar={noop}
        onSetDefaultCalendar={noop} onAddBlackout={noop} onRemoveBlackout={noop} />
    );
    expect(markup).toContain("data-scheduling-calendars");
    for (const calendar of board.calendars) expect(markup).toContain(calendar.name);
    expect(markup).toContain("DEFAULT");
    expect(markup).toContain("Mon, Tue, Wed, Thu, Fri"); // 5-10s, the seeded default
  });

  it("renders the add-calendar form with a checkbox per weekday", () => {
    const markup = renderToStaticMarkup(
      <SchedulingCalendarsModal board={defaultBoardState()} onClose={noop} onAddCalendar={noop} onRemoveCalendar={noop}
        onSetDefaultCalendar={noop} onAddBlackout={noop} onRemoveBlackout={noop} />
    );
    expect(markup).toContain("Add a custom calendar");
    expect((markup.match(/type="checkbox"/g) || []).length).toBe(7);
  });

  it("shows the empty state and add form for blackout windows, and lists any that exist", () => {
    const board = { ...defaultBoardState(), blackoutWindows: [{ id: "blackout_1", label: "TA freeze", startDate: "2026-12-20", endDate: "2027-01-02" }] };
    const markup = renderToStaticMarkup(
      <SchedulingCalendarsModal board={board} onClose={noop} onAddCalendar={noop} onRemoveCalendar={noop}
        onSetDefaultCalendar={noop} onAddBlackout={noop} onRemoveBlackout={noop} />
    );
    expect(markup).toContain("TA freeze");
    expect(markup).toContain("2026-12-20");
    expect(markup).not.toContain("No blackout windows yet.");

    const emptyMarkup = renderToStaticMarkup(
      <SchedulingCalendarsModal board={defaultBoardState()} onClose={noop} onAddCalendar={noop} onRemoveCalendar={noop}
        onSetDefaultCalendar={noop} onAddBlackout={noop} onRemoveBlackout={noop} />
    );
    expect(emptyMarkup).toContain("No blackout windows yet.");
  });
});
