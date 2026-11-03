import { describe, expect, it, afterEach } from "vitest";
import {
  DEFAULT_ARCHIVE_WINDOW_DAYS,
  DEFAULT_INFERRED_DECAY_DAYS,
  DEFAULT_WORKING_SET_SIZE,
  isBrainHarnessEnabled,
} from "../config.js";

afterEach(() => {
  delete process.env.BRAIN_CONVERSATION_HARNESS_ENABLED;
});

describe("brain harness flag (Q4: ships disabled)", () => {
  it("is disabled unless the env var is exactly 'true'", () => {
    expect(isBrainHarnessEnabled({})).toBe(false);
    expect(isBrainHarnessEnabled({ BRAIN_CONVERSATION_HARNESS_ENABLED: "1" })).toBe(false);
    expect(isBrainHarnessEnabled({ BRAIN_CONVERSATION_HARNESS_ENABLED: "true" })).toBe(true);
  });

  it("defaults to disabled in the real process env", () => {
    expect(isBrainHarnessEnabled()).toBe(false);
  });
});

describe("brain harness defaults", () => {
  it("uses the decided 7-day inferred-decay window", () => {
    expect(DEFAULT_INFERRED_DECAY_DAYS).toBe(7);
  });

  it("uses the proposed (unconfirmed) 90-day archive window", () => {
    expect(DEFAULT_ARCHIVE_WINDOW_DAYS).toBe(90);
  });

  it("bounds the per-turn working set", () => {
    expect(DEFAULT_WORKING_SET_SIZE).toBe(8);
  });
});
