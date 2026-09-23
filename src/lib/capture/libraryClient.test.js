// Tests for src/lib/capture/libraryClient.js — Rung 6 web library data
// layer. fetch is mocked; no network.
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  TITLE_MAX,
  deleteCapture,
  fetchLibraryItems,
  freshSignedUrlFor,
  isVideoItem,
  renameCapture,
} from "./libraryClient.js";

const ITEM = {
  id: "123e4567-e89b-42d3-a456-426614174000",
  title: "Shot",
  kind: "screenshot",
  mime_type: "image/png",
  signedUrl: "https://signed.example/one",
};

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => body };
}

describe("fetchLibraryItems", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  it("returns the items array", async () => {
    globalThis.fetch.mockResolvedValue(jsonResponse({ success: true, items: [ITEM] }));
    const items = await fetchLibraryItems();
    expect(items).toEqual([ITEM]);
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/capture/library", { credentials: "same-origin" });
  });

  it("returns an empty array when items is missing", async () => {
    globalThis.fetch.mockResolvedValue(jsonResponse({ success: true }));
    expect(await fetchLibraryItems()).toEqual([]);
  });

  it("throws the server's error message on failure", async () => {
    globalThis.fetch.mockResolvedValue(jsonResponse({ error: "nope" }, { ok: false, status: 401 }));
    await expect(fetchLibraryItems()).rejects.toThrow("nope");
  });
});

describe("renameCapture", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  it("PATCHes a title-only body and returns the new title", async () => {
    globalThis.fetch.mockResolvedValue(jsonResponse({ success: true, id: ITEM.id, title: "New title" }));
    const title = await renameCapture(ITEM.id, "  New title  ");
    expect(title).toBe("New title");
    const [url, init] = globalThis.fetch.mock.calls[0];
    expect(url).toBe(`/api/capture/library/${ITEM.id}`);
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ title: "New title" });
  });

  it("rejects an empty title without fetching", async () => {
    await expect(renameCapture(ITEM.id, "   ")).rejects.toThrow(/non-empty/i);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("rejects a title longer than the cap without fetching", async () => {
    await expect(renameCapture(ITEM.id, "t".repeat(TITLE_MAX + 1))).rejects.toThrow(/200/);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("throws the server's error message on failure", async () => {
    globalThis.fetch.mockResolvedValue(jsonResponse({ error: "Only the title may be updated." }, { ok: false, status: 400 }));
    await expect(renameCapture(ITEM.id, "x")).rejects.toThrow(/only the title/i);
  });
});

describe("deleteCapture", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  it("DELETEs the item idempotently", async () => {
    globalThis.fetch.mockResolvedValue(jsonResponse({ success: true }));
    expect(await deleteCapture(ITEM.id)).toBe(true);
    const [url, init] = globalThis.fetch.mock.calls[0];
    expect(url).toBe(`/api/capture/library/${ITEM.id}`);
    expect(init.method).toBe("DELETE");
  });

  it("throws the server's error message on failure", async () => {
    globalThis.fetch.mockResolvedValue(jsonResponse({ error: "boom" }, { ok: false, status: 500 }));
    await expect(deleteCapture(ITEM.id)).rejects.toThrow("boom");
  });
});

describe("freshSignedUrlFor", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  it("re-reads the library and returns this item's signed URL", async () => {
    globalThis.fetch.mockResolvedValue(jsonResponse({ success: true, items: [ITEM] }));
    expect(await freshSignedUrlFor(ITEM.id)).toBe(ITEM.signedUrl);
  });

  it("throws when the item is gone", async () => {
    globalThis.fetch.mockResolvedValue(jsonResponse({ success: true, items: [] }));
    await expect(freshSignedUrlFor(ITEM.id)).rejects.toThrow(/not found/i);
  });
});

describe("isVideoItem", () => {
  it("flags recordings and video/webm, not screenshots", () => {
    expect(isVideoItem({ kind: "recording", mime_type: "video/webm" })).toBe(true);
    expect(isVideoItem({ kind: "screenshot", mime_type: "image/png" })).toBe(false);
    expect(isVideoItem(null)).toBeFalsy();
  });
});
