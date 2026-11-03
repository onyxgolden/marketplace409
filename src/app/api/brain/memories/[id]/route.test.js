import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({ requireBrainOwner: vi.fn() }));
vi.mock("@/domains/brain-conversation/requireBrainOwner", () => ({
  requireBrainOwner: mocks.requireBrainOwner,
}));

import { PATCH, DELETE } from "./route";
import { createMemoryBrainStore } from "@/domains/brain-conversation/memoryStore";

function patchRequest(body) {
  return new Request("http://localhost/api/brain/memories/x", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PATCH/DELETE /api/brain/memories/[id] (A6)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BRAIN_CONVERSATION_HARNESS_ENABLED = "true";
  });
  afterEach(() => {
    delete process.env.BRAIN_CONVERSATION_HARNESS_ENABLED;
  });

  it("edits content only and deletes the caller's own entry", async () => {
    const store = createMemoryBrainStore();
    const entry = await store.createSemanticEntry("owner-a", {
      content: "Old text",
      salience: "owner_stated",
    });
    mocks.requireBrainOwner.mockResolvedValue({ ownerId: "owner-a", store });
    const patched = await PATCH(patchRequest({ content: "New text" }), { params: { id: entry.id } });
    expect(patched.status).toBe(200);
    const patchedData = await patched.json();
    expect(patchedData.entry.content).toBe("New text");
    expect(patchedData.entry.salience).toBe("owner_stated");
    const deleted = await DELETE(new Request("http://localhost/api/brain/memories/x"), {
      params: { id: entry.id },
    });
    expect(deleted.status).toBe(200);
    expect(await store.listSemanticEntries("owner-a")).toHaveLength(0);
  });

  it("returns 404, not a leak, for another owner's id", async () => {
    const store = createMemoryBrainStore();
    const entry = await store.createSemanticEntry("owner-a", { content: "A note" });
    mocks.requireBrainOwner.mockResolvedValue({ ownerId: "owner-b", store });
    expect(
      (await PATCH(patchRequest({ content: "hijack" }), { params: { id: entry.id } })).status,
    ).toBe(404);
    expect(
      (await DELETE(new Request("http://localhost/api/brain/memories/x"), { params: { id: entry.id } })).status,
    ).toBe(404);
  });

  it("returns 503 when the harness is disabled", async () => {
    delete process.env.BRAIN_CONVERSATION_HARNESS_ENABLED;
    expect(
      (await PATCH(patchRequest({ content: "x" }), { params: { id: "any" } })).status,
    ).toBe(503);
  });
});
