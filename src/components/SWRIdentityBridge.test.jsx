import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import SWRIdentityBridge from "./SWRIdentityBridge";
import { clearSWRCache, getCacheEntry, getCacheIdentity } from "@/hooks/swrCache.js";

function installLocalStorageStub() {
  const store = new Map();
  const stub = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(String(key), String(value)); },
    removeItem: (key) => { store.delete(key); },
    clear: () => { store.clear(); },
    key: (index) => [...store.keys()][index] ?? null,
    get length() { return store.size; },
  };
  vi.stubGlobal("window", { localStorage: stub });
  return { store, stub };
}

beforeEach(() => {
  clearSWRCache();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "test-key");
});

describe("SWRIdentityBridge (PR #417 re-review finding 1)", () => {
  it("applies the server-provided identity before children hydrate from disk", () => {
    const { store } = installLocalStorageStub();
    // A disk entry from a previous session for this user:
    store.set(
      "forge.swr.v1:user-1:bridge-key",
      JSON.stringify({ data: "disk-data", error: "", updatedAt: Date.now() }),
    );

    function Probe() {
      const entry = getCacheEntry("bridge-key");
      return <p>{entry?.data ?? "empty"}</p>;
    }

    // The bridge renders first: its render-phase init runs before the probe's
    // disk hydration, so first paint already has the data -- no loading flash.
    const html = renderToStaticMarkup(
      <>
        <SWRIdentityBridge initialUserId="user-1" />
        <Probe />
      </>,
    );
    expect(getCacheIdentity()).toBe("user-1");
    expect(html).toContain("disk-data");
    vi.unstubAllGlobals();
  });

  it("stays fail-closed when no user is signed in", () => {
    const { store } = installLocalStorageStub();
    store.set(
      "forge.swr.v1:user-1:other-key",
      JSON.stringify({ data: "disk-data", error: "", updatedAt: Date.now() }),
    );

    function Probe() {
      const entry = getCacheEntry("other-key");
      return <p>{entry?.data ?? "empty"}</p>;
    }

    const html = renderToStaticMarkup(
      <>
        <SWRIdentityBridge initialUserId={null} />
        <Probe />
      </>,
    );
    expect(getCacheIdentity()).toBeNull();
    expect(html).toContain("empty"); // disk never touched without an identity
    vi.unstubAllGlobals();
  });
});
