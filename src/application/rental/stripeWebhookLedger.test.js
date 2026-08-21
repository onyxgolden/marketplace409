import { describe, expect, it } from "vitest";
import { isWebhookEventAlreadySettled, webhookLivemodeMatchesServerMode } from "./stripeWebhookLedger.js";

describe("isWebhookEventAlreadySettled", () => {
  it("treats 'processed' and 'ignored' as terminal — retries of these are safe no-ops", () => {
    expect(isWebhookEventAlreadySettled("processed")).toBe(true);
    expect(isWebhookEventAlreadySettled("ignored")).toBe(true);
  });
  it("treats 'received' and 'failed' as non-terminal — a retry must still be allowed to run", () => {
    expect(isWebhookEventAlreadySettled("received")).toBe(false);
    expect(isWebhookEventAlreadySettled("failed")).toBe(false);
  });
  it("treats a missing/unknown status as non-terminal (fails open toward re-attempting, not toward silently dropping)", () => {
    expect(isWebhookEventAlreadySettled(undefined)).toBe(false);
    expect(isWebhookEventAlreadySettled(null)).toBe(false);
  });
});

describe("webhookLivemodeMatchesServerMode", () => {
  it("matches a live event against a live server", () => {
    expect(webhookLivemodeMatchesServerMode(true, "live")).toBe(true);
  });
  it("matches a test event against a test server", () => {
    expect(webhookLivemodeMatchesServerMode(false, "test")).toBe(true);
  });
  it("rejects a live event delivered to a test-configured server", () => {
    expect(webhookLivemodeMatchesServerMode(true, "test")).toBe(false);
  });
  it("rejects a test event delivered to a live-configured server", () => {
    expect(webhookLivemodeMatchesServerMode(false, "live")).toBe(false);
  });
  it("fails closed (false) when livemode is missing/not a boolean, rather than guessing", () => {
    expect(webhookLivemodeMatchesServerMode(undefined, "live")).toBe(false);
    expect(webhookLivemodeMatchesServerMode(null, "test")).toBe(false);
  });
});
