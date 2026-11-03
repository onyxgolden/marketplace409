import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({ requireBrainOwner: vi.fn() }));
vi.mock("@/domains/brain-conversation/requireBrainOwner", () => ({
  requireBrainOwner: mocks.requireBrainOwner,
}));

import { POST } from "./route";
import { createMemoryBrainStore } from "@/domains/brain-conversation/memoryStore";

describe("POST /api/brain/consolidate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BRAIN_CONVERSATION_HARNESS_ENABLED = "true";
  });
  afterEach(() => {
    delete process.env.BRAIN_CONVERSATION_HARNESS_ENABLED;
  });

  it("runs consolidation for the caller with their decay window", async () => {
    const store = createMemoryBrainStore();
    await store.appendEpisode("owner-a", {
      content: "chat turn",
      sessionId: "s-1",
      candidateFacts: [{ key: "planning-time", text: "Prefers morning planning" }],
    });
    mocks.requireBrainOwner.mockResolvedValue({ ownerId: "owner-a", store });
    const response = await POST();
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.promoted).toBe(1);
    expect(data.runAt).toBeDefined();
    expect(await store.listSemanticEntries("owner-a")).toHaveLength(1);
  });

  it("returns 503 when the harness is disabled", async () => {
    delete process.env.BRAIN_CONVERSATION_HARNESS_ENABLED;
    expect((await POST()).status).toBe(503);
  });
});
