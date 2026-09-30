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
