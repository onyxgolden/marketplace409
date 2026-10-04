import { describe, expect, it, vi } from "vitest";
import {
  runGateEvaluations, getPackageReadiness, createGateOverride,
} from "./workGates.js";

// Supabase-shaped chain mock.
function mockDb(chains = []) {
  const queue = [...chains];
  return {
    from: vi.fn(() => {
      if (queue.length === 0) throw new Error("mockDb: from() called more times than chains queued");
      return queue.shift();
    }),
  };
}

function chain(result = { data: null, error: null }) {
  const node = {
    select: vi.fn(() => node), eq: vi.fn(() => node), order: vi.fn(() => node),
    gt: vi.fn(() => node),
    insert: vi.fn(() => node),
    single: vi.fn(async () => result), maybeSingle: vi.fn(async () => result),
    then: (resolve) => resolve(result),
  };
  return node;
}

const NOW = "2026-10-03T12:00:00Z";
const CTX = { ownerId: "owner_1", packageId: "forge_wp_1", nowIso: NOW };
// First chain in every mock: the stored package lookup (package_type derived
// from the record, never from the caller).
const PKG = () => chain({ data: { package_type: "industrial" }, error: null });

describe("runGateEvaluations", () => {
  it("evaluates each applicable gate and appends one row per gate", async () => {
    const db = mockDb([
      PKG(),
      chain({ data: [{ gate: "scope" }, { gate: "crew" }], error: null }), // packageTypeGates
      chain({ data: [{ gate: "scope", statement: "Scope signed.", not_applicable: false, at: NOW }], error: null }), // attestations
      // Insert returns the DB-computed row (trigger is authoritative).
      chain({ data: { gate: "scope", verdict: "ready", reason: "Scope signed." }, error: null }),
      chain({ data: { gate: "crew", verdict: "unknown", reason: "No attestation recorded." }, error: null }),
    ]);
    const results = await runGateEvaluations(db, CTX);
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ gate: "scope", verdict: "ready" });
    expect(results[1]).toMatchObject({ gate: "crew", verdict: "unknown" });
  });

  it("throws when the package does not exist", async () => {
    const db = mockDb([chain({ data: null, error: null })]);
    await expect(runGateEvaluations(db, CTX)).rejects.toThrow(/not found/i);
  });
});

describe("getPackageReadiness", () => {
  it("combines evaluations and overrides into per-gate satisfaction", async () => {
    const db = mockDb([
      PKG(),
      chain({ data: [{ gate: "scope" }, { gate: "permit" }], error: null }), // gates
      chain({ data: [{ gate: "scope", verdict: "ready", reason: "ok", evaluated_at: NOW }], error: null }), // evals
      chain({ data: [{ gate: "permit", override_by: "jason", reason: "Expedited.", expires_at: "2026-10-10T00:00:00Z" }], error: null }), // overrides
    ]);
    const r = await getPackageReadiness(db, CTX);
    expect(r.ready).toBe(true);
    expect(r.gates.scope.satisfied).toBe(true);
    expect(r.gates.permit.via).toBe("override");
  });

  it("lists blocking gates", async () => {
    const db = mockDb([
      PKG(),
      chain({ data: [{ gate: "scope" }, { gate: "safety" }], error: null }),
      chain({ data: [{ gate: "scope", verdict: "ready", reason: "ok", evaluated_at: NOW }], error: null }),
      chain({ data: [], error: null }),
    ]);
    const r = await getPackageReadiness(db, CTX);
    expect(r.ready).toBe(false);
    expect(r.blocking).toEqual(["safety"]);
  });
});

describe("createGateOverride", () => {
  it("creates an override; actor is trigger-stamped, not caller-supplied", async () => {
    const created = { id: "forge_wgo_1", override_by: "real-user", reason: "Go." };
    const db = mockDb([chain({ data: created, error: null })]);
    const out = await createGateOverride(db, {
      ownerId: "owner_1", packageId: "forge_wp_1",
      gate: "safety", reason: "Go.", expiresAt: "2026-10-10T00:00:00Z", nowIso: NOW,
    });
    expect(out.override_by).toBe("real-user");
    const sent = db.from.mock.calls[0][0];
    expect(sent).toBe("forge_work_gate_overrides");
  });

  it("rejects a missing reason before touching the DB", async () => {
    const db = mockDb([]);
    await expect(createGateOverride(db, {
      ownerId: "owner_1", packageId: "forge_wp_1",
      gate: "safety", reason: "  ", expiresAt: "2026-10-10T00:00:00Z", nowIso: NOW,
    })).rejects.toThrow(/reason/i);
    expect(db.from).not.toHaveBeenCalled();
  });

  it("rejects an expiry in the past", async () => {
    const db = mockDb([]);
    await expect(createGateOverride(db, {
      ownerId: "owner_1", packageId: "forge_wp_1",
      gate: "safety", reason: "Go.", expiresAt: "2026-10-01T00:00:00Z", nowIso: NOW,
    })).rejects.toThrow(/future/i);
  });
});
