import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({ requireBrainOwner: vi.fn() }));
vi.mock("@/domains/brain-conversation/requireBrainOwner", () => ({
  requireBrainOwner: mocks.requireBrainOwner,
}));

import { GET, POST } from "./route";
import { createMemoryBrainStore } from "@/domains/brain-conversation/memoryStore";

function postRequest(body) {
  return new Request("http://localhost/api/brain/episodes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET/POST /api/brain/episodes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BRAIN_CONVERSATION_HARNESS_ENABLED = "true";
  });
  afterEach(() => {
    delete process.env.BRAIN_CONVERSATION_HARNESS_ENABLED;
  });

  it("appends an episode and lists newest first", async () => {
    const store = createMemoryBrainStore();
    mocks.requireBrainOwner.mockResolvedValue({ ownerId: "owner-a", store });
    const response = await POST(
      postRequest({ content: "First turn", sessionId: "s-1", tags: ["chat"] }),
    );
    expect(response.status).toBe(201);
    const listed = await (await GET()).json();
    expect(listed.episodes).toHaveLength(1);
    expect(listed.episodes[0].sessionId).toBe("s-1");
  });

  it("requires both content and a session id", async () => {
    const store = createMemoryBrainStore();
    mocks.requireBrainOwner.mockResolvedValue({ ownerId: "owner-a", store });
    expect((await POST(postRequest({ content: "no session" }))).status).toBe(400);
    expect((await POST(postRequest({ sessionId: "s-1" }))).status).toBe(400);
  });

  it("returns 503 when the harness is disabled", async () => {
    delete process.env.BRAIN_CONVERSATION_HARNESS_ENABLED;
    expect((await GET()).status).toBe(503);
  });
});
