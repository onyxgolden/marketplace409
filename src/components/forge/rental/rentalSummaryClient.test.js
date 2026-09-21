import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getRentalSummaryPayload, resetRentalSummaryClient } from "./rentalSummaryClient";

const RENTAL_URL = "/api/rental";
const REPORTS_URL = "/api/rental/reports";
const NO_DELAY = [0, 0];

function okJson(body) {
  return { ok: true, json: async () => body };
}

function rentalBody(overrides = {}) {
  return { actingUserId: "user_1", canonicalOwnerId: "owner_1", units: [], ...overrides };
}

function stubFetch(handler) {
  const fetch = vi.fn(async (url) => handler(url));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

beforeEach(() => {
  resetRentalSummaryClient();
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetRentalSummaryClient();
});

describe("getRentalSummaryPayload", () => {
  it("fetches /api/rental then /api/rental/reports and returns both payloads", async () => {
    const rental = rentalBody();
    const report = { report: { summary: {} } };
    stubFetch((url) => (url === RENTAL_URL ? okJson(rental) : okJson(report)));
    const payload = await getRentalSummaryPayload({ retryDelaysMs: NO_DELAY });
    expect(payload.rentalBody).toBe(rental);
    expect(payload.reports).toEqual({ available: true, report: report.report, error: "" });
  });

  it("dedups concurrent callers into one network pair", async () => {
    const fetch = stubFetch((url) => (url === RENTAL_URL ? okJson(rentalBody()) : okJson({ report: null })));
    const [first, second] = await Promise.all([
      getRentalSummaryPayload({ retryDelaysMs: NO_DELAY }),
      getRentalSummaryPayload({ retryDelaysMs: NO_DELAY }),
    ]);
    expect(first).toBe(second);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.map(([url]) => url).sort()).toEqual([RENTAL_URL, REPORTS_URL]);
  });

  it("fetches fresh again once the previous pair has settled", async () => {
    const fetch = stubFetch((url) => (url === RENTAL_URL ? okJson(rentalBody()) : okJson({ report: null })));
    await getRentalSummaryPayload({ retryDelaysMs: NO_DELAY });
    await getRentalSummaryPayload({ retryDelaysMs: NO_DELAY });
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("retries a transient network failure and then succeeds", async () => {
    let rentalCalls = 0;
    const fetch = stubFetch((url) => {
      if (url === RENTAL_URL) {
        rentalCalls += 1;
        if (rentalCalls < 3) return Promise.reject(new TypeError("Failed to fetch"));
        return okJson(rentalBody());
      }
      return okJson({ report: null });
    });
    const payload = await getRentalSummaryPayload({ retryDelaysMs: NO_DELAY });
    expect(payload.rentalBody.actingUserId).toBe("user_1");
    expect(fetch.mock.calls.filter(([url]) => url === RENTAL_URL)).toHaveLength(3);
  });

  it("gives up after three total attempts and surfaces the network error", async () => {
    const fetch = stubFetch(() => Promise.reject(new TypeError("Failed to fetch")));
    await expect(getRentalSummaryPayload({ retryDelaysMs: NO_DELAY })).rejects.toThrow("Failed to fetch");
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("does not retry an HTTP !ok on /api/rental and throws the server's error", async () => {
    const fetch = stubFetch((url) =>
      url === RENTAL_URL ? { ok: false, json: async () => ({ error: "Workspace not found." }) } : okJson({ report: null }),
    );
    await expect(getRentalSummaryPayload({ retryDelaysMs: NO_DELAY })).rejects.toThrow("Workspace not found.");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("falls back to a default message when /api/rental !ok carries no error", async () => {
    stubFetch((url) => (url === RENTAL_URL ? { ok: false, json: async () => ({}) } : okJson({ report: null })));
    await expect(getRentalSummaryPayload({ retryDelaysMs: NO_DELAY })).rejects.toThrow(
      "Rental summary could not be loaded.",
    );
  });

  it("handles a non-JSON !ok body without retrying", async () => {
    const fetch = stubFetch((url) =>
      url === RENTAL_URL
        ? { ok: false, json: async () => { throw new SyntaxError("Unexpected token"); } }
        : okJson({ report: null }),
    );
    await expect(getRentalSummaryPayload({ retryDelaysMs: NO_DELAY })).rejects.toThrow(
      "Rental summary could not be loaded.",
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("never throws for reports: an HTTP !ok becomes a soft unavailable result", async () => {
    const fetch = stubFetch((url) =>
      url === RENTAL_URL
        ? okJson(rentalBody())
        : { ok: false, json: async () => ({ error: "Reports service unavailable." }) },
    );
    const payload = await getRentalSummaryPayload({ retryDelaysMs: NO_DELAY });
    expect(payload.reports).toEqual({ available: false, report: null, error: "Reports service unavailable." });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("retries a transient reports network failure, then reports available", async () => {
    let reportsCalls = 0;
    stubFetch((url) => {
      if (url === REPORTS_URL) {
        reportsCalls += 1;
        if (reportsCalls === 1) return Promise.reject(new TypeError("Failed to fetch"));
        return okJson({ report: { summary: {} } });
      }
      return okJson(rentalBody());
    });
    const payload = await getRentalSummaryPayload({ retryDelaysMs: NO_DELAY });
    expect(payload.reports.available).toBe(true);
    expect(reportsCalls).toBe(2);
  });

  it("refresh:true bypasses an in-flight pair and forces a fresh fetch", async () => {
    let releaseRental;
    const gate = new Promise((resolve) => { releaseRental = resolve; });
    const fetch = stubFetch((url) => {
      if (url === RENTAL_URL) return gate.then(() => okJson(rentalBody()));
      return okJson({ report: null });
    });
    const first = getRentalSummaryPayload({ retryDelaysMs: NO_DELAY });
    const second = getRentalSummaryPayload({ refresh: true, retryDelaysMs: NO_DELAY });
    releaseRental();
    await Promise.all([first, second]);
    expect(fetch.mock.calls.filter(([url]) => url === RENTAL_URL)).toHaveLength(2);
  });
});
