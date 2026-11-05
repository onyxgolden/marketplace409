// Work Package Planner slice 2 — application tests. Supabase-shaped
// chain mock, same shape as takeoff.test.js, extended with gte/lte/is/
// range for the windowed progress queries and an rpc() mock for the
// transactional write path (the service never writes entries or
// revisions directly — every mutation goes through one RPC).

import { describe, expect, it, vi } from "vitest";
import {
  createProgressEntry,
  correctProgressEntry,
  voidProgressEntry,
  listProgressEntries,
  listProgressRevisions,
  getProgressSummary,
  getDailyProgressTotals,
} from "./progress.js";

function mockDb(chains = [], rpcResults = []) {
  const queue = [...chains];
  const rpcQueue = [...rpcResults];
  return {
    from: vi.fn(() => {
      if (queue.length === 0) throw new Error("mockDb: from() called more times than chains queued");
      return queue.shift();
    }),
    rpc: vi.fn(async () => {
      if (rpcQueue.length === 0) throw new Error("mockDb: rpc() called more times than results queued");
      return rpcQueue.shift();
    }),
  };
}

function chain(result = { data: null, error: null }) {
  const node = {
    select: vi.fn(() => node), eq: vi.fn(() => node), order: vi.fn(() => node),
    limit: vi.fn(() => node), in: vi.fn(() => node), gte: vi.fn(() => node),
    lte: vi.fn(() => node), is: vi.fn(() => node), range: vi.fn(() => node),
    insert: vi.fn(() => node), update: vi.fn(() => node), delete: vi.fn(() => node),
    single: vi.fn(async () => result), maybeSingle: vi.fn(async () => result),
    then: (resolve) => resolve(result),
  };
  return node;
}

const OWNER = "owner_1";
const ACTOR = "user_1";
const ENTRY_ROW = {
  id: "forge_wprg_1", owner_id: OWNER, work_package_id: "pkg_1", takeoff_line_id: "line_1",
  work_date: "2026-11-01", installed_quantity: 10, note: null, version: 1, voided_at: null,
  created_by: ACTOR, updated_by: ACTOR, created_at: "t1", updated_at: "t1",
};

function lineInPackageChains(lineRow, drawingRow) {
  return [
    chain({ data: lineRow, error: null }),
    chain({ data: drawingRow, error: null }),
  ];
}

const LINE_ROW = { id: "line_1", drawing_id: "dwg_pid1", line_no: 1, description: "6in pipe", quantity: 40, unit: "ft" };
const DRAWING_ROW = { id: "dwg_pid1", package_id: "pkg_1", drawing_type: "p_id", p_id_drawing_id: null };

describe("createProgressEntry", () => {
  const input = { lineId: "line_1", workDate: "2026-11-01", installedQuantity: 10 };

  it("rejects invalid input before ever querying the database", async () => {
    const db = mockDb([], []);
    const result = await createProgressEntry(db, {
      ownerId: OWNER, packageId: "pkg_1", actor: ACTOR,
      input: { lineId: "line_1", workDate: "2026-11-01", installedQuantity: -1 },
    });
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(400);
    expect(db.from).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("404s on a missing line without calling the RPC", async () => {
    const db = mockDb([chain({ data: null, error: null })], []);
    const result = await createProgressEntry(db, { ownerId: OWNER, packageId: "pkg_1", actor: ACTOR, input });
    expect(result).toMatchObject({ ok: false, httpStatus: 404 });
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("404s when the line's drawing lives in another package (never trusts the URL package)", async () => {
    const db = mockDb(lineInPackageChains(LINE_ROW, { ...DRAWING_ROW, package_id: "pkg_2" }), []);
    const result = await createProgressEntry(db, { ownerId: OWNER, packageId: "pkg_1", actor: ACTOR, input });
    expect(result).toMatchObject({ ok: false, httpStatus: 404 });
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("creates through the RPC and returns the camelCased entry", async () => {
    const db = mockDb(lineInPackageChains(LINE_ROW, DRAWING_ROW), [{ data: ENTRY_ROW, error: null }]);
    const result = await createProgressEntry(db, { ownerId: OWNER, packageId: "pkg_1", actor: ACTOR, input });
    expect(result.ok).toBe(true);
    expect(result.entry).toMatchObject({ id: "forge_wprg_1", workDate: "2026-11-01", installedQuantity: 10, version: 1 });
    expect(db.rpc).toHaveBeenCalledWith("forge_work_progress_create", {
      p_owner_id: OWNER, p_package_id: "pkg_1", p_line_id: "line_1",
      p_work_date: "2026-11-01", p_quantity: 10, p_note: null, p_actor: ACTOR,
    });
  });

  it("maps an unknown RPC failure by throwing, never by guessing a status", async () => {
    const db = mockDb(lineInPackageChains(LINE_ROW, DRAWING_ROW), [{ data: null, error: { message: "boom" } }]);
    await expect(createProgressEntry(db, { ownerId: OWNER, packageId: "pkg_1", actor: ACTOR, input }))
      .rejects.toThrow("boom");
  });
});

describe("correctProgressEntry", () => {
  const patch = { expectedVersion: 1, installedQuantity: 15, reason: "recount" };

  it("requires expectedVersion and at least one change before querying", async () => {
    const db = mockDb([], []);
    const noVersion = await correctProgressEntry(db, {
      ownerId: OWNER, packageId: "pkg_1", entryId: "forge_wprg_1", actor: ACTOR,
      patch: { installedQuantity: 15 },
    });
    expect(noVersion).toMatchObject({ ok: false, httpStatus: 400 });
    const noChange = await correctProgressEntry(db, {
      ownerId: OWNER, packageId: "pkg_1", entryId: "forge_wprg_1", actor: ACTOR,
      patch: { expectedVersion: 1 },
    });
    expect(noChange).toMatchObject({ ok: false, httpStatus: 400 });
    expect(db.from).not.toHaveBeenCalled();
  });

  it("maps a stale version to 409 with the plain-words conflict message", async () => {
    const entryChain = chain({ data: ENTRY_ROW, error: null });
    const db = mockDb(
      [entryChain, ...lineInPackageChains(LINE_ROW, DRAWING_ROW)],
      [{ data: null, error: { message: "WPP2_VERSION_CONFLICT" } }],
    );
    const result = await correctProgressEntry(db, {
      ownerId: OWNER, packageId: "pkg_1", entryId: "forge_wprg_1", actor: ACTOR, patch,
    });
    expect(result).toMatchObject({ ok: false, httpStatus: 409 });
    expect(result.error).toMatch(/changed by someone else/);
  });

  it("accepts the RPC's one-element array form as well as the bare row", async () => {
    const updated = { ...ENTRY_ROW, installed_quantity: 15, version: 2 };
    const db = mockDb(
      [chain({ data: ENTRY_ROW, error: null }), ...lineInPackageChains(LINE_ROW, DRAWING_ROW)],
      [{ data: [updated], error: null }],
    );
    const result = await correctProgressEntry(db, {
      ownerId: OWNER, packageId: "pkg_1", entryId: "forge_wprg_1", actor: ACTOR, patch,
    });
    expect(result.ok).toBe(true);
    expect(result.entry).toMatchObject({ installedQuantity: 15, version: 2 });
  });
});

describe("voidProgressEntry", () => {
  it("voids through the RPC and returns the voided entry", async () => {
    const voided = { ...ENTRY_ROW, voided_at: "2026-11-04T00:00:00Z", version: 2 };
    const db = mockDb(
      [chain({ data: ENTRY_ROW, error: null }), ...lineInPackageChains(LINE_ROW, DRAWING_ROW)],
      [{ data: voided, error: null }],
    );
    const result = await voidProgressEntry(db, {
      ownerId: OWNER, packageId: "pkg_1", entryId: "forge_wprg_1", actor: ACTOR,
      expectedVersion: 1, reason: "duplicate day",
    });
    expect(result.ok).toBe(true);
    expect(result.entry.voidedAt).not.toBeNull();
    expect(db.rpc).toHaveBeenCalledWith("forge_work_progress_void", {
      p_owner_id: OWNER, p_entry_id: "forge_wprg_1", p_expected_version: 1,
      p_reason: "duplicate day", p_actor: ACTOR,
    });
  });

  it("maps a voided-entry RPC failure to 409, not a generic error", async () => {
    const db = mockDb(
      [chain({ data: ENTRY_ROW, error: null }), ...lineInPackageChains(LINE_ROW, DRAWING_ROW)],
      [{ data: null, error: { message: "WPP2_VOIDED" } }],
    );
    const result = await voidProgressEntry(db, {
      ownerId: OWNER, packageId: "pkg_1", entryId: "forge_wprg_1", actor: ACTOR,
      expectedVersion: 1, reason: "again",
    });
    expect(result).toMatchObject({ ok: false, httpStatus: 409 });
    expect(result.error).toMatch(/Voided progress entries cannot be changed/);
  });
});

describe("listProgressEntries", () => {
  it("rejects an inverted or over-wide window and an out-of-range limit before querying", async () => {
    const db = mockDb([], []);
    const inverted = await listProgressEntries(db, {
      ownerId: OWNER, packageId: "pkg_1", from: "2026-11-10", to: "2026-11-01",
    });
    expect(inverted).toMatchObject({ ok: false, httpStatus: 400 });
    const wide = await listProgressEntries(db, {
      ownerId: OWNER, packageId: "pkg_1", from: "2025-01-01", to: "2026-11-01",
    });
    expect(wide).toMatchObject({ ok: false, httpStatus: 400 });
    const badLimit = await listProgressEntries(db, { ownerId: OWNER, packageId: "pkg_1", limit: 500 });
    expect(badLimit).toMatchObject({ ok: false, httpStatus: 400 });
    expect(db.from).not.toHaveBeenCalled();
  });

  it("excludes voided entries only when asked, and pages with range()", async () => {
    const entriesChain = chain({ data: [ENTRY_ROW], error: null });
    const db = mockDb([entriesChain], []);
    const result = await listProgressEntries(db, {
      ownerId: OWNER, packageId: "pkg_1", from: "2026-11-01", to: "2026-11-30",
      includeVoided: false, limit: 50, offset: 10,
    });
    expect(result.ok).toBe(true);
    expect(result.entries).toHaveLength(1);
    expect(entriesChain.is).toHaveBeenCalledWith("voided_at", null);
    expect(entriesChain.range).toHaveBeenCalledWith(10, 59);
    expect(entriesChain.eq).toHaveBeenCalledWith("work_package_id", "pkg_1");
  });
});

describe("listProgressRevisions", () => {
  it("404s on an entry from another package without reading revisions", async () => {
    const db = mockDb([chain({ data: { ...ENTRY_ROW, work_package_id: "pkg_2" }, error: null })], []);
    const result = await listProgressRevisions(db, {
      ownerId: OWNER, packageId: "pkg_1", entryId: "forge_wprg_1",
    });
    expect(result).toMatchObject({ ok: false, httpStatus: 404 });
    expect(db.from).toHaveBeenCalledTimes(1);
  });

  it("returns the entry with its revisions oldest first", async () => {
    const revisionsChain = chain({
      data: [
        { id: "forge_wprv_1", entry_id: "forge_wprg_1", version: 1, actor_id: ACTOR, action: "create", old_quantity: null, new_quantity: 10, old_work_date: null, new_work_date: "2026-11-01", reason: null, recorded_at: "t1" },
        { id: "forge_wprv_2", entry_id: "forge_wprg_1", version: 2, actor_id: ACTOR, action: "update", old_quantity: 10, new_quantity: 15, old_work_date: "2026-11-01", new_work_date: "2026-11-02", reason: "recount", recorded_at: "t2" },
      ],
      error: null,
    });
    const db = mockDb(
      [chain({ data: ENTRY_ROW, error: null }), ...lineInPackageChains(LINE_ROW, DRAWING_ROW), revisionsChain],
      [],
    );
    const result = await listProgressRevisions(db, {
      ownerId: OWNER, packageId: "pkg_1", entryId: "forge_wprg_1",
    });
    expect(result.ok).toBe(true);
    expect(result.revisions.map((r) => r.action)).toEqual(["create", "update"]);
    expect(result.revisions[1]).toMatchObject({ oldQuantity: 10, newQuantity: 15, reason: "recount" });
  });
});

describe("getProgressSummary", () => {
  const pkgChain = () => chain({ data: { id: "pkg_1" }, error: null });
  const drawingsChain = () => chain({
    data: [
      { id: "dwg_pid1", drawing_type: "p_id", p_id_drawing_id: null },
      { id: "dwg_iso1", drawing_type: "isometric", p_id_drawing_id: "dwg_pid1" },
    ],
    error: null,
  });
  const linesChain = () => chain({
    data: [
      { id: "line_1", drawing_id: "dwg_pid1", line_no: 1, description: "6in pipe", quantity: 40, unit: "ft" },
      { id: "line_2", drawing_id: "dwg_iso1", line_no: 1, description: "6in elbow", quantity: 10, unit: "ft" },
    ],
    error: null,
  });
  const entriesChain = () => chain({
    data: [
      { takeoff_line_id: "line_1", work_date: "2026-11-01", installed_quantity: 10, voided_at: null },
      { takeoff_line_id: "line_1", work_date: "2026-11-02", installed_quantity: 5, voided_at: null },
      { takeoff_line_id: "line_1", work_date: "2026-11-03", installed_quantity: 100, voided_at: "2026-11-03T00:00:00Z" },
      { takeoff_line_id: "line_1", work_date: "2026-11-09", installed_quantity: 7, voided_at: null },
      { takeoff_line_id: "line_2", work_date: "2026-11-01", installed_quantity: 10, voided_at: null },
    ],
    error: null,
  });

  it("computes as-of totals: voided and post-as-of entries excluded, child lines rolled into their P&ID", async () => {
    const db = mockDb([pkgChain(), drawingsChain(), linesChain(), entriesChain()], []);
    const result = await getProgressSummary(db, { ownerId: OWNER, packageId: "pkg_1", asOf: "2026-11-05" });
    expect(result.ok).toBe(true);
    const byId = new Map(result.summary.lines.map((l) => [l.lineId, l]));
    expect(byId.get("line_1").installed).toBe(15);
    expect(byId.get("line_1").percentComplete).toBe(37.5);
    expect(byId.get("line_2").installed).toBe(10);
    expect(byId.get("line_2").percentComplete).toBe(100);
    expect(result.summary.pidRollups).toHaveLength(1);
    expect(result.summary.pidRollups[0].aggregatePercent).toBe(50);
    expect(result.summary.package.aggregatePercent).toBe(50);
    expect(result.summary.package.totalInstalled).toBe(25);
  });

  it("a single-line view proves the line's package before summarizing", async () => {
    const singleLineChain = chain({
      data: [
        { id: "line_1", drawing_id: "dwg_pid1", line_no: 1, description: "6in pipe", quantity: 40, unit: "ft" },
      ],
      error: null,
    });
    const db = mockDb(
      [pkgChain(), ...lineInPackageChains(LINE_ROW, DRAWING_ROW), drawingsChain(), singleLineChain, entriesChain()],
      [],
    );
    const result = await getProgressSummary(db, {
      ownerId: OWNER, packageId: "pkg_1", asOf: "2026-11-05", lineId: "line_1",
    });
    expect(result.ok).toBe(true);
    expect(result.summary.lines.map((l) => l.lineId)).toEqual(["line_1"]);
    expect(singleLineChain.eq).toHaveBeenCalledWith("id", "line_1");
  });

  it("404s on a missing package without loading drawings", async () => {
    const db = mockDb([chain({ data: null, error: null })], []);
    const result = await getProgressSummary(db, { ownerId: OWNER, packageId: "pkg_missing", asOf: "2026-11-05" });
    expect(result).toMatchObject({ ok: false, httpStatus: 404 });
    expect(db.from).toHaveBeenCalledTimes(1);
  });
});

describe("getDailyProgressTotals", () => {
  it("groups entries by line and date, voided excluded, earliest first", async () => {
    const entriesChain = chain({
      data: [
        { takeoff_line_id: "line_2", work_date: "2026-11-02", installed_quantity: 3, voided_at: null },
        { takeoff_line_id: "line_1", work_date: "2026-11-01", installed_quantity: 10, voided_at: null },
        { takeoff_line_id: "line_1", work_date: "2026-11-01", installed_quantity: 4, voided_at: null },
        { takeoff_line_id: "line_1", work_date: "2026-11-01", installed_quantity: 99, voided_at: "2026-11-02T00:00:00Z" },
      ],
      error: null,
    });
    const db = mockDb([entriesChain], []);
    const result = await getDailyProgressTotals(db, {
      ownerId: OWNER, packageId: "pkg_1", from: "2026-11-01", to: "2026-11-30",
    });
    expect(result.ok).toBe(true);
    expect(result.days).toEqual([
      { lineId: "line_1", workDate: "2026-11-01", installed: 14 },
      { lineId: "line_2", workDate: "2026-11-02", installed: 3 },
    ]);
  });
});
