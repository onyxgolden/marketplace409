// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SAVE_CONFLICT_MESSAGE, usePersistedBoard } from "./usePersistedBoard";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// SCHED-20: usePersistedBoard is the only place that tracks the optimistic-concurrency
// revision token and reacts to a 409 -- a component-level test (SchedulingBoard.jsx renders
// far more than this hook) would leave those exact behaviors unverified. This mounts the
// hook directly through a minimal host component, the same technique this session already
// used for PropertyOperatingCostsPanel/PropertyConditionAssessmentPanel, so a regression here
// fails with the same error path a real autosave loop would hit.
function Harness({ projectId }) {
  const { board, setBoard, isOwner, isLoading, loadError, saveStatus, conflict, conflictMessage, reload } = usePersistedBoard(projectId);
  return (
    <div>
      <span data-testid="projectName">{board.projectName}</span>
      <span data-testid="revision">{String(board.boardRevision)}</span>
      <span data-testid="saveStatus">{saveStatus}</span>
      <span data-testid="conflict">{conflict ? "conflict" : "ok"}</span>
      <span data-testid="conflictMessage">{conflictMessage}</span>
      <span data-testid="loadError">{loadError || ""}</span>
      <span data-testid="isOwner">{isOwner ? "owner" : "readonly"}</span>
      <span data-testid="isLoading">{isLoading ? "loading" : "loaded"}</span>
      <button type="button" data-testid="edit" onClick={() => setBoard((c) => ({ ...c, projectName: `${c.projectName}!` }))}>edit</button>
      <button type="button" data-testid="reload" onClick={reload}>reload</button>
    </div>
  );
}

function jsonResponse(body, ok = true, status = ok ? 200 : 500) {
  return Promise.resolve({ ok, status, json: () => Promise.resolve(body) });
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
function rerender({ root }, ui) {
  act(() => root.render(ui));
}
async function flushMicrotasks() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
}
async function advanceAndFlush(ms) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}
function text(container, testId) {
  return container.querySelector(`[data-testid="${testId}"]`).textContent;
}
function boardFixture(overrides = {}) {
  return {
    id: "p1", projectName: "Mine", startDate: "2026-01-01", endDate: "2026-12-31",
    lanes: [], blocks: [], dependencies: [], calendars: [], blackoutWindows: [],
    wbs: { nodes: [], activities: [] }, nextId: 1, nextTaskNumber: 1010, boardRevision: 4,
    ...overrides,
  };
}

describe("usePersistedBoard -- SCHED-20 optimistic concurrency", () => {
  let putCalls;

  beforeEach(() => {
    vi.useFakeTimers();
    putCalls = [];
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("sends the just-loaded board_revision as expectedRevision on the first save", async () => {
    global.fetch = vi.fn((url, init) => {
      if (!init || !init.method) return jsonResponse({ success: true, board: boardFixture(), isOwner: true });
      if (init.method === "PUT") { putCalls.push(JSON.parse(init.body)); return jsonResponse({ success: true, updatedAt: "t", boardRevision: 5 }); }
      throw new Error(`unexpected ${init.method}`);
    });

    const mounted = mount(<Harness projectId="p1" />);
    await flushMicrotasks();
    expect(text(mounted.container, "revision")).toBe("4");

    act(() => { mounted.container.querySelector('[data-testid="edit"]').click(); });
    await advanceAndFlush(500);
    await flushMicrotasks();

    expect(putCalls).toHaveLength(1);
    expect(putCalls[0].boardRevision).toBe(4);
    unmount(mounted);
  });

  it("updates its revision token after a successful save, so the NEXT save doesn't send a stale expectedRevision", async () => {
    global.fetch = vi.fn((url, init) => {
      if (!init || !init.method) return jsonResponse({ success: true, board: boardFixture(), isOwner: true });
      if (init.method === "PUT") { putCalls.push(JSON.parse(init.body)); return jsonResponse({ success: true, updatedAt: "t", boardRevision: 5 }); }
      throw new Error(`unexpected ${init.method}`);
    });

    const mounted = mount(<Harness projectId="p1" />);
    await flushMicrotasks();

    act(() => { mounted.container.querySelector('[data-testid="edit"]').click(); });
    await advanceAndFlush(500);
    await flushMicrotasks();
    expect(putCalls[0].boardRevision).toBe(4);

    act(() => { mounted.container.querySelector('[data-testid="edit"]').click(); });
    await advanceAndFlush(500);
    await flushMicrotasks();

    expect(putCalls).toHaveLength(2);
    expect(putCalls[1].boardRevision).toBe(5);
    unmount(mounted);
  });

  it("flags a conflict and shows the required reload message on a 409, without throwing", async () => {
    global.fetch = vi.fn((url, init) => {
      if (!init || !init.method) return jsonResponse({ success: true, board: boardFixture(), isOwner: true });
      if (init.method === "PUT") {
        putCalls.push(JSON.parse(init.body));
        return jsonResponse({ error: SAVE_CONFLICT_MESSAGE, code: "SCHEDULE_SAVE_CONFLICT" }, false, 409);
      }
      throw new Error(`unexpected ${init.method}`);
    });

    const mounted = mount(<Harness projectId="p1" />);
    await flushMicrotasks();
    expect(text(mounted.container, "conflict")).toBe("ok");

    act(() => { mounted.container.querySelector('[data-testid="edit"]').click(); });
    await advanceAndFlush(500);
    await flushMicrotasks();

    expect(text(mounted.container, "conflict")).toBe("conflict");
    expect(text(mounted.container, "conflictMessage")).toBe(SAVE_CONFLICT_MESSAGE);
    expect(text(mounted.container, "saveStatus")).toBe("Save failed");
    unmount(mounted);
  });

  it("does not retry indefinitely after a conflict -- a further edit triggers no additional save attempt", async () => {
    global.fetch = vi.fn((url, init) => {
      if (!init || !init.method) return jsonResponse({ success: true, board: boardFixture(), isOwner: true });
      if (init.method === "PUT") {
        putCalls.push(JSON.parse(init.body));
        return jsonResponse({ error: SAVE_CONFLICT_MESSAGE, code: "SCHEDULE_SAVE_CONFLICT" }, false, 409);
      }
      throw new Error(`unexpected ${init.method}`);
    });

    const mounted = mount(<Harness projectId="p1" />);
    await flushMicrotasks();

    act(() => { mounted.container.querySelector('[data-testid="edit"]').click(); });
    await advanceAndFlush(500);
    await flushMicrotasks();
    expect(putCalls).toHaveLength(1);
    expect(text(mounted.container, "conflict")).toBe("conflict");

    // A second edit after the conflict must not schedule another PUT -- the hook stops
    // autosaving entirely until reload() runs.
    act(() => { mounted.container.querySelector('[data-testid="edit"]').click(); });
    await advanceAndFlush(500);
    await flushMicrotasks();
    expect(putCalls).toHaveLength(1);
    unmount(mounted);
  });

  it("reload() clears the conflict and refreshes the revision token from the server", async () => {
    let getCount = 0;
    global.fetch = vi.fn((url, init) => {
      if (!init || !init.method) {
        getCount += 1;
        return jsonResponse({ success: true, board: boardFixture(getCount === 1 ? {} : { boardRevision: 9 }), isOwner: true });
      }
      if (init.method === "PUT") {
        putCalls.push(JSON.parse(init.body));
        return jsonResponse({ error: SAVE_CONFLICT_MESSAGE, code: "SCHEDULE_SAVE_CONFLICT" }, false, 409);
      }
      throw new Error(`unexpected ${init.method}`);
    });

    const mounted = mount(<Harness projectId="p1" />);
    await flushMicrotasks();
    act(() => { mounted.container.querySelector('[data-testid="edit"]').click(); });
    await advanceAndFlush(500);
    await flushMicrotasks();
    expect(text(mounted.container, "conflict")).toBe("conflict");

    act(() => { mounted.container.querySelector('[data-testid="reload"]').click(); });
    await flushMicrotasks();

    expect(text(mounted.container, "conflict")).toBe("ok");
    expect(text(mounted.container, "revision")).toBe("9");
    unmount(mounted);
  });
});

// Live audit 2026-11-10 ~15:21 CST (scheduling-board-hydration-loading-state): a project
// board rendered the empty-default state (projectName "New Project", today's dates, zero
// blocks) while its data was still loading, indistinguishable from a genuinely empty
// project -- UI state pretending to be saved data. isLoading is the fix's one new signal:
// true from the moment there is a real project id to fetch, false once that fetch settles
// (success or failure), so the UI can tell "still loading" apart from "loaded and empty".
describe("usePersistedBoard -- isLoading", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is true while a real project's fetch is still pending, then false once it resolves", async () => {
    let resolveFetch;
    global.fetch = vi.fn(() => new Promise((resolve) => { resolveFetch = resolve; }));

    const mounted = mount(<Harness projectId="p1" />);
    // Non-vacuous: assert the pending state BEFORE resolving, not just the end state.
    expect(text(mounted.container, "isLoading")).toBe("loading");

    await act(async () => { resolveFetch(await jsonResponse({ success: true, board: boardFixture(), isOwner: true })); });
    expect(text(mounted.container, "isLoading")).toBe("loaded");
    unmount(mounted);
  });

  it("becomes false even when the load fails, so an error state is never stuck behind a permanent loading state", async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) }));

    const mounted = mount(<Harness projectId="p1" />);
    expect(text(mounted.container, "isLoading")).toBe("loading");

    await flushMicrotasks();
    expect(text(mounted.container, "isLoading")).toBe("loaded");
    expect(text(mounted.container, "loadError")).toBe("Unable to load this project.");
    unmount(mounted);
  });

  it("starts false with no project id -- there is nothing to load, so no loading state is owed", () => {
    global.fetch = vi.fn(() => new Promise(() => {})); // never resolves; must not matter
    const mounted = mount(<Harness projectId={undefined} />);
    expect(text(mounted.container, "isLoading")).toBe("loaded");
    unmount(mounted);
  });
});

// Follow-up to the above (scheduling-board-project-switch-stale-flash, PR #776 review):
// App Router's soft navigation keeps this component mounted across a project switch --
// `projectId` changes as a prop, the instance does not remount -- so isLoading's
// mount-only initializer never re-fires on its own. Without resetting isLoading/loadError
// when `projectId` changes, the PREVIOUS project's board stayed on screen, apparently
// "loaded", for the whole new fetch.
describe("usePersistedBoard -- project switch", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("goes back to loading immediately when projectId changes, not left showing the previous project's board", async () => {
    global.fetch = vi.fn(() => jsonResponse({ success: true, board: boardFixture({ id: "p1", projectName: "First" }), isOwner: true }));
    const mounted = mount(<Harness projectId="p1" />);
    await flushMicrotasks();
    expect(text(mounted.container, "isLoading")).toBe("loaded");
    expect(text(mounted.container, "projectName")).toBe("First");

    let resolveSecond;
    global.fetch = vi.fn(() => new Promise((resolve) => { resolveSecond = resolve; }));
    rerender(mounted, <Harness projectId="p2" />);
    // Non-vacuous: assert the switch is in-flight BEFORE the second project resolves --
    // this is exactly the window the previous code left showing project 1's stale board
    // with isLoading already (wrongly) false.
    expect(text(mounted.container, "isLoading")).toBe("loading");
    expect(text(mounted.container, "projectName")).toBe("First");

    await act(async () => { resolveSecond(await jsonResponse({ success: true, board: boardFixture({ id: "p2", projectName: "Second" }), isOwner: true })); });
    expect(text(mounted.container, "isLoading")).toBe("loaded");
    expect(text(mounted.container, "projectName")).toBe("Second");
    unmount(mounted);
  });

  it("clears a stale loadError from the previous project when switching, instead of carrying it over", async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) }));
    const mounted = mount(<Harness projectId="p1" />);
    await flushMicrotasks();
    expect(text(mounted.container, "loadError")).toBe("Project not found.");

    let resolveSecond;
    global.fetch = vi.fn(() => new Promise((resolve) => { resolveSecond = resolve; }));
    rerender(mounted, <Harness projectId="p2" />);
    expect(text(mounted.container, "loadError")).toBe("");

    await act(async () => { resolveSecond(await jsonResponse({ success: true, board: boardFixture({ id: "p2" }), isOwner: true })); });
    expect(text(mounted.container, "loadError")).toBe("");
    unmount(mounted);
  });

  it("an edit made during the switch window schedules no save at all -- the stale-data autosave this follow-up closes", async () => {
    vi.useFakeTimers();
    global.fetch = vi.fn(() => jsonResponse({ success: true, board: boardFixture({ id: "p1", projectName: "First" }), isOwner: true }));
    const mounted = mount(<Harness projectId="p1" />);
    await flushMicrotasks();

    let resolveSecond;
    global.fetch = vi.fn((url, init) => {
      if (init?.method === "PUT") throw new Error("must not save during a switch");
      return new Promise((resolve) => { resolveSecond = resolve; });
    });
    rerender(mounted, <Harness projectId="p2" />);
    expect(text(mounted.container, "isLoading")).toBe("loading");

    // Simulate an edit landing in the switch window, before project 2 has resolved --
    // without the isLoading guard, this schedules a PUT keyed to the stale board 500ms out.
    act(() => { mounted.container.querySelector('[data-testid="edit"]').click(); });
    await advanceAndFlush(500);
    // The 500ms timer has fired with no PUT thrown (the global.fetch above throws if one is
    // attempted) -- the isLoading guard skipped scheduling the save entirely.

    await act(async () => { resolveSecond(await jsonResponse({ success: true, board: boardFixture({ id: "p2", projectName: "Second" }), isOwner: true })); });
    expect(text(mounted.container, "isLoading")).toBe("loaded");
    vi.useRealTimers();
    unmount(mounted);
  });
});
