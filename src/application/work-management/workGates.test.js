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
const CTX = { ownerId: "owner_1", packageId: "forge_wp_1", packageType: "industrial", nowIso: NOW };

describe("runGateEvaluations", () => {
  it("evaluates each applicable gate and appends one row per gate", async () => {
    const db = mockDb([
      chain({ data: [{ gate: "scope" }, { gate: "crew" }], error: null }), // packageTypeGates
      chain({ data: [{ gate: "scope", statement: "Scope signed.", not_applicable: false, at: NOW }], error: null }), // attestations
      chain({ data: null, error: null }), // insert scope eval
      chain({ data: null, error: null }), // insert crew eval
    ]);
    const results = await runGateEvaluations(db, { ...CTX, signals: {} });
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ gate: "scope", verdict: "ready" });
    expect(results[1]).toMatchObject({ gate: "crew", verdict: "unknown" });
  });

  it("records not_ready when a signal contradicts the attestation", async () => {
    const db = mockDb([
      chain({ data: [{ gate: "material" }], error: null }),
      chain({ data: [{ gate: "material", statement: "Ready.", not_applicable: false, at: NOW }], error: null }),
      chain({ data: null, error: null }),
    ]);
    const results = await runGateEvaluations(db, {
      ...CTX, signals: { material: { linkedMaterialReceived: false } },
    });
    expect(results[0].verdict).toBe("not_ready");
  });
});

describe("getPackageReadiness", () => {
  it("combines evaluations and overrides into per-gate satisfaction", async () => {
    const db = mockDb([
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
