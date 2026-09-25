// Tests for forge-capture-app/ui/ai-edit.js — the AI Edit session state
// machine. Pure logic; the Tauri invoke bridge is faked.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  AiEditSession,
  validateAiPrompt,
  AI_EDIT_PROMPT_MAX,
  AI_EDIT_RUNNER_HINT_MS,
} from "../ai-edit.js";

function makeSession(invokeImpl) {
  const events = [];
  const invoke = invokeImpl || vi.fn();
  const session = new AiEditSession({
    invoke,
    captureId: "cap-1",
    onEvent: (e) => events.push(e),
  });
  return { session, events, invoke };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("validateAiPrompt", () => {
  it("rejects blank prompts", () => {
    expect(validateAiPrompt("").ok).toBe(false);
    expect(validateAiPrompt("   ").ok).toBe(false);
    expect(validateAiPrompt(null).ok).toBe(false);
  });

  it("rejects over-long prompts at the core limit", () => {
    expect(validateAiPrompt("x".repeat(AI_EDIT_PROMPT_MAX + 1)).ok).toBe(false);
    expect(validateAiPrompt("x".repeat(AI_EDIT_PROMPT_MAX)).ok).toBe(true);
  });

  it("trims the prompt it accepts", () => {
    expect(validateAiPrompt("  crop it  ")).toEqual({ ok: true, prompt: "crop it" });
  });
});

describe("AiEditSession submit", () => {
  it("submits id+prompt and lands in queued", async () => {
    const { session, invoke, events } = makeSession(vi.fn().mockResolvedValue({ jobId: "ai-1" }));
    const jobId = await session.submit("remove the cursor");
    expect(jobId).toBe("ai-1");
    expect(invoke).toHaveBeenCalledWith("ai_edit_submit", {
      id: "cap-1",
      prompt: "remove the cursor",
    });
    expect(session.state).toBe("queued");
    expect(events.map((e) => e.state)).toEqual(["submitting", "queued"]);
    session.stopPolling();
  });

  it("refuses a blank prompt without touching the backend", async () => {
    const { session, invoke } = makeSession(vi.fn());
    await expect(session.submit("  ")).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
    expect(session.state).toBe("idle");
  });

  it("refuses a second submit while active", async () => {
    const { session } = makeSession(vi.fn().mockResolvedValue({ jobId: "ai-1" }));
    await session.submit("crop it");
    await expect(session.submit("again")).rejects.toThrow(/cannot submit/);
    session.stopPolling();
  });

  it("requires invoke and captureId", () => {
    expect(() => new AiEditSession({ captureId: "c" })).toThrow();
    expect(() => new AiEditSession({ invoke: async () => ({}) })).toThrow();
  });
});

describe("AiEditSession polling", () => {
  async function queuedSession(pollImpl) {
    const invoke = vi.fn().mockResolvedValue({ jobId: "ai-9" });
    const { session, events } = makeSession(invoke);
    await session.submit("make it pop");
    invoke.mockImplementation(pollImpl);
    return { session, events, invoke };
  }

  it("follows queued -> processing -> done", async () => {
    const { session } = await queuedSession(async (cmd) => {
      expect(cmd).toBe("ai_edit_poll");
      return { jobId: "ai-9", status: "processing" };
    });
    expect(await session.pollOnce()).toBe("processing");
    session.invoke.mockResolvedValue({ jobId: "ai-9", status: "done" });
    expect(await session.pollOnce()).toBe("done");
    expect(session.statusText()).toMatch(/import/i);
    session.stopPolling();
  });

  it("captures the failure reason and stops polling", async () => {
    const { session, events } = await queuedSession(async () => ({
      jobId: "ai-9",
      status: "failed",
      reason: "runner ran out of tokens",
    }));
    expect(await session.pollOnce()).toBe("failed");
    expect(session.reason).toBe("runner ran out of tokens");
    expect(session.statusText()).toMatch(/runner ran out of tokens/);
    expect(session.timer).toBeNull();
    expect(events.at(-1).state).toBe("failed");
  });

  it("fails honestly when the backend errors, instead of polling forever", async () => {
    const { session } = await queuedSession(async () => {
      throw new Error("unknown AI edit job: ai-9");
    });
    expect(await session.pollOnce()).toBe("failed");
    expect(session.reason).toMatch(/unknown AI edit job/);
    expect(session.timer).toBeNull();
  });

  it("ignores unknown status strings rather than inventing a state", async () => {
    const { session } = await queuedSession(async () => ({
      jobId: "ai-9",
      status: "teleported",
    }));
    expect(await session.pollOnce()).toBe("queued");
    session.stopPolling();
  });

  it("raises the no-runner hint after the threshold", async () => {
    const { session } = await queuedSession(async () => ({ jobId: "ai-9", status: "queued" }));
    await session.pollOnce(Date.now());
    expect(session.runnerHint).toBe(false);
    await session.pollOnce(Date.now() + AI_EDIT_RUNNER_HINT_MS + 1);
    expect(session.runnerHint).toBe(true);
    expect(session.statusText()).toMatch(/no AI runner/i);
    session.stopPolling();
  });

  it("pollOnce is a no-op outside queued/processing", async () => {
    const { session, invoke } = makeSession(vi.fn());
    expect(await session.pollOnce()).toBe("idle");
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("AiEditSession import", () => {
  it("imports exactly once from done", async () => {
    const { session } = makeSession(
      vi
        .fn()
        .mockResolvedValueOnce({ jobId: "ai-7" })
        .mockResolvedValueOnce({ jobId: "ai-7", status: "done" })
        .mockResolvedValueOnce({ id: "cap-2", kind: "region" })
    );
    await session.submit("sharpen");
    await session.pollOnce();
    const ref = await session.importResult();
    expect(ref).toEqual({ id: "cap-2", kind: "region" });
    expect(session.state).toBe("imported");
    expect(session.importedRef).toEqual(ref);
    await expect(session.importResult()).rejects.toThrow(/nothing to import/);
    session.stopPolling();
  });

  it("refuses import before done", async () => {
    const { session } = makeSession(vi.fn().mockResolvedValue({ jobId: "ai-1" }));
    await session.submit("crop");
    await expect(session.importResult()).rejects.toThrow(/nothing to import/);
    session.stopPolling();
  });
});

describe("AiEditSession cancel", () => {
  it("cancels an active session and stops the timer", async () => {
    const { session, events } = makeSession(vi.fn().mockResolvedValue({ jobId: "ai-1" }));
    await session.submit("crop");
    expect(session.timer).not.toBeNull();
    session.cancel();
    expect(session.state).toBe("cancelled");
    expect(session.timer).toBeNull();
    expect(events.at(-1).state).toBe("cancelled");
  });

  it("cancel is a no-op when idle", () => {
    const { session, events } = makeSession(vi.fn());
    session.cancel();
    expect(session.state).toBe("idle");
    expect(events).toHaveLength(0);
  });
});
