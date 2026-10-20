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

  it("admitGraph charges objects only; bytes ride the serialized representation", () => {
    // S653-005 (fix round 2): admitGraph is the structural gate (object
    // counts, accessor/prototype/proxy/depth checks). Byte accounting uses
    // the single nonduplicating serialized representation via
    // budget.chargeSerialized — ~300KiB of string payload trips
    // INPUT_LIMIT there, not in admitGraph.
    const b = makeBudget();
    admitGraph({ task_id: "t", blob: "x".repeat(300000) }, "t", b);
    assert.throws(() => b.chargeSerialized({ task_id: "t", blob: "x".repeat(300000) }, "t"), (e) => e.code === "INPUT_LIMIT");
  });

  it("serializedByteLength equals canonicalByteLength on plain data", async () => {
    const { serializedByteLength } = await import("../src/resolver.js");
    const { canonicalByteLength } = await import("../src/canonical.js");
    const samples = [
      { a: 1, b: "x", c: true, d: null, e: [1, "two", { three: 3 }] },
      { nul: "\0", quote: '"q"', backslash: "\\", unicode: "héllo→", emoji: "🎉" },
      { nested: { deep: { deeper: [{ x: [1, 2, { y: "z" }] }] } } },
      { "key with spaces": "value\nwith\nnewlines", "": "empty-key" },
      [1, 2, 3, "four", null, true, { five: 5 }],
    ];
    for (const s of samples) {
      assert.equal(serializedByteLength(s), canonicalByteLength(s), `mismatch for ${JSON.stringify(s).slice(0, 60)}`);
    }
  });

  it("serializedByteLength counts escapes (NUL/quote/backslash/Unicode)", async () => {
    const { serializedByteLength } = await import("../src/resolver.js");
    // One NUL char serializes as 6 bytes (\u0000); a quote as 2 (\").
    assert.equal(serializedByteLength("\0"), 8); // "\u0000" with quotes
    assert.equal(serializedByteLength('"'), 4); // "\"" with quotes
    assert.equal(serializedByteLength("\\"), 4);
    // 50,000 NULs -> 300,006 bytes: over the 256KiB cap during measurement.
    const { makeBudget } = await import("../src/resolver.js");
    const b = makeBudget();
    assert.throws(() => b.chargeSerialized({ registered_by: "\0".repeat(50000) }, "probe"), (e) => e.code === "INPUT_LIMIT");
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

describe("S653 fix round 2: inherited getters never execute (S653-006)", () => {
  it("assertPlainPrototype rejects inherited getters and inherited data", async () => {
    const schemas = await import("../src/schemas.js");
    assert.throws(() => schemas.assertPlainPrototype(Object.create({ x: 1 }), "t"), SchemaError);
    assert.throws(
      () => schemas.assertPlainPrototype(Object.create({ get x() { return 1; } }), "t"),
      SchemaError
    );
    // Plain objects (and null-prototype) pass.
    schemas.assertPlainPrototype({ x: 1 }, "t");
    schemas.assertPlainPrototype(Object.create(null), "t");
  });

  it("validateSourceEntry refuses an inherited revisions getter with zero invocations", async () => {
    const schemas = await import("../src/schemas.js");
    const { makeBudget } = await import("../src/resolver.js");
    const { loadStore } = await import("./helpers.js");
    const store = loadStore();
    const key = "sales-fixtures|leads/main.json";
    const origEntry = store.sources[key];
    let calls = 0;
    const evil = Object.create({
      get revisions() { calls++; return origEntry.revisions; },
    });
    assert.throws(
      () => schemas.validateSourceEntry(evil, key, "t", makeBudget()),
      SchemaError
    );
    assert.equal(calls, 0, "inherited revisions getter must never execute");
  });

  it("validateSourceEntry refuses inherited data-only revisions", async () => {
    const schemas = await import("../src/schemas.js");
    const { makeBudget } = await import("../src/resolver.js");
    const { loadStore } = await import("./helpers.js");
    const store = loadStore();
    const key = "sales-fixtures|leads/main.json";
    const origEntry = store.sources[key];
    const evil = Object.create({ revisions: origEntry.revisions });
    assert.throws(
      () => schemas.validateSourceEntry(evil, key, "t", makeBudget()),
      SchemaError
    );
  });

  it("run() refuses a sources container with an inherited slot getter, zero invocations", async () => {
    const { run } = await import("../src/index.js");
    const { loadStore, makeTask, makeContext } = await import("./helpers.js");
    const store = loadStore();
    const task = makeTask(store);
    const context = makeContext(store);
    const key = "sales-fixtures|leads/main.json";
    let calls = 0;
    const evilSources = Object.create({
      get [key]() { calls++; return context.sources[key]; },
    });
    Object.defineProperty(evilSources, "unrelated", {
      value: { revisions: {} }, enumerable: true, configurable: true, writable: true,
    });
    context.sources = evilSources;
    const r = run(task, context);
    assert.equal(r.status, "REFUSED");
    assert.equal(calls, 0, "inherited source-slot getter must never execute");
  });
});

describe("S653 fix round 3: proxy rejection before reflection, coverage charged first (S653-006)", () => {
  it("validateSourceEntry rejects a Proxy coverage container with ZERO trap invocations", async () => {
    // The reviewer's exact probe: a Proxy-wrapped rev.coverage must be
    // rejected by trap-free types.isProxy BEFORE any descriptor
    // reflection, and the coverage candidate must already be charged.
    const schemas = await import("../src/schemas.js");
    const { makeBudget } = await import("../src/resolver.js");
    const { loadStore } = await import("./helpers.js");
    const store = loadStore();
    const key = "sales-fixtures|leads/main.json";
    const entry = JSON.parse(JSON.stringify(store.sources[key]));
    const commit = Object.keys(entry.revisions)[0];
    let traps = 0;
    const proxyCoverage = new Proxy({ checked: true }, {
      get(t, k) { traps++; return t[k]; },
      getOwnPropertyDescriptor(t, k) { traps++; return Object.getOwnPropertyDescriptor(t, k); },
      getPrototypeOf(t) { traps++; return Object.getPrototypeOf(t); },
      ownKeys(t) { traps++; return Object.getOwnPropertyNames(t); },
      has(t, k) { traps++; return k in t; },
    });
    entry.revisions[commit].coverage = proxyCoverage;
    const budget = makeBudget();
    assert.throws(
      () => schemas.validateSourceEntry(entry, key, "t", budget),
      (e) => e.code === "INVALID_INPUT" || e.name === "SchemaError"
    );
    assert.equal(traps, 0, "no proxy trap may fire on the coverage container");
  });

  it("over-budget coverage candidates are never reflected on", async () => {
    // Candidate64/65 instrumentation: when the object budget is exhausted
    // by the coverage candidate itself, validateSourceEntry must throw
    // the budget error BEFORE any reflection on the coverage object.
    const schemas = await import("../src/schemas.js");
    const { makeBudget } = await import("../src/resolver.js");
    const { loadStore } = await import("./helpers.js");
    const store = loadStore();
    const key = "sales-fixtures|leads/main.json";
    const entry = JSON.parse(JSON.stringify(store.sources[key]));
    const budget = makeBudget();
    // Exhaust the object budget to 63 (one slot left).
    for (let i = 0; i < 63; i++) budget.countObject(`filler-${i}`);
    // The coverage charge is the 64th; the NEXT charge must throw.
    // Force the coverage to be the 65th by pre-charging one more.
    budget.countObject("filler-63");
    let reflected = false;
    const evilCoverage = {
      get checked() { reflected = true; return true; },
    };
    const commit = Object.keys(entry.revisions)[0];
    entry.revisions[commit].coverage = evilCoverage;
    assert.throws(
      () => schemas.validateSourceEntry(entry, key, "t", budget),
      (e) => e.code === "INPUT_LIMIT" || e.code === "BUDGET_EXCEEDED" || e.name === "BudgetError"
    );
    assert.equal(reflected, false, "over-budget coverage must never be reflected on");
  });

  it("validateSourceRef rejects a Proxy with zero traps", async () => {
    const schemas = await import("../src/schemas.js");
    const { makeBudget } = await import("../src/resolver.js");
    let traps = 0;
    const proxy = new Proxy({}, {
      get(t, k) { traps++; return t[k]; },
      getOwnPropertyDescriptor(t, k) { traps++; return Object.getOwnPropertyDescriptor(t, k); },
      getPrototypeOf(t) { traps++; return Object.getPrototypeOf(t); },
      ownKeys(t) { traps++; return Object.getOwnPropertyNames(t); },
    });
    assert.throws(() => schemas.validateSourceRef(proxy, "t", makeBudget()), SchemaError);
    assert.equal(traps, 0, "no proxy trap may fire on a SourceRef");
  });
});
