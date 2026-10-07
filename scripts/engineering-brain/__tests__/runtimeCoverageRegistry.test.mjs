// Runtime Coverage Registry tests (Slice 1).
import { describe, expect, it } from "vitest";

import {
  CAPABILITIES,
  MONITORING_STATUSES,
  RUNTIME_COVERAGE_SCHEMA_VERSION,
  getCapability,
  getRegistry,
} from "../runtimeCoverageRegistry.mjs";
import { validateRegistry, validateShippedRegistry } from "../validateRuntimeCoverageRegistry.mjs";

function clone(entry) {
  return JSON.parse(JSON.stringify(entry));
}

describe("shipped registry", () => {
  it("validates clean against the fail-closed contract", () => {
    const { ok, errors } = validateShippedRegistry();
    expect(errors).toEqual([]);
    expect(ok).toBe(true);
  });

  it("is sorted by id and exposes every entry through the accessors", () => {
    const ids = CAPABILITIES.map((c) => c.id);
    expect(ids).toEqual([...ids].sort());
    expect(getRegistry()).toHaveLength(ids.length);
    for (const c of CAPABILITIES) {
      expect(getCapability(c.id)).toBe(c);
    }
    expect(getCapability("no-such-capability")).toBeUndefined();
  });

  it("covers the known money-moving production paths", () => {
    const money = CAPABILITIES.filter((c) => c.moves_money).map((c) => c.id).sort();
    expect(money).toEqual([
      "pf-autopay-sweep",
      "rental-autopay-sweep",
      "rental-autopay-sweep-watchdog",
      "rental-generate-charges",
      "rental-late-fee-posting",
    ]);
  });

  it("never claims certainty it does not have", () => {
    for (const c of CAPABILITIES) {
      expect(MONITORING_STATUSES).toContain(c.monitoring_status);
      // "covered" requires an independent check; Slice 1 performs none.
      expect(c.monitoring_status).not.toBe("covered");
    }
  });

  it("pins the schema version the validator enforces", () => {
    expect(RUNTIME_COVERAGE_SCHEMA_VERSION).toBe(1);
  });
});

describe("validateRegistry fail-closed rules", () => {
  it("rejects an unknown monitoring status", () => {
    const bad = clone(CAPABILITIES[0]);
    bad.monitoring_status = "mostly-covered";
    const { ok, errors } = validateRegistry([bad]);
    expect(ok).toBe(false);
    expect(errors.some((e) => e.includes("monitoring_status"))).toBe(true);
  });

  it("rejects a missing required field", () => {
    const bad = clone(CAPABILITIES[0]);
    delete bad.expected_cadence;
    const { ok, errors } = validateRegistry([bad]);
    expect(ok).toBe(false);
    expect(errors.some((e) => e.includes("expected_cadence"))).toBe(true);
  });

  it("rejects an unknown field", () => {
    const bad = clone(CAPABILITIES[0]);
    bad.some_future_field = "x";
    const { ok, errors } = validateRegistry([bad]);
    expect(ok).toBe(false);
    expect(errors.some((e) => e.includes("unknown field"))).toBe(true);
  });

  it("rejects duplicate ids", () => {
    const dup = clone(CAPABILITIES[0]);
    const { ok, errors } = validateRegistry([CAPABILITIES[0], dup]);
    expect(ok).toBe(false);
    expect(errors.some((e) => e.includes("duplicate id"))).toBe(true);
  });

  it("rejects a malformed cron expression", () => {
    const bad = clone(CAPABILITIES.find((c) => c.trigger.kind === "schedule"));
    bad.id = "x-bad-cron";
    bad.name = "X bad cron";
    bad.trigger = { kind: "schedule", cron: "every day at 3am", chicago_label: "3am" };
    const { ok, errors } = validateRegistry([bad]);
    expect(ok).toBe(false);
    expect(errors.some((e) => e.includes("cron"))).toBe(true);
  });

  it("rejects a money-moving capability with no durable evidence", () => {
    const bad = clone(CAPABILITIES.find((c) => c.moves_money));
    bad.durable_evidence = [];
    const { ok, errors } = validateRegistry([bad]);
    expect(ok).toBe(false);
    expect(errors.some((e) => e.includes("durable_evidence"))).toBe(true);
  });

  it("rejects unsorted entries", () => {
    const reversed = [...CAPABILITIES].reverse();
    const { ok, errors } = validateRegistry(reversed);
    expect(ok).toBe(false);
    expect(errors.some((e) => e.includes("sorted by id"))).toBe(true);
  });

  it("rejects a non-boolean moves_money", () => {
    const bad = clone(CAPABILITIES[0]);
    bad.moves_money = "yes";
    const { ok } = validateRegistry([bad]);
    expect(ok).toBe(false);
  });

  it("rejects an empty registry", () => {
    const { ok } = validateRegistry([]);
    expect(ok).toBe(false);
  });

  it("is deterministic: same input, same errors in the same order", () => {
    const bad = clone(CAPABILITIES[0]);
    bad.monitoring_status = "bogus";
    delete bad.name;
    const a = validateRegistry([bad]);
    const b = validateRegistry([bad]);
    expect(a).toEqual(b);
  });
});
