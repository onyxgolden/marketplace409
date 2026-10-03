import { describe, expect, it, vi } from "vitest";
import {
  createWorkPackage, updateWorkPackage, transitionWorkPackage,
  getWorkPackageDetail, listWorkPackages, recordGateAttestation,
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
