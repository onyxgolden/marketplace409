/**
 * schemas.test.js — validation: lead records, tasks, contexts, criteria.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SchemaError, validateLeadRecord, validateTask, validateContext,
  validateCriteria, validateSourceRef, admitGraph, assertNoAccessors,
  assertDenseArray, assertNotProxy, splitTopLevelArray,
  principalWindowLive, instantStartMs, instantEndMs,
} from "../src/schemas.js";
import { makeBudget } from "../src/resolver.js";
import { loadStore, makeTask, makeContext, CRITERIA } from "./helpers.js";

const store = loadStore();

function goodLead(overrides = {}) {
  return {
    lead_id: "t1", opportunity_id: "t1-opp", need_match: true, budget_match: true,
    timing_days: 30, do_not_contact: false, stage: "NEW", amount_minor: "1000",
    currency: "USD", probability_num: 1, probability_den: 2,
    created_at: "2026-09-01", stage_entered_at: "2026-09-15", closed_at: null,
    fixture_product_id: "crm-starter", display_name: "Test", notes: "",
    ...overrides,
  };
}

describe("validateLeadRecord", () => {
  it("accepts a valid record", () => {
    const r = validateLeadRecord(goodLead(), "t");
    assert.equal(r.lead_id, "t1");
  });
  it("rejects missing do_not_contact (never defaulted)", () => {
    const l = goodLead(); delete l.do_not_contact;
    assert.throws(() => validateLeadRecord(l, "t"), SchemaError);
  });
  it("rejects non-boolean do_not_contact", () => {
    assert.throws(() => validateLeadRecord(goodLead({ do_not_contact: "yes" }), "t"), SchemaError);
  });
  it("rejects bad stage", () => {
    assert.throws(() => validateLeadRecord(goodLead({ stage: "MAYBE" }), "t"), SchemaError);
  });
  it("rejects non-string amount_minor", () => {
    assert.throws(() => validateLeadRecord(goodLead({ amount_minor: 1000 }), "t"), SchemaError);
  });
  it("rejects float amount_minor", () => {
    assert.throws(() => validateLeadRecord(goodLead({ amount_minor: "10.5" }), "t"), SchemaError);
  });
  it("rejects bad currency", () => {
    assert.throws(() => validateLeadRecord(goodLead({ currency: "usd" }), "t"), SchemaError);
    assert.throws(() => validateLeadRecord(goodLead({ currency: "USDD" }), "t"), SchemaError);
  });
  it("rejects probability > 1", () => {
    assert.throws(() => validateLeadRecord(goodLead({ probability_num: 3, probability_den: 2 }), "t"), SchemaError);
  });
  it("rejects zero denominator", () => {
    assert.throws(() => validateLeadRecord(goodLead({ probability_den: 0 }), "t"), SchemaError);
  });
  it("rejects negative timing", () => {
    assert.throws(() => validateLeadRecord(goodLead({ timing_days: -1 }), "t"), SchemaError);
  });
  it("rejects unknown keys", () => {
    assert.throws(() => validateLeadRecord({ ...goodLead(), evil: 1 }, "t"), SchemaError);
  });
  it("rejects invalid calendar date", () => {
    assert.throws(() => validateLeadRecord(goodLead({ created_at: "2026-02-30" }), "t"), SchemaError);
  });
  it("accepts closed_at instant", () => {
    const r = validateLeadRecord(goodLead({ closed_at: "2026-10-05T00:00:00Z" }), "t");
    assert.equal(r.closed_at, "2026-10-05T00:00:00Z");
  });
});

describe("validateCriteria", () => {
  it("accepts the standard criteria", () => {
    const c = validateCriteria({ ...CRITERIA }, "t", makeBudget());
    assert.equal(c.fit_high_timing_days, 90);
  });
  it("rejects empty token allowlists", () => {
    assert.throws(() => validateCriteria({ ...CRITERIA, allowlisted_product_tokens: [] }, "t", makeBudget()), SchemaError);
  });
  it("rejects bad token format", () => {
    assert.throws(() => validateCriteria({ ...CRITERIA, allowlisted_product_tokens: ["Bad Token!"] }, "t", makeBudget()), SchemaError);
  });
});

describe("validateTask", () => {
  it("accepts a standard task", () => {
    const t = makeTask(store);
    const v = validateTask(t, makeBudget());
    assert.equal(v.task_id, "test-task-001");
  });
  it("rejects wrong operation", () => {
    const t = makeTask(store); t.operation = "send_email";
    assert.throws(() => validateTask(t, makeBudget()), SchemaError);
  });
  it("rejects unknown control fields", () => {
    const t = makeTask(store); t.execute_now = true;
    assert.throws(() => validateTask(t, makeBudget()), SchemaError);
  });
  it("rejects empty fixture_refs", () => {
    const t = makeTask(store); t.fixture_refs = [];
    assert.throws(() => validateTask(t, makeBudget()), SchemaError);
  });
  it("rejects malformed source ref", () => {
    const t = makeTask(store); t.fixture_refs[0].commit = "zzz";
    assert.throws(() => validateTask(t, makeBudget()), SchemaError);
  });
});

describe("validateContext", () => {
  it("accepts a standard context", () => {
    const c = makeContext(store);
    const v = validateContext(c, makeBudget());
    assert.equal(v.principal.role, "JASON");
  });
  it("rejects revoked principal", () => {
    const c = makeContext(store, { principal: { principal_id: "x", role: "JASON", registered_by: "h", valid_from: "2026-01-01", expires_at: "2027-01-01", revoked: true } });
    assert.throws(() => validateContext(c, makeBudget()), SchemaError);
  });
  it("rejects bad principal role", () => {
    const c = makeContext(store, { principal: { principal_id: "x", role: "ADMIN", registered_by: "h", valid_from: "2026-01-01", expires_at: "2027-01-01", revoked: false } });
    assert.throws(() => validateContext(c, makeBudget()), SchemaError);
  });
  it("rejects product entry with non-allowlisted token", () => {
    const pr = { "bad-prod": { product_id: "bad-prod", product_token: "evil-token", benefit_tokens: ["faster-followup"], verified: true } };
    const c = makeContext(store, { productRegistry: pr });
    assert.throws(() => validateContext(c, makeBudget()), SchemaError);
  });
});

describe("admitGraph", () => {
  it("charges candidate 65 before inspection", () => {
    const budget = makeBudget();
    const objs = [];
    for (let i = 0; i < 65; i++) objs.push({ i });
    assert.throws(() => admitGraph(objs, "t", budget), (e) => e.code === "BUDGET_EXCEEDED");
  });
  it("rejects accessor properties without invoking them", () => {
    let invoked = false;
    const o = {};
    Object.defineProperty(o, "x", { get() { invoked = true; return 1; }, enumerable: true });
    assert.throws(() => admitGraph(o, "t", makeBudget()), SchemaError);
    assert.equal(invoked, false);
  });
  it("rejects function values", () => {
    assert.throws(() => admitGraph({ f: () => 1 }, "t", makeBudget()), SchemaError);
  });
  it("rejects non-plain prototypes", () => {
    class Foo { constructor() { this.x = 1; } }
    assert.throws(() => admitGraph(new Foo(), "t", makeBudget()), SchemaError);
  });
  it("rejects depth > 32", () => {
    let o = { v: 1 };
    for (let i = 0; i < 35; i++) o = { next: o };
    assert.throws(() => admitGraph(o, "t", makeBudget()), SchemaError);
  });
  it("accepts null-prototype objects", () => {
    const o = Object.create(null); o.x = 1;
    admitGraph(o, "t", makeBudget());
  });
});

describe("assertDenseArray", () => {
  it("rejects sparse arrays", () => {
    const a = [1, 2, 3]; delete a[1];
    assert.throws(() => assertDenseArray(a, "t"), SchemaError);
  });
  it("accepts dense arrays", () => {
    assertDenseArray([1, 2, 3], "t");
  });
});

describe("splitTopLevelArray", () => {
  it("yields byte-exact spans without decoding fields", () => {
    const text = `[{"a":1},{"b":"x\\u00e9"}]`;
    const { spans, bytes } = splitTopLevelArray(text, "t");
    assert.equal(spans.length, 2);
    for (const s of spans) {
      const slice = bytes.subarray(s.start_byte, s.end_byte).toString("utf8");
      assert.deepEqual(JSON.parse(slice), JSON.parse(text)[spans.indexOf(s)]);
    }
  });
  it("rejects non-array top level", () => {
    assert.throws(() => splitTopLevelArray(`{"a":1}`, "t"), SchemaError);
  });
  it("rejects trailing bytes", () => {
    assert.throws(() => splitTopLevelArray(`[1] ` + `x`, "t"), SchemaError);
  });
  it("handles empty array", () => {
    const { spans } = splitTopLevelArray(`[]`, "t");
    assert.equal(spans.length, 0);
  });
  it("handles unicode byte boundaries", () => {
    const text = `[{"n":"caf\\u00e9 \\u4e2d"}]`;
    const { spans, bytes } = splitTopLevelArray(text, "t");
    const slice = bytes.subarray(spans[0].start_byte, spans[0].end_byte).toString("utf8");
    assert.ok(slice.includes("caf"));
  });
});

describe("S653 fix-round: admission hardening", () => {
  it("assertNotProxy refuses a Proxy via the trap-free native check", () => {
    let touched = false;
    const p = new Proxy({ a: 1 }, {
      get(t, k) { touched = true; return t[k]; },
      getOwnPropertyDescriptor(t, k) { touched = true; return Object.getOwnPropertyDescriptor(t, k); },
      getPrototypeOf(t) { touched = true; return Object.getPrototypeOf(t); },
      ownKeys(t) { touched = true; return Object.getOwnPropertyNames(t); },
    });
    assert.throws(() => assertNotProxy(p, "t"), SchemaError);
    assert.equal(touched, false, "native Proxy detection must not fire any trap");
  });

  it("admitGraph refuses a nested Proxy with zero trap invocations", () => {
    let touched = false;
    const nested = new Proxy({ x: 1 }, {
      get(t, k) { touched = true; return t[k]; },
      getOwnPropertyDescriptor(t, k) { touched = true; return Object.getOwnPropertyDescriptor(t, k); },
      getPrototypeOf(t) { touched = true; return Object.getPrototypeOf(t); },
      ownKeys(t) { touched = true; return Object.getOwnPropertyNames(t); },
    });
    assert.throws(() => admitGraph({ ok: 1, bad: nested }, "t", makeBudget()), SchemaError);
    assert.equal(touched, false, "nested proxy must be refused before reflection");
  });

  it("admitGraph charges string bytes against the aggregate input budget", () => {
    const b = makeBudget();
    // ~300KiB of string payload must trip INPUT_LIMIT during admission.
    assert.throws(
      () => admitGraph({ task_id: "t", blob: "x".repeat(300000) }, "t", b),
      (e) => e.code === "INPUT_LIMIT"
    );
  });

  it("validatePrincipal rejects an inverted validity window", () => {
    const c = makeContext(store);
    c.principal = { principal_id: "x", role: "JASON", registered_by: "h", valid_from: "2027-01-01", expires_at: "2026-01-01", revoked: false };
    assert.throws(() => validateContext(c, makeBudget()), SchemaError);
  });

  it("principalWindowLive enforces the window against the host clock", () => {
    const p = { valid_from: "2026-01-01", expires_at: "2026-12-31" };
    const clock = Date.parse("2026-10-19T12:00:00Z");
    assert.equal(principalWindowLive(p, clock), true);
    assert.equal(principalWindowLive(p, Date.parse("2027-01-01T00:00:00Z")), false);
    assert.equal(principalWindowLive(p, Date.parse("2025-12-31T23:59:59Z")), false);
    // Boundary-inclusive: exactly at the edges is live.
    assert.equal(principalWindowLive(p, Date.parse("2026-01-01T00:00:00Z")), true);
    assert.equal(principalWindowLive(p, Date.parse("2026-12-31T23:59:59Z")), true);
  });

  it("instantStartMs/instantEndMs use inclusive civil-date treatment", () => {
    assert.equal(instantStartMs("2026-10-01"), Date.parse("2026-10-01T00:00:00Z"));
    assert.equal(instantEndMs("2026-10-31"), Date.parse("2026-10-31T23:59:59Z"));
    assert.equal(instantStartMs("2026-10-01T12:00:00Z"), Date.parse("2026-10-01T12:00:00Z"));
  });

  it("validateTaskOptions rejects a reversed report interval", () => {
    const t = makeTask(store);
    t.options.report_interval_start = "2026-10-31";
    t.options.report_interval_end = "2026-10-01";
    assert.throws(() => validateTask(t, makeBudget()), SchemaError);
  });

  it("expected_lead_ids entries are consulted: 100 ids refuse BUDGET_EXCEEDED", () => {
    const t = makeTask(store);
    t.population = {
      declared_complete: true, dataset_id: "x", dataset_version: "v1",
      expected_lead_ids: Array.from({ length: 100 }, (_, i) => `id-${i}`),
      expected_count: 100,
    };
    assert.throws(() => validateTask(t, makeBudget()), (e) => e.code === "BUDGET_EXCEEDED");
  });

  it("expected_lead_ids over 4096 entries refuses at the reference-list bound", () => {
    const t = makeTask(store);
    // The brief requires the bounded length to be inspected FIRST, so an
    // over-cap list refuses INVALID_INPUT before per-entry charging.
    t.population = {
      declared_complete: true, dataset_id: "x", dataset_version: "v1",
      expected_lead_ids: Array.from({ length: 50000 }, (_, i) => `id-${i}`),
    };
    assert.throws(() => validateTask(t, makeBudget()), SchemaError);
  });
});
