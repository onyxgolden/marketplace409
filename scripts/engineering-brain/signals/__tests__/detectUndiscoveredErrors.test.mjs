import { describe, expect, it } from "vitest";

import { correlateSignal, detectUndiscoveredErrors } from "../detectUndiscoveredErrors.mjs";

const RECEIPT_ROUTE = {
  source_path: "src/app/api/receipts/queue/route.js",
  source_type: "api_route_file",
  symbol_or_section: null,
  commit_sha: "s",
  content_hash: "h",
  authority_level: "current",
  content_tokens: ["receipt", "delivery", "queue", "email", "payment", "borrower"],
};

const UNRELATED = {
  source_path: "src/app/market/page.js",
  source_type: "application_source_file",
  symbol_or_section: null,
  commit_sha: "s",
  content_hash: "h2",
  authority_level: "current",
  content_tokens: ["market", "listing", "cards"],
};

const RECORDS = [RECEIPT_ROUTE, UNRELATED];

function failedDelivery(id, reason = "Resend API 500") {
  return {
    signal_id: `supabase:receipts:failed:${id}`,
    source: "supabase",
    kind: "delivery_failed",
    severity: "error",
    title: "Payment receipt delivery failed (borrower)",
    detected_at: "2026-09-29T18:00:00.000Z",
    correlation_query: "payment receipt delivery failed",
    evidence: { failure_reason: reason, attempt_count: 3 },
  };
}

describe("correlateSignal", () => {
  it("points a delivery failure at the receipt queue code via content tokens", () => {
    const implicated = correlateSignal(failedDelivery("a"), RECORDS);
    expect(implicated.length).toBeGreaterThan(0);
    expect(implicated[0].source_path).toBe("src/app/api/receipts/queue/route.js");
  });

  it("returns [] for an empty query or empty manifest", () => {
    expect(correlateSignal({ correlation_query: "", title: "" }, RECORDS)).toEqual([]);
    expect(correlateSignal(failedDelivery("a"), [])).toEqual([]);
  });
});

describe("detectUndiscoveredErrors", () => {
  it("groups repeat failures from the same code into one error with a count", () => {
    const report = detectUndiscoveredErrors({
      signals: [failedDelivery("a"), failedDelivery("b"), failedDelivery("c", "timeout")],
      manifestRecords: RECORDS,
    });
    expect(report.error_count).toBe(1);
    const [error] = report.errors;
    expect(error.signal_count).toBe(3);
    expect(error.severity).toBe("error");
    expect(error.implicated_code[0].source_path).toBe("src/app/api/receipts/queue/route.js");
    expect(error.failure_reasons).toEqual(["Resend API 500", "timeout"]);
    expect(error.diagnose_query).toBe("payment receipt delivery failed");
  });

  it("ranks errors before warnings, then by count, then by recency", () => {
    const warning = {
      signal_id: "supabase:x:stuck:1",
      source: "supabase",
      kind: "delivery_stuck",
      severity: "warning",
      title: "Delivery stuck in sending",
      detected_at: "2026-09-29T19:00:00.000Z",
      correlation_query: "market listing",
      evidence: {},
    };
    const report = detectUndiscoveredErrors({
      signals: [warning, failedDelivery("a")],
      manifestRecords: RECORDS,
    });
    expect(report.errors[0].severity).toBe("error");
    expect(report.errors[1].severity).toBe("warning");
  });

  it("keeps the most severe rating when a group mixes severities", () => {
    const signals = [
      { ...failedDelivery("a"), severity: "warning" },
      failedDelivery("b"),
    ];
    const report = detectUndiscoveredErrors({ signals, manifestRecords: RECORDS });
    expect(report.errors[0].severity).toBe("error");
  });

  it("returns an empty report for no signals", () => {
    const report = detectUndiscoveredErrors({ signals: [], manifestRecords: RECORDS });
    expect(report.error_count).toBe(0);
    expect(report.errors).toEqual([]);
  });

  it("is deterministic across runs", () => {
    const input = { signals: [failedDelivery("a"), failedDelivery("b")], manifestRecords: RECORDS };
    const a = detectUndiscoveredErrors(input);
    const b = detectUndiscoveredErrors(input);
    expect(JSON.stringify({ ...a, generated_at: null })).toBe(JSON.stringify({ ...b, generated_at: null }));
  });
});

function smokeSignal(runId) {
  return {
    signal_id: `github:actions:ci_failed:${runId}`,
    source: "github",
    kind: "ci_failed",
    severity: "error",
    title: "CI failed on main: E2E Smoke",
    group_title: "CI failed on main: E2E Smoke",
    detected_at: "2026-11-23T21:50:00.000Z",
    correlation_query: "E2E Smoke failed",
    evidence: {
      workflow_name: "E2E Smoke",
      run_url: `https://github.com/onyxgolden/marketplace409/actions/runs/${runId}`,
      head_sha: "05138d86",
      conclusion: "failure",
    },
  };
}

describe("known-red allowlist (E2E Smoke, pre-provisioning)", () => {
  it("excludes E2E Smoke signals from error_count but still reports them", () => {
    const report = detectUndiscoveredErrors({
      signals: [smokeSignal(1), smokeSignal(2)],
      manifestRecords: RECORDS,
    });
    expect(report.error_count).toBe(0);
    expect(report.errors).toEqual([]);
    expect(report.allowlisted_count).toBe(1);
    expect(report.allowlisted).toHaveLength(1);
    const [group] = report.allowlisted;
    expect(group.signal_count).toBe(2);
    expect(group.title).toBe("CI failed on main: E2E Smoke");
    expect(group.allowlist_reasons).toHaveLength(1);
    expect(group.allowlist_reasons[0]).toMatch(/pre-provisioning/i);
  });

  it("still counts a new undiscovered error alongside the allowlisted smoke failure", () => {
    const report = detectUndiscoveredErrors({
      signals: [smokeSignal(1), failedDelivery("a")],
      manifestRecords: RECORDS,
    });
    expect(report.error_count).toBe(1);
    expect(report.allowlisted_count).toBe(1);
    expect(report.signal_count).toBe(2);
  });

  it("does not allowlist a ci_failed signal from another workflow", () => {
    const other = { ...smokeSignal(1), title: "CI failed on main: Nightly Sync", group_title: "CI failed on main: Nightly Sync", evidence: { workflow_name: "Nightly Sync" } };
    const report = detectUndiscoveredErrors({ signals: [other], manifestRecords: RECORDS });
    expect(report.error_count).toBe(1);
    expect(report.allowlisted_count).toBe(0);
    expect(report.allowlisted).toEqual([]);
  });

  it("does not allowlist a ci_failed signal with no workflow evidence (fail-closed)", () => {
    const bare = { ...smokeSignal(1), evidence: {} };
    const report = detectUndiscoveredErrors({ signals: [bare], manifestRecords: RECORDS });
    expect(report.error_count).toBe(1);
    expect(report.allowlisted_count).toBe(0);
  });
});
