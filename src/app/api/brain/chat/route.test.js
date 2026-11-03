import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({ requireBrainOwner: vi.fn() }));
vi.mock("@/domains/brain-conversation/requireBrainOwner", () => ({
  requireBrainOwner: mocks.requireBrainOwner,
}));

import { POST } from "./route";
import { createMemoryBrainStore } from "@/domains/brain-conversation/memoryStore";

function postRequest(body) {
  return new Request("http://localhost/api/brain/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/brain/chat (answering not activated)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BRAIN_CONVERSATION_HARNESS_ENABLED = "true";
  });
  afterEach(() => {
    delete process.env.BRAIN_CONVERSATION_HARNESS_ENABLED;
  });

  it("saves the turn, never answers, and returns plain-words recall", async () => {
    const store = createMemoryBrainStore();
    await store.createSemanticEntry("owner-a", {
      content: "Prefers morning planning",
      salience: "owner_stated",
    });
    mocks.requireBrainOwner.mockResolvedValue({ ownerId: "owner-a", store });
    const response = await POST(postRequest({ message: "morning planning", sessionId: "s-1" }));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.answeringEnabled).toBe(false);
    expect(data.answer).toBeNull();
    expect(data.notice).toContain("not activated yet");
    expect(data.workingSetPlainWords).toContain("You told the Brain: Prefers morning planning.");
    expect(data.sessionId).toBe("s-1");
    // The turn itself was appended as an episode.
    expect(await store.listEpisodes("owner-a")).toHaveLength(1);
  });

  it("requires a message and a session id", async () => {
    const store = createMemoryBrainStore();
    mocks.requireBrainOwner.mockResolvedValue({ ownerId: "owner-a", store });
    expect((await POST(postRequest({ message: "hi" }))).status).toBe(400);
  });

  it("returns 503 when the harness is disabled", async () => {
    delete process.env.BRAIN_CONVERSATION_HARNESS_ENABLED;
    expect((await POST(postRequest({ message: "hi", sessionId: "s-1" }))).status).toBe(503);
  });
});
