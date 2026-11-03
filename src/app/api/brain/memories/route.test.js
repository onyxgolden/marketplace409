import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({ requireBrainOwner: vi.fn() }));
vi.mock("@/domains/brain-conversation/requireBrainOwner", () => ({
  requireBrainOwner: mocks.requireBrainOwner,
}));

import { GET, POST } from "./route";
import { createMemoryBrainStore } from "@/domains/brain-conversation/memoryStore";

function authed(store, ownerId = "owner-a") {
  return { ownerId, store };
}

function postRequest(body) {
  return new Request("http://localhost/api/brain/memories", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET/POST /api/brain/memories", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BRAIN_CONVERSATION_HARNESS_ENABLED = "true";
  });
  afterEach(() => {
    delete process.env.BRAIN_CONVERSATION_HARNESS_ENABLED;
  });

  it("returns 503 when the harness is disabled", async () => {
    delete process.env.BRAIN_CONVERSATION_HARNESS_ENABLED;
    expect((await GET()).status).toBe(503);
  });

  it("passes through the 401 when signed out", async () => {
    mocks.requireBrainOwner.mockResolvedValue({
      response: Response.json({ error: "Please sign in." }, { status: 401 }),
    });
    expect((await GET()).status).toBe(401);
  });

  it("lists only the caller's own memories", async () => {
    const store = createMemoryBrainStore();
    await store.createSemanticEntry("owner-a", { content: "A note" });
    await store.createSemanticEntry("owner-b", { content: "B note" });
    mocks.requireBrainOwner.mockResolvedValue(authed(store));
    const response = await GET();
    const data = await response.json();
    expect(data.entries).toHaveLength(1);
    expect(data.entries[0].content).toBe("A note");
  });

  it("creates an owner-stated memory and rejects empty content", async () => {
    const store = createMemoryBrainStore();
    mocks.requireBrainOwner.mockResolvedValue(authed(store));
    const response = await POST(postRequest({ content: "Prefers morning planning", salience: "owner_stated" }));
    expect(response.status).toBe(201);
    expect((await response.json()).entry.salience).toBe("owner_stated");
    expect((await POST(postRequest({ content: "   " }))).status).toBe(400);
  });

  it("rejects verified salience on create (earned only by consolidation)", async () => {
    const store = createMemoryBrainStore();
    mocks.requireBrainOwner.mockResolvedValue(authed(store));
    expect((await POST(postRequest({ content: "note", salience: "verified" }))).status).toBe(400);
  });
});
