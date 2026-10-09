import { describe, expect, it, vi } from "vitest";
import {
  createWorkPackage, updateWorkPackage, transitionWorkPackage,
  getWorkPackageDetail, listWorkPackages, listPackagePropertyOptions,
  getWorkPackageDeletionEligibility, deleteWorkPackage,
  recordGateAttestation,
  freezeScopeBaseline, proposeScopeChange, decideScopeChange,
  createAsset, createAssetComponent, createLocation, recordInspectionObservation,
} from "./workPackages.js";

// Supabase-shaped chain mock. Each .from() call returns the next queued
// chain; rpc() is stubbed per-test.
function mockDb(chains = [], rpcImpl = null) {
  const queue = [...chains];
  const db = {
    from: vi.fn(() => {
      if (queue.length === 0) throw new Error("mockDb: from() called more times than chains queued");
      return queue.shift();
    }),
    rpc: vi.fn(rpcImpl || (async () => ({ data: 7, error: null }))),
  };
  return db;
}

function chain(result = { data: null, error: null }) {
  const node = {
    select: vi.fn(() => node), eq: vi.fn(() => node), in: vi.fn(() => node),
    order: vi.fn(() => node), limit: vi.fn(() => node),
    insert: vi.fn(() => node), update: vi.fn(() => node),
    single: vi.fn(async () => result), maybeSingle: vi.fn(async () => result),
    then: (resolve) => resolve(result),
  };
  return node;
}

const PKG = { id: "forge_wp_1", owner_id: "owner_1", code: "WP-0007", title: "Turnover",
  package_type: "rental_turn", priority: "normal", status: "draft", version: 3,
  planned_start: "2026-11-01", planned_finish: "2026-11-10",
  responsible_party: { domain: "vendor", type: "contractor", id: "c1", display_name: "Acme" },
  description: "Full turnover scope.", scope_baseline_id: null,
  progress_basis: null, percent_complete: null };

describe("createWorkPackage", () => {
  it("assigns the next per-owner code and starts in draft", async () => {
    const insertChain = chain({ data: { ...PKG, id: "forge_wp_new", code: "WP-0007" }, error: null });
    const db = mockDb([insertChain]);
    const result = await createWorkPackage(db, { ownerId: "owner_1", actor: "user_9",
      input: { title: "Turnover", package_type: "rental_turn" } });
    expect(result.ok).toBe(true);
    expect(db.rpc).toHaveBeenCalledWith("forge_work_next_package_number", { p_owner_id: "owner_1" });
    expect(insertChain.insert).toHaveBeenCalledWith(expect.objectContaining({
      code: "WP-0007", status: "draft", created_by: "user_9",
    }));
  });
  it("rejects invalid input without touching the sequence", async () => {
    const db = mockDb([]);
    const result = await createWorkPackage(db, { ownerId: "owner_1", actor: "user_9",
      input: { title: " ", package_type: "rental_turn" } });
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(400);
    expect(db.rpc).not.toHaveBeenCalled();
  });
});

// --- Residential Slice 2: package <-> property association ----------------
// rental_units rows for owner_1: one canonical slug, one alias of Decker
// stored raw, one unrelated house, one inactive unit (options exclude it).
const UNITS = [
  { id: "unit_1", property_id: "1900-w-decker", label: "1900 W. Decker", status: "active" },
  { id: "unit_2", property_id: "1900-west-decker", label: "1900 West Decker", status: "active" },
  { id: "unit_3", property_id: "4800-kent-ave", label: "4800 Kent Ave", status: "active" },
  { id: "unit_4", property_id: "old-house", label: "Old House", status: "inactive" },
];

describe("package property association (Slice 2)", () => {
  it("persists the canonical property on create, project_id untouched", async () => {
    const insertChain = chain({ data: { ...PKG, property_id: "4800-kent-ave", project_id: "PROJ-9" }, error: null });
    const db = mockDb([chain({ data: UNITS, error: null }), insertChain]);
    const result = await createWorkPackage(db, { ownerId: "owner_1", actor: "user_9",
      input: { title: "Renovation", project_id: "PROJ-9", property_id: "4800-kent-ave" } });
    expect(result.ok).toBe(true);
    expect(insertChain.insert).toHaveBeenCalledWith(expect.objectContaining({
      property_id: "4800-kent-ave", project_id: "PROJ-9",
    }));
    // The units lookup is owner-scoped.
    expect(db.from).toHaveBeenCalledWith("rental_units");
  });

  it("normalizes an alias submission to the canonical slug at write", async () => {
    const insertChain = chain({ data: { ...PKG, property_id: "1900-w-decker" }, error: null });
    const db = mockDb([chain({ data: UNITS, error: null }), insertChain]);
    const result = await createWorkPackage(db, { ownerId: "owner_1", actor: "user_9",
      input: { title: "Turnover", property_id: "1900-west-decker" } });
    expect(result.ok).toBe(true);
    expect(insertChain.insert).toHaveBeenCalledWith(expect.objectContaining({
      property_id: "1900-w-decker",
    }));
  });

  it("rejects an unknown property without consuming a package code", async () => {
    const db = mockDb([chain({ data: UNITS, error: null })]);
    const result = await createWorkPackage(db, { ownerId: "owner_1", actor: "user_9",
      input: { title: "Turnover", property_id: "no-such-house" } });
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(404);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("rejects a cross-owner property with the same 404 (no existence leakage)", async () => {
    // owner_1's units query returns nothing for another owner's house.
    const db = mockDb([chain({ data: [], error: null })]);
    const result = await createWorkPackage(db, { ownerId: "owner_1", actor: "user_9",
      input: { title: "Turnover", property_id: "4800-kent-ave" } });
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(404);
    expect(result.error).toBe("Property not found.");
  });

  it("rejects a unit id offered as a property", async () => {
    const db = mockDb([chain({ data: UNITS, error: null })]);
    const result = await createWorkPackage(db, { ownerId: "owner_1", actor: "user_9",
      input: { title: "Turnover", property_id: "unit_1" } });
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(400);
    expect(result.error).toMatch(/not a single unit/);
  });

  it("creates unassigned without querying rental_units", async () => {
    const insertChain = chain({ data: { ...PKG, property_id: null }, error: null });
    const db = mockDb([insertChain]);
    const result = await createWorkPackage(db, { ownerId: "owner_1", actor: "user_9",
      input: { title: "Turnover" } });
    expect(result.ok).toBe(true);
    expect(db.from).toHaveBeenCalledTimes(1);
    expect(db.from).toHaveBeenCalledWith("forge_work_packages");
    expect(insertChain.insert).toHaveBeenCalledWith(expect.objectContaining({ property_id: null }));
  });

  it("reassigns property A to B on edit", async () => {
    const getChain = chain({ data: { ...PKG, property_id: "1900-w-decker" }, error: null });
    const updateChain = chain({ data: { ...PKG, property_id: "4800-kent-ave" }, error: null });
    const db = mockDb([getChain, chain({ data: UNITS, error: null }), updateChain]);
    const result = await updateWorkPackage(db, { ownerId: "owner_1", actor: "user_9",
      packageId: "forge_wp_1", patch: { property_id: "4800-kent-ave" } });
    expect(result.ok).toBe(true);
    expect(updateChain.update).toHaveBeenCalledWith(expect.objectContaining({
      property_id: "4800-kent-ave",
    }));
  });

  it("clears the property with an explicit null", async () => {
    const getChain = chain({ data: { ...PKG, property_id: "4800-kent-ave" }, error: null });
    const updateChain = chain({ data: { ...PKG, property_id: null }, error: null });
    const db = mockDb([getChain, updateChain]);
    const result = await updateWorkPackage(db, { ownerId: "owner_1", actor: "user_9",
      packageId: "forge_wp_1", patch: { property_id: null } });
    expect(result.ok).toBe(true);
    expect(updateChain.update).toHaveBeenCalledWith(expect.objectContaining({
      property_id: null,
    }));
  });

  it("leaves the association unchanged when the field is absent", async () => {
    const getChain = chain({ data: { ...PKG, property_id: "4800-kent-ave" }, error: null });
    const updateChain = chain({ data: { ...PKG, title: "Renamed", property_id: "4800-kent-ave" }, error: null });
    const db = mockDb([getChain, updateChain]);
    const result = await updateWorkPackage(db, { ownerId: "owner_1", actor: "user_9",
      packageId: "forge_wp_1", patch: { title: "Renamed" } });
    expect(result.ok).toBe(true);
    const patchArg = updateChain.update.mock.calls[0][0];
    expect(patchArg).not.toHaveProperty("property_id");
  });

  it("rejects property edits on terminal packages (before any resolution query)", async () => {
    const db = mockDb([chain({ data: { ...PKG, status: "cancelled" }, error: null })]);
    const result = await updateWorkPackage(db, { ownerId: "owner_1", actor: "user_9",
      packageId: "forge_wp_1", patch: { property_id: "4800-kent-ave" } });
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(409);
  });

  it("normalizes an alias reassignment to the canonical slug", async () => {
    const getChain = chain({ data: { ...PKG, property_id: null }, error: null });
    const updateChain = chain({ data: { ...PKG, property_id: "1900-w-decker" }, error: null });
    const db = mockDb([getChain, chain({ data: UNITS, error: null }), updateChain]);
    const result = await updateWorkPackage(db, { ownerId: "owner_1", actor: "user_9",
      packageId: "forge_wp_1", patch: { property_id: "1900-west-decker" } });
    expect(result.ok).toBe(true);
    expect(updateChain.update).toHaveBeenCalledWith(expect.objectContaining({
      property_id: "1900-w-decker",
    }));
  });
});

describe("listPackagePropertyOptions (Slice 2)", () => {
  it("returns one option per canonical house, aliases deduped, inactive excluded", async () => {
    const db = mockDb([chain({ data: UNITS, error: null })]);
    const result = await listPackagePropertyOptions(db, { ownerId: "owner_1" });
    expect(result.ok).toBe(true);
    expect(result.properties).toEqual([
      { slug: "1900-w-decker", label: "1900 W. Decker" },
      { slug: "4800-kent-ave", label: "4800 Kent Ave" },
    ]);
  });

  it("returns no options when the owner has no properties", async () => {
    const db = mockDb([chain({ data: [], error: null })]);
    const result = await listPackagePropertyOptions(db, { ownerId: "owner_1" });
    expect(result.properties).toEqual([]);
  });
});

describe("updateWorkPackage", () => {
  it("edits allowed fields and re-derives percent_complete", async () => {
    const getChain = chain({ data: { ...PKG, progress_basis: "quantity", planned_qty: 10,
      planned_unit: "each", earned_qty: 0 }, error: null });
    const updateChain = chain({ data: { ...PKG, earned_qty: 5, percent_complete: 50 }, error: null });
    const db = mockDb([getChain, updateChain]);
    const result = await updateWorkPackage(db, { ownerId: "owner_1", actor: "user_9",
      packageId: "forge_wp_1", patch: { earned_qty: 5 } });
    expect(result.ok).toBe(true);
    expect(updateChain.update).toHaveBeenCalledWith(expect.objectContaining({
      earned_qty: 5, percent_complete: 50,
    }));
  });
  it("refuses edits on terminal packages", async () => {
    const db = mockDb([chain({ data: { ...PKG, status: "verified_closed" }, error: null })]);
    const result = await updateWorkPackage(db, { ownerId: "owner_1", actor: "user_9",
      packageId: "forge_wp_1", patch: { title: "New" } });
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(409);
  });
  it("returns 404 for unknown packages", async () => {
    const db = mockDb([chain({ data: null, error: null })]);
    const result = await updateWorkPackage(db, { ownerId: "owner_1", actor: "user_9",
      packageId: "nope", patch: { title: "New" } });
    expect(result.httpStatus).toBe(404);
  });
  it("rejects earned_qty overruns against the stored planned_qty", async () => {
    const db = mockDb([chain({ data: { ...PKG, progress_basis: "quantity",
      planned_qty: 10, planned_unit: "each", earned_qty: 0 }, error: null })]);
    const result = await updateWorkPackage(db, { ownerId: "owner_1", actor: "user_9",
      packageId: "forge_wp_1", patch: { earned_qty: 20 } });
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(400);
    expect(result.error).toMatch(/earned_qty/);
  });
  it("rejects lowering planned_qty below the stored earned_qty", async () => {
    const db = mockDb([chain({ data: { ...PKG, progress_basis: "quantity",
      planned_qty: 10, planned_unit: "each", earned_qty: 8 }, error: null })]);
    const result = await updateWorkPackage(db, { ownerId: "owner_1", actor: "user_9",
      packageId: "forge_wp_1", patch: { planned_qty: 5 } });
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(400);
  });
  it("returns 409 when the package moved under the edit", async () => {
    const db = mockDb([
      chain({ data: { ...PKG, progress_basis: "quantity", planned_qty: 10,
        planned_unit: "each", earned_qty: 0, updated_at: "2026-10-02T21:00:00.000Z" }, error: null }),
      chain({ data: null, error: null }),
    ]);
    const result = await updateWorkPackage(db, { ownerId: "owner_1", actor: "user_9",
      packageId: "forge_wp_1", patch: { earned_qty: 5 } });
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(409);
  });
});

// --- D6: empty-date edit failure -----------------------------------------
// Live shape: the detail form initializes planned_finish to "" on a
// dateless package and the raw value reached a Postgres `date` column
// (SQLSTATE 22007), so reassignment/clearing/restoring all failed. The
// "" must normalize to null before merge/validation; malformed dates are
// a 400, never a database 500.
const DATELESS_PKG = { ...PKG, planned_start: null, planned_finish: null,
  property_id: "1214-wagner" };
const PAULA_UNITS = [
  { id: "unit_a", property_id: "1214-wagner", label: "1214 Wagner", status: "active" },
  { id: "unit_b", property_id: "308-paula", label: "308 Paula", status: "active" },
];

describe("updateWorkPackage date normalization (D6)", () => {
  it("persists the live-shaped PATCH: planned_finish:null and the new property", async () => {
    const getChain = chain({ data: DATELESS_PKG, error: null });
    const updateChain = chain({ data: { ...DATELESS_PKG, property_id: "308-paula", planned_finish: null }, error: null });
    const db = mockDb([getChain, chain({ data: PAULA_UNITS, error: null }), updateChain]);
    const result = await updateWorkPackage(db, { ownerId: "owner_1", actor: "user_9",
      packageId: "forge_wp_1", patch: { title: "Turnover", description: "",
        planned_finish: "", property_id: "308-paula" } });
    expect(result.ok).toBe(true);
    const payload = updateChain.update.mock.calls[0][0];
    expect(payload.planned_finish).toBeNull();
    expect(payload.property_id).toBe("308-paula");
    // No empty string reaches the DB adapter for a typed (date) column;
    // description stays "" verbatim — it is a text column, not a date.
    expect(payload.planned_start ?? null).not.toBe("");
    expect(payload).not.toHaveProperty("planned_start");
  });

  it("clears the property with an explicit null on a dateless package", async () => {
    const getChain = chain({ data: DATELESS_PKG, error: null });
    const updateChain = chain({ data: { ...DATELESS_PKG, property_id: null, planned_finish: null }, error: null });
    const db = mockDb([getChain, updateChain]);
    const result = await updateWorkPackage(db, { ownerId: "owner_1", actor: "user_9",
      packageId: "forge_wp_1", patch: { planned_finish: "", property_id: null } });
    expect(result.ok).toBe(true);
    expect(updateChain.update).toHaveBeenCalledWith(expect.objectContaining({
      planned_finish: null, property_id: null,
    }));
  });

  it("restores the original property after a clear, dates still null", async () => {
    const getChain = chain({ data: { ...DATELESS_PKG, property_id: null }, error: null });
    const updateChain = chain({ data: { ...DATELESS_PKG, property_id: "1214-wagner", planned_finish: null }, error: null });
    const db = mockDb([getChain, chain({ data: PAULA_UNITS, error: null }), updateChain]);
    const result = await updateWorkPackage(db, { ownerId: "owner_1", actor: "user_9",
      packageId: "forge_wp_1", patch: { planned_finish: "", property_id: "1214-wagner" } });
    expect(result.ok).toBe(true);
    expect(updateChain.update).toHaveBeenCalledWith(expect.objectContaining({
      planned_finish: null, property_id: "1214-wagner",
    }));
  });

  it("leaves a stored date unchanged when the field is omitted", async () => {
    const getChain = chain({ data: PKG, error: null });
    const updateChain = chain({ data: { ...PKG, title: "Renamed" }, error: null });
    const db = mockDb([getChain, updateChain]);
    const result = await updateWorkPackage(db, { ownerId: "owner_1", actor: "user_9",
      packageId: "forge_wp_1", patch: { title: "Renamed" } });
    expect(result.ok).toBe(true);
    expect(updateChain.update.mock.calls[0][0]).not.toHaveProperty("planned_finish");
  });

  it("explicit '' clears a stored date; planned_start '' normalizes too", async () => {
    const getChain = chain({ data: PKG, error: null });
    const updateChain = chain({ data: { ...PKG, planned_finish: null }, error: null });
    const db = mockDb([getChain, updateChain]);
    const result = await updateWorkPackage(db, { ownerId: "owner_1", actor: "user_9",
      packageId: "forge_wp_1", patch: { planned_start: "", planned_finish: "" } });
    expect(result.ok).toBe(true);
    expect(updateChain.update).toHaveBeenCalledWith(expect.objectContaining({
      planned_start: null, planned_finish: null,
    }));
  });

  it("keeps a valid date verbatim", async () => {
    const getChain = chain({ data: DATELESS_PKG, error: null });
    const updateChain = chain({ data: { ...DATELESS_PKG, planned_start: "2026-12-01", planned_finish: "2026-12-24" }, error: null });
    const db = mockDb([getChain, updateChain]);
    const result = await updateWorkPackage(db, { ownerId: "owner_1", actor: "user_9",
      packageId: "forge_wp_1", patch: { planned_start: "2026-12-01", planned_finish: "2026-12-24" } });
    expect(result.ok).toBe(true);
    expect(updateChain.update).toHaveBeenCalledWith(expect.objectContaining({
      planned_start: "2026-12-01", planned_finish: "2026-12-24",
    }));
  });

  it("rejects malformed nonempty dates with 400 and no write", async () => {
    for (const patch of [
      { planned_finish: "next Friday" },
      { planned_start: "2026-13-40" },
      { planned_finish: "2026-02-30" },
    ]) {
      const db = mockDb([chain({ data: DATELESS_PKG, error: null })]);
      const result = await updateWorkPackage(db, { ownerId: "owner_1", actor: "user_9",
        packageId: "forge_wp_1", patch });
      expect(result.ok).toBe(false);
      expect(result.httpStatus).toBe(400);
      expect(result.error).toMatch(/YYYY-MM-DD/);
      expect(db.from).toHaveBeenCalledTimes(1);
    }
  });

  it("still rejects planned_finish before planned_start (merged candidate)", async () => {
    const db = mockDb([chain({ data: PKG, error: null })]);
    const result = await updateWorkPackage(db, { ownerId: "owner_1", actor: "user_9",
      packageId: "forge_wp_1", patch: { planned_finish: "2026-10-31" } });
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(400);
    expect(result.error).toMatch(/on or after/);
    expect(db.from).toHaveBeenCalledTimes(1);
  });

  it("rejects blank numeric fields instead of writing '' to typed columns", async () => {
    const db = mockDb([chain({ data: DATELESS_PKG, error: null })]);
    const result = await updateWorkPackage(db, { ownerId: "owner_1", actor: "user_9",
      packageId: "forge_wp_1", patch: { planned_qty: "" } });
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(400);
    expect(result.error).toMatch(/planned_qty must be a number/);
    expect(db.from).toHaveBeenCalledTimes(1);
  });

  it("preserves the optimistic-concurrency 409 on the live-shaped patch", async () => {
    const db = mockDb([
      chain({ data: { ...DATELESS_PKG, updated_at: "2026-10-08T20:00:00.000Z" }, error: null }),
      chain({ data: PAULA_UNITS, error: null }),
      chain({ data: null, error: null }),
    ]);
    const result = await updateWorkPackage(db, { ownerId: "owner_1", actor: "user_9",
      packageId: "forge_wp_1", patch: { title: "Turnover", description: "",
        planned_finish: "", property_id: "308-paula" } });
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(409);
  });
});

describe("transitionWorkPackage", () => {
  it("applies effects and the audit row atomically via RPC", async () => {
    const getChain = chain({ data: { ...PKG, status: "ready" }, error: null });
    const rpcData = { ok: true, package: { ...PKG, status: "in_progress", actual_start: "2026-10-02" } };
    const db = mockDb([getChain], async () => ({ data: rpcData, error: null }));
    const result = await transitionWorkPackage(db, { ownerId: "owner_1", actor: "user_9",
      packageId: "forge_wp_1", to: "in_progress", ctx: { userConfirmedStart: true } });
    expect(result.ok).toBe(true);
    expect(db.rpc).toHaveBeenCalledWith("forge_work_transition_package", expect.objectContaining({
      p_expected_from: "ready", p_to: "in_progress",
      p_expected_version: 3,
      p_blocked_reason: null,
    }));
    // No caller-supplied effects bag: the RPC derives all lifecycle effects
    // from the edge. No p_actor either — identity comes from auth.uid().
    const rpcArgs = db.rpc.mock.calls[0][1];
    expect(rpcArgs).not.toHaveProperty("p_actor");
    expect(rpcArgs).not.toHaveProperty("p_updates");
    // One claim — no separate update + audit insert.
    expect(db.from).toHaveBeenCalledTimes(1);
  });
  it("rejects illegal transitions with 409", async () => {
    const db = mockDb([chain({ data: PKG, error: null })]);
    const result = await transitionWorkPackage(db, { ownerId: "owner_1", actor: "user_9",
      packageId: "forge_wp_1", to: "ready", ctx: {} });
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(409);
  });
  it("ignores fabricated client attestedGates — readiness needs stored attestations", async () => {
    const pkg = { ...PKG, status: "readiness_review", package_type: "other", description: "Scope text." };
    const db = mockDb([
      chain({ data: pkg, error: null }),
      chain({ data: [], error: null }),
    ]);
    const result = await transitionWorkPackage(db, { ownerId: "owner_1", actor: "owner_1",
      packageId: "forge_wp_1", to: "ready", ctx: { attestedGates: ["scope", "crew", "safety"] } });
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(409);
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it("reaches ready when every applicable gate has a stored attestation", async () => {
    const pkg = { ...PKG, status: "readiness_review", package_type: "other", description: "Scope text." };
    const attestations = [
      { gate: "scope", not_applicable: false, na_reason: null, at: "2026-10-02T10:00:00Z" },
      { gate: "crew", not_applicable: false, na_reason: null, at: "2026-10-02T10:00:00Z" },
      { gate: "safety", not_applicable: true, na_reason: "No energized work.", at: "2026-10-02T10:00:00Z" },
    ];
    const db = mockDb([
      chain({ data: pkg, error: null }),
      chain({ data: attestations, error: null }),
    ], async () => ({ data: { ok: true, package: { ...pkg, status: "ready" } }, error: null }));
    const result = await transitionWorkPackage(db, { ownerId: "owner_1", actor: "owner_1",
      packageId: "forge_wp_1", to: "ready", ctx: {} });
    expect(result.ok).toBe(true);
  });
  it("rejects forged reopen authority from an ordinary member", async () => {
    const pkg = { ...PKG, status: "verified_closed", designated_verifier: null };
    const db = mockDb([chain({ data: pkg, error: null })]);
    const result = await transitionWorkPackage(db, { ownerId: "owner_1", actor: "user_9",
      packageId: "forge_wp_1", to: "in_progress",
      ctx: { reopenAuthority: true, reopenReason: "restart" } });
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(409);
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it("allows reopen by the owner and by the designated verifier", async () => {
    for (const actor of ["owner_1", "user_9"]) {
      const pkg = { ...PKG, status: "verified_closed",
        designated_verifier: actor === "owner_1" ? null : "user_9" };
      const db = mockDb([chain({ data: pkg, error: null })],
        async () => ({ data: { ok: true, package: { ...pkg, status: "in_progress" } }, error: null }));
      const result = await transitionWorkPackage(db, { ownerId: "owner_1", actor,
        packageId: "forge_wp_1", to: "in_progress", ctx: { reopenReason: "restart" } });
      expect(result.ok).toBe(true);
    }
  });
  it("returns 409 when a concurrent transition wins the claim", async () => {
    const db = mockDb([chain({ data: { ...PKG, status: "ready" }, error: null })],
      async () => ({ data: { ok: false, error: "conflict" }, error: null }));
    const result = await transitionWorkPackage(db, { ownerId: "owner_1", actor: "user_9",
      packageId: "forge_wp_1", to: "in_progress", ctx: { userConfirmedStart: true } });
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(409);
  });
  it("propagates an RPC failure with no partial write", async () => {
    const db = mockDb([chain({ data: { ...PKG, status: "ready" }, error: null })],
      async () => { throw new Error("audit insert failed"); });
    await expect(transitionWorkPackage(db, { ownerId: "owner_1", actor: "user_9",
      packageId: "forge_wp_1", to: "in_progress", ctx: { userConfirmedStart: true } }))
      .rejects.toThrow("audit insert failed");
    expect(db.from).toHaveBeenCalledTimes(1);
  });
});

describe("completion assertion persistence (P1-1)", () => {
  it("persists the verifier's completion assertion in the audit row when required", async () => {
    const pkg = { ...PKG, status: "complete", package_type: "other", description: "Scope text." };
    let seenArgs = null;
    const db = mockDb([chain({ data: pkg, error: null })],
      async (fn, args) => {
        seenArgs = args;
        return { data: { ok: true, package: { ...pkg, status: "verified_closed" } }, error: null };
      });
    const result = await transitionWorkPackage(db, { ownerId: "owner_1", actor: "owner_1",
      packageId: "forge_wp_1", to: "verified_closed",
      ctx: { completionCriteriaMet: true, requiredEvidenceOk: true, evidenceRef: "EV-123" } });
    expect(result.ok).toBe(true);
    expect(seenArgs.p_completion_criteria_met).toBe(true);
    expect(seenArgs.p_required_evidence_ok).toBe(true);
    expect(seenArgs.p_evidence_ref).toBe("EV-123");
  });
  it("persists NULL assertion columns when the transition requires no completion check", async () => {
    let seenArgs = null;
    const db = mockDb([chain({ data: { ...PKG, status: "ready" }, error: null })],
      async (fn, args) => {
        seenArgs = args;
        return { data: { ok: true, package: { ...PKG, status: "in_progress" } }, error: null };
      });
    const result = await transitionWorkPackage(db, { ownerId: "owner_1", actor: "user_9",
      packageId: "forge_wp_1", to: "in_progress", ctx: { userConfirmedStart: true } });
    expect(result.ok).toBe(true);
    expect(seenArgs.p_completion_criteria_met).toBeNull();
    expect(seenArgs.p_required_evidence_ok).toBeNull();
  });
  it("blocks verification when the completion assertion is missing", async () => {
    const pkg = { ...PKG, status: "complete", package_type: "other", description: "Scope text." };
    const db = mockDb([chain({ data: pkg, error: null })]);
    const result = await transitionWorkPackage(db, { ownerId: "owner_1", actor: "owner_1",
      packageId: "forge_wp_1", to: "verified_closed", ctx: {} });
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(409);
    expect(db.rpc).not.toHaveBeenCalled();
  });
});

describe("getWorkPackageDetail", () => {
  it("loads the package with transitions, attestations, baselines, changes, observations", async () => {
    const db = mockDb([
      chain({ data: PKG, error: null }),
      chain({ data: [{ id: "t1" }], error: null }),
      chain({ data: [{ id: "a1" }], error: null }),
      chain({ data: [{ id: "b1", version: 1, supersedes_id: null }], error: null }),
      chain({ data: [], error: null }),
      chain({ data: [], error: null }),
    ]);
    const result = await getWorkPackageDetail(db, { ownerId: "owner_1", packageId: "forge_wp_1" });
    expect(result.ok).toBe(true);
    expect(result.currentBaseline.id).toBe("b1");
    expect(result.transitions).toHaveLength(1);
  });
});

describe("listWorkPackages", () => {
  it("lists with optional filters", async () => {
    const db = mockDb([chain({ data: [PKG], error: null })]);
    const result = await listWorkPackages(db, { ownerId: "owner_1", status: "draft" });
    expect(result.ok).toBe(true);
    expect(result.packages).toHaveLength(1);
  });
});

describe("recordGateAttestation", () => {
  it("records a human attestation with identity and statement", async () => {
    const getChain = chain({ data: PKG, error: null });
    const insertChain = chain({ data: { id: "forge_wga_1" }, error: null });
    const db = mockDb([getChain, insertChain]);
    const result = await recordGateAttestation(db, { ownerId: "owner_1", actor: "user_9",
      packageId: "forge_wp_1", gate: "crew", statement: "Crew confirmed for Monday." });
    expect(result.ok).toBe(true);
    expect(insertChain.insert).toHaveBeenCalledWith(expect.objectContaining({
      gate: "crew", attestor: "user_9", statement: "Crew confirmed for Monday.",
    }));
  });
  it("requires a statement, and a reason for N/A", async () => {
    const db = mockDb([chain({ data: PKG, error: null })]);
    const r1 = await recordGateAttestation(db, { ownerId: "owner_1", actor: "u",
      packageId: "p", gate: "permit", statement: " " });
    expect(r1.httpStatus).toBe(400);
    const db2 = mockDb([chain({ data: PKG, error: null })]);
    const r2 = await recordGateAttestation(db2, { ownerId: "owner_1", actor: "u",
      packageId: "p", gate: "permit", statement: "No permit needed.", notApplicable: true });
    expect(r2.httpStatus).toBe(400);
  });
  it("rejects non-canonical gate keys", async () => {
    const db = mockDb([chain({ data: PKG, error: null })]);
    const result = await recordGateAttestation(db, { ownerId: "owner_1", actor: "u",
      packageId: "p", gate: "scope_frozen", statement: "Scope frozen." });
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(400);
    expect(result.error).toMatch(/gate must be one of/);
  });
});

describe("freezeScopeBaseline", () => {
  it("freezes version 1 atomically via RPC", async () => {
    const membership = [{ key: "BUNDLE-01", description: "Pull bundle", quantity: 1, unit: "each" }];
    let seenArgs = null;
    const db = mockDb([chain({ data: PKG, error: null })],
      async (fn, args) => {
        seenArgs = args;
        return { data: { ok: true, baseline: { id: "forge_wsb_1", version: 1,
          membership_hash: args.p_membership_hash } }, error: null };
      });
    const result = await freezeScopeBaseline(db, { ownerId: "owner_1", actor: "user_9",
      packageId: "forge_wp_1", membership });
    expect(result.ok).toBe(true);
    expect(result.baseline.version).toBe(1);
    expect(result.baseline.membership_hash).toMatch(/^fnv1a:/);
    expect(seenArgs.p_membership).toEqual(membership);
    expect(db.from).toHaveBeenCalledTimes(1);
  });
  it("refuses a second freeze — updates go through the change workflow", async () => {
    const db = mockDb([chain({ data: { ...PKG, scope_baseline_id: "forge_wsb_1" }, error: null })]);
    const result = await freezeScopeBaseline(db, { ownerId: "owner_1", actor: "u",
      packageId: "p", membership: [{ key: "a" }] });
    expect(result.httpStatus).toBe(409);
  });
  it("maps a concurrent freeze to 409 with no partial baseline", async () => {
    const db = mockDb([chain({ data: PKG, error: null })],
      async () => ({ data: { ok: false, error: "already_frozen" }, error: null }));
    const result = await freezeScopeBaseline(db, { ownerId: "owner_1", actor: "user_9",
      packageId: "forge_wp_1", membership: [{ key: "a" }] });
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(409);
  });
});

describe("proposeScopeChange + decideScopeChange", () => {
  const CHANGE = { id: "forge_wsc_1", owner_id: "owner_1", package_id: "forge_wp_1",
    baseline_version: 1, change_type: "substitution", status: "proposed" };

  it("proposes a change against a frozen baseline", async () => {
    const db = mockDb([
      chain({ data: { ...PKG, scope_baseline_id: "forge_wsb_1" }, error: null }),
      chain({ data: { ...CHANGE }, error: null }),
    ]);
    const result = await proposeScopeChange(db, { ownerId: "owner_1", actor: "user_9",
      packageId: "forge_wp_1", baselineVersion: 1, changeType: "substitution",
      description: "Swap bundle supplier." });
    expect(result.ok).toBe(true);
    expect(result.change.status).toBe("proposed");
  });

  it("approves through the atomic decide RPC", async () => {
    const membership2 = [{ key: "BUNDLE-02", description: "Pull bundle", quantity: 1, unit: "each" }];
    let seenFn = null;
    const db = mockDb([], async (fn) => {
      seenFn = fn;
      return { data: { ok: true,
        change: { ...CHANGE, status: "approved", resulting_baseline_version: 2 },
        baseline: { id: "forge_wsb_2", version: 2 } }, error: null };
    });
    const result = await decideScopeChange(db, { ownerId: "owner_1", actor: "user_9",
      changeId: "forge_wsc_1", approve: true, newMembership: membership2 });
    expect(result.ok).toBe(true);
    expect(seenFn).toBe("forge_work_decide_scope_change");
    expect(result.baseline.version).toBe(2);
    expect(result.change.resulting_baseline_version).toBe(2);
    expect(db.from).not.toHaveBeenCalled();
  });

  it("maps baseline_moved to 409", async () => {
    const db = mockDb([], async () => ({ data: { ok: false, error: "baseline_moved" }, error: null }));
    const result = await decideScopeChange(db, { ownerId: "owner_1", actor: "user_9",
      changeId: "forge_wsc_1", approve: true, newMembership: [{ key: "x" }] });
    expect(result.httpStatus).toBe(409);
  });

  it("maps a racing decision to 409", async () => {
    const db = mockDb([], async () => ({ data: { ok: false, error: "already_decided" }, error: null }));
    const result = await decideScopeChange(db, { ownerId: "owner_1", actor: "user_9",
      changeId: "forge_wsc_1", approve: true, newMembership: [{ key: "x" }] });
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(409);
  });

  it("maps a pointer-claim conflict to 409 with no orphan baseline", async () => {
    // The SQL advances the package pointer BEFORE inserting the new baseline,
    // so a conflict return happens before any row is written: no partial
    // baseline can survive a lost race. The service only needs to map it.
    const db = mockDb([], async () => ({ data: { ok: false, error: "conflict" }, error: null }));
    const result = await decideScopeChange(db, { ownerId: "owner_1", actor: "user_9",
      changeId: "forge_wsc_1", approve: true, newMembership: [{ key: "x" }] });
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(409);
    expect(result.error).toMatch(/Concurrent approval/);
  });

  it("rejects a change through the atomic decide RPC", async () => {
    const db = mockDb([], async () => ({ data: { ok: true,
      change: { ...CHANGE, status: "rejected" } }, error: null }));
    const result = await decideScopeChange(db, { ownerId: "owner_1", actor: "user_9",
      changeId: "forge_wsc_1", approve: false });
    expect(result.ok).toBe(true);
    expect(result.change.status).toBe("rejected");
  });

  it("requires the new membership list on approval", async () => {
    const db = mockDb([]);
    const result = await decideScopeChange(db, { ownerId: "owner_1", actor: "user_9",
      changeId: "forge_wsc_1", approve: true, newMembership: [] });
    expect(result.httpStatus).toBe(400);
    expect(db.rpc).not.toHaveBeenCalled();
  });
});

describe("industrial authorities", () => {
  it("creates an asset with a tag", async () => {
    const insertChain = chain({ data: { id: "forge_wasset_1", asset_tag: "E-1801A" }, error: null });
    const db = mockDb([insertChain]);
    const result = await createAsset(db, { ownerId: "owner_1", actor: "user_9",
      input: { asset_tag: "E-1801A", asset_type: "exchanger", unit: "100" } });
    expect(result.ok).toBe(true);
    expect(insertChain.insert).toHaveBeenCalledWith(expect.objectContaining({
      asset_tag: "E-1801A", created_by: "user_9",
    }));
  });
  it("creates a component with a stable key", async () => {
    const insertChain = chain({ data: { id: "forge_wcomp_1" }, error: null });
    const db = mockDb([insertChain]);
    const result = await createAssetComponent(db, { ownerId: "owner_1", actor: "user_9",
      assetId: "forge_wasset_1",
      input: { component_key: "BUNDLE-01", weight_kg: 5200, length_m: 6.1 } });
    expect(result.ok).toBe(true);
  });
  it("creates a logistics location", async () => {
    const insertChain = chain({ data: { id: "forge_wloc_1" }, error: null });
    const db = mockDb([insertChain]);
    const result = await createLocation(db, { ownerId: "owner_1", actor: "user_9",
      input: { name: "North laydown", location_type: "laydown" } });
    expect(result.ok).toBe(true);
  });
  it("records an inspection observation", async () => {
    const insertChain = chain({ data: { id: "forge_wobs_1" }, error: null });
    const db = mockDb([insertChain]);
    const result = await recordInspectionObservation(db, { ownerId: "owner_1", actor: "user_9",
      input: { package_id: "forge_wp_1", component_id: "forge_wcomp_1",
        inspection_method: "eddy_current", status: "passed",
        quantity_examined: 200, quantity_required: 200 } });
    expect(result.ok).toBe(true);
    expect(insertChain.insert).toHaveBeenCalledWith(expect.objectContaining({
      inspection_method: "eddy_current", status: "passed",
    }));
  });
});

describe("planned package budget (Slice 3)", () => {
  it("creates packages with planned_cost_cents NULL and rejects an untracked create-time budget", async () => {
    const insertChain = chain({ data: { ...PKG, planned_cost_cents: null }, error: null });
    const db = mockDb([insertChain]);
    const result = await createWorkPackage(db, { ownerId: "owner_1", actor: "user_9",
      input: { title: "Turnover" } });
    expect(result.ok).toBe(true);
    expect(insertChain.insert).toHaveBeenCalledWith(expect.objectContaining({ planned_cost_cents: null }));

    const rejectedDb = mockDb([]);
    const rejected = await createWorkPackage(rejectedDb, { ownerId: "owner_1", actor: "user_9",
      input: { title: "Turnover", planned_budget: "1250.00" } });
    expect(rejected).toMatchObject({ ok: false, httpStatus: 400 });
    expect(rejectedDb.rpc).not.toHaveBeenCalled();
    expect(rejectedDb.from).not.toHaveBeenCalled();
  });

  it("sets $1,250.00 through the guarded atomic budget RPC", async () => {
    const pkg = { ...PKG, planned_cost_cents: null, version: 3 };
    const updated = { ...pkg, planned_cost_cents: 125000, version: 4 };
    const revision = { id: "rev_1", old_planned_cost_cents: null, new_planned_cost_cents: 125000 };
    const db = mockDb([chain({ data: pkg, error: null })], async () => ({
      data: { ok: true, package: updated, revision }, error: null,
    }));
    const result = await updateWorkPackage(db, { ownerId: "owner_1", actor: "user_9",
      packageId: "forge_wp_1", patch: {
        planned_budget: "1250.00", budget_reason: "Initial budget", expected_version: 3,
      } });
    expect(result.ok).toBe(true);
    expect(result.package.planned_cost_cents).toBe(125000);
    expect(result.budgetRevision).toEqual(revision);
    expect(db.rpc).toHaveBeenCalledWith("forge_work_update_package_budget", {
      p_owner_id: "owner_1",
      p_package_id: "forge_wp_1",
      p_expected_version: 3,
      p_new_planned_cost_cents: 125000,
      p_reason: "Initial budget",
    });
    expect(db.from).toHaveBeenCalledTimes(1);
  });

  it("returns 409 for a stale budget edit before calling the RPC", async () => {
    const db = mockDb([chain({ data: { ...PKG, version: 3 }, error: null })],
      async () => ({ data: { ok: true }, error: null }));
    const result = await updateWorkPackage(db, { ownerId: "owner_1", actor: "user_9",
      packageId: "forge_wp_1", patch: {
        planned_cost_cents: 125000, budget_reason: "Updated estimate", expected_version: 2,
      } });
    expect(result).toMatchObject({ ok: false, httpStatus: 409 });
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("rejects negative, overflow, and extra-decimal budget inputs with 400", async () => {
    for (const patch of [
      { planned_cost_cents: -1, budget_reason: "Bad", expected_version: 3 },
      { planned_cost_cents: Number.MAX_SAFE_INTEGER + 1, budget_reason: "Bad", expected_version: 3 },
      { planned_budget: "12.345", budget_reason: "Bad", expected_version: 3 },
      { planned_budget: "-12.00", budget_reason: "Bad", expected_version: 3 },
    ]) {
      const db = mockDb([chain({ data: PKG, error: null })], async () => ({ data: { ok: true }, error: null }));
      const result = await updateWorkPackage(db, { ownerId: "owner_1", actor: "user_9",
        packageId: "forge_wp_1", patch });
      expect(result).toMatchObject({ ok: false, httpStatus: 400 });
      expect(db.rpc).not.toHaveBeenCalled();
    }
  });

  it("requires a reason and retains the terminal-package rule for budget edits", async () => {
    const noReasonDb = mockDb([chain({ data: PKG, error: null })], async () => ({ data: { ok: true }, error: null }));
    const noReason = await updateWorkPackage(noReasonDb, { ownerId: "owner_1", actor: "user_9",
      packageId: "forge_wp_1", patch: { planned_cost_cents: 100, expected_version: 3 } });
    expect(noReason).toMatchObject({ ok: false, httpStatus: 400 });
    expect(noReasonDb.rpc).not.toHaveBeenCalled();

    const terminalDb = mockDb([chain({ data: { ...PKG, status: "verified_closed" }, error: null })],
      async () => ({ data: { ok: true }, error: null }));
    const terminal = await updateWorkPackage(terminalDb, { ownerId: "owner_1", actor: "user_9",
      packageId: "forge_wp_1", patch: {
        planned_cost_cents: 100, budget_reason: "Late change", expected_version: 3,
      } });
    expect(terminal).toMatchObject({ ok: false, httpStatus: 409 });
    expect(terminalDb.rpc).not.toHaveBeenCalled();
  });

  it("maps an RPC version conflict to 409", async () => {
    const db = mockDb([chain({ data: PKG, error: null })],
      async () => ({ data: { ok: false, error: "conflict" }, error: null }));
    const result = await updateWorkPackage(db, { ownerId: "owner_1", actor: "user_9",
      packageId: "forge_wp_1", patch: {
        planned_cost_cents: 100, budget_reason: "Updated estimate", expected_version: 3,
      } });
    expect(result).toMatchObject({ ok: false, httpStatus: 409 });
  });
});

// --- D7: package deletion (empty drafts, owner-only, tombstone) ------------
// The database RPC is the authority; these tests pin the service contract:
// input validation (no RPC on bad input), the fast owner check, and the
// RPC-outcome -> HTTP mapping incl. typed blockers. No direct .delete()
// chain is ever used on forge_work_packages.

function rpcReturning(data) {
  return async () => ({ data, error: null });
}

describe("getWorkPackageDeletionEligibility (D7)", () => {
  it("returns 404 when the package does not exist", async () => {
    const db = mockDb([chain({ data: null, error: null })]);
    const result = await getWorkPackageDeletionEligibility(db, {
      ownerId: "owner_1", actor: "owner_1", packageId: "forge_wp_nope",
    });
    expect(result).toEqual({ ok: false, httpStatus: 404, error: "Work package not found." });
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("marks an empty draft deletable for the primary owner", async () => {
    const db = mockDb([chain({ data: PKG, error: null })], rpcReturning([]));
    const result = await getWorkPackageDeletionEligibility(db, {
      ownerId: "owner_1", actor: "owner_1", packageId: "forge_wp_1",
    });
    expect(result.ok).toBe(true);
    expect(result.eligibility).toEqual({
      isOwner: true, canDelete: true, status: "draft", packageVersion: 3, blockers: [],
    });
    expect(db.rpc).toHaveBeenCalledWith("forge_work_package_deletion_blockers", {
      p_owner_id: "owner_1", p_package_id: "forge_wp_1",
    });
  });

  it("never marks a member (non-primary-owner) as able to delete", async () => {
    const db = mockDb([chain({ data: PKG, error: null })], rpcReturning([]));
    const result = await getWorkPackageDeletionEligibility(db, {
      ownerId: "owner_1", actor: "member_7", packageId: "forge_wp_1",
    });
    expect(result.eligibility.isOwner).toBe(false);
    expect(result.eligibility.canDelete).toBe(false);
  });

  it("annotates blockers and never allows a non-draft or dependent package", async () => {
    const db = mockDb(
      [chain({ data: { ...PKG, status: "planned" }, error: null })],
      rpcReturning([
        { type: "budget_revisions", count: 2 },
        { type: "links", count: 1 },
        { type: "transitions", count: 0 },
        { type: "future_class", count: 4 },
      ]),
    );
    const result = await getWorkPackageDeletionEligibility(db, {
      ownerId: "owner_1", actor: "owner_1", packageId: "forge_wp_1",
    });
    expect(result.eligibility.canDelete).toBe(false);
    expect(result.eligibility.status).toBe("planned");
    // Zero counts are dropped; known classes get label + next step; unknown
    // future classes still render a generic explanation.
    expect(result.eligibility.blockers).toEqual([
      { type: "budget_revisions", count: 2, label: "Budget history",
        action: "Budget revisions are a permanent audit record and can't be removed." },
      { type: "links", count: 1, label: "Linked records",
        action: "Unlink them in the Links section below, then try again." },
      { type: "future_class", count: 4, label: "future class",
        action: "These records are kept for audit and can't be removed." },
    ]);
  });

  it("attaches deletionEligibility to detail only when an actor is given", async () => {
    const detailChains = () => [
      chain({ data: PKG, error: null }),
      chain({ data: [], error: null }),
      chain({ data: [], error: null }),
      chain({ data: [], error: null }),
      chain({ data: [], error: null }),
      chain({ data: [], error: null }),
    ];
    const withActor = mockDb(detailChains(), rpcReturning([]));
    const detail = await getWorkPackageDetail(withActor, {
      ownerId: "owner_1", packageId: "forge_wp_1", actor: "owner_1",
    });
    expect(detail.ok).toBe(true);
    expect(detail.deletionEligibility.canDelete).toBe(true);

    const withoutActor = mockDb(detailChains(), rpcReturning([]));
    const plain = await getWorkPackageDetail(withoutActor, {
      ownerId: "owner_1", packageId: "forge_wp_1",
    });
    expect(plain.ok).toBe(true);
    expect(plain.deletionEligibility).toBeUndefined();
    expect(withoutActor.rpc).not.toHaveBeenCalled();
  });

  it("hides the affordance (null) instead of failing detail when eligibility errors", async () => {
    const db = mockDb([
      chain({ data: PKG, error: null }),
      chain({ data: [], error: null }),
      chain({ data: [], error: null }),
      chain({ data: [], error: null }),
      chain({ data: [], error: null }),
      chain({ data: [], error: null }),
    ], async () => ({ data: null, error: new Error("function does not exist") }));
    const detail = await getWorkPackageDetail(db, {
      ownerId: "owner_1", packageId: "forge_wp_1", actor: "owner_1",
    });
    expect(detail.ok).toBe(true);
    expect(detail.deletionEligibility).toBeNull();
  });
});

describe("deleteWorkPackage (D7)", () => {
  const args = {
    ownerId: "owner_1", actor: "owner_1", packageId: "forge_wp_1",
    confirmCode: "WP-0007", expectedVersion: 3,
  };

  it("rejects a missing/empty/non-string confirmation code without calling the RPC", async () => {
    for (const confirmCode of ["", null, undefined, 42]) {
      const db = mockDb([]);
      const result = await deleteWorkPackage(db, { ...args, confirmCode });
      expect(result.httpStatus).toBe(400);
      expect(db.rpc).not.toHaveBeenCalled();
    }
  });

  it("rejects a non-positive-integer expectedVersion without calling the RPC", async () => {
    for (const expectedVersion of [0, -1, 1.5, "3", null]) {
      const db = mockDb([]);
      const result = await deleteWorkPackage(db, { ...args, expectedVersion });
      expect(result.httpStatus).toBe(400);
      expect(db.rpc).not.toHaveBeenCalled();
    }
  });

  it("rejects non-owner actors with 403 before the RPC", async () => {
    const db = mockDb([]);
    const result = await deleteWorkPackage(db, { ...args, actor: "member_7" });
    expect(result).toEqual({
      ok: false, httpStatus: 403,
      error: "Only the workspace owner can delete a work package.",
    });
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("calls the guarded RPC and returns the server deletion record", async () => {
    const deletion = {
      package_id: "forge_wp_1", code: "WP-0007", title: "Turnover",
      prior_status: "draft", deleted_at: "2026-10-08T00:00:00Z",
    };
    const db = mockDb([], rpcReturning({ ok: true, deletion }));
    const result = await deleteWorkPackage(db, args);
    expect(result).toEqual({ ok: true, deletion });
    expect(db.rpc).toHaveBeenCalledWith("forge_work_delete_empty_draft_package", {
      p_owner_id: "owner_1", p_package_id: "forge_wp_1",
      p_expected_version: 3, p_confirm_code: "WP-0007",
    });
  });

  it("maps RPC outcomes to 403/404/409 (a second delete is 404, never false success)", async () => {
    const cases = [
      [{ ok: false, error: "forbidden" }, 403],
      [{ ok: false, error: "not_found" }, 404], // includes second DELETE
      [{ ok: false, error: "version_conflict" }, 409],
      [{ ok: false, error: "code_mismatch" }, 409],
    ];
    for (const [data, httpStatus] of cases) {
      const db = mockDb([], rpcReturning(data));
      const result = await deleteWorkPackage(db, args);
      expect(result.ok).toBe(false);
      expect(result.httpStatus).toBe(httpStatus);
    }
  });

  it("maps not_draft to 409 naming the current status", async () => {
    const db = mockDb([], rpcReturning({ ok: false, error: "not_draft", status: "in_progress" }));
    const result = await deleteWorkPackage(db, args);
    expect(result.httpStatus).toBe(409);
    expect(result.error).toBe("Only draft packages can be deleted. This package is in progress.");
  });

  it("maps blocked to 409 with annotated typed blockers", async () => {
    const db = mockDb([], rpcReturning({
      ok: false, error: "blocked",
      blockers: [{ type: "budget_revisions", count: 1 }],
    }));
    const result = await deleteWorkPackage(db, args);
    expect(result.httpStatus).toBe(409);
    expect(result.blockers).toEqual([
      { type: "budget_revisions", count: 1, label: "Budget history",
        action: "Budget revisions are a permanent audit record and can't be removed." },
    ]);
  });

  it("fails closed (throws) on database errors and unknown RPC outcomes", async () => {
    const dbError = mockDb([], async () => ({ data: null, error: new Error("rpc down") }));
    await expect(deleteWorkPackage(dbError, args)).rejects.toThrow(/rpc down/);
    const unknown = mockDb([], rpcReturning({ ok: false, error: "mystery" }));
    await expect(deleteWorkPackage(unknown, args)).rejects.toThrow(/mystery/);
  });
});
