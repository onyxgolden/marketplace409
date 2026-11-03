import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({ requireBrainOwner: vi.fn() }));
vi.mock("@/domains/brain-conversation/requireBrainOwner", () => ({
  requireBrainOwner: mocks.requireBrainOwner,
}));

import { GET, PATCH } from "./route";
import { createMemoryBrainStore } from "@/domains/brain-conversation/memoryStore";

function patchRequest(body) {
  return new Request("http://localhost/api/brain/preferences", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET/PATCH /api/brain/preferences", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BRAIN_CONVERSATION_HARNESS_ENABLED = "true";
  });
  afterEach(() => {
    delete process.env.BRAIN_CONVERSATION_HARNESS_ENABLED;
  });

  it("returns defaults merged with stored values (session survival)", async () => {
    const store = createMemoryBrainStore();
    await store.setPreference("owner-a", "inferred_decay_days", 14);
    mocks.requireBrainOwner.mockResolvedValue({ ownerId: "owner-a", store });
    const data = await (await GET()).json();
    expect(data.preferences.inferred_decay_days).toBe(14);
    expect(data.preferences.brain_icon_position).toEqual({ x: 92, y: 85, collapsed: true });
  });

  it("saves a dragged icon position and rejects bad values", async () => {
    const store = createMemoryBrainStore();
    mocks.requireBrainOwner.mockResolvedValue({ ownerId: "owner-a", store });
    const saved = await PATCH(patchRequest({
      key: "brain_icon_position",
      value: { x: 10, y: 20, collapsed: false },
    }));
    expect(saved.status).toBe(200);
    expect((await saved.json()).value).toEqual({ x: 10, y: 20, collapsed: false });
    expect(await store.getPreference("owner-a", "brain_icon_position")).toEqual({
      x: 10,
      y: 20,
      collapsed: false,
    });
    expect(
      (await PATCH(patchRequest({ key: "inferred_decay_days", value: 200 }))).status,
    ).toBe(400);
    expect((await PATCH(patchRequest({ key: "unknown_key", value: 1 }))).status).toBe(400);
  });

  it("returns 503 when the harness is disabled", async () => {
    delete process.env.BRAIN_CONVERSATION_HARNESS_ENABLED;
    expect((await GET()).status).toBe(503);
  });
});
