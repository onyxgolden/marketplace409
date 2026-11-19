// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import SWRIdentityBridge from "./SWRIdentityBridge";
import { useStaleWhileRevalidate } from "@/hooks/useStaleWhileRevalidate";
import { clearSWRCache, getCacheIdentity } from "@/hooks/swrCache.js";
import { markSWRHydrated, resetSWRHydration } from "@/hooks/swrHydration";

// The bridge subscribes to auth state on mount; stub the client so no real
// auth session event fires and wipes the identity under test.
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      }),
      getUser: () => Promise.resolve({ data: { user: null } }),
    },
  }),
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function Probe({ cacheKey }) {
  const { data, isLoading } = useStaleWhileRevalidate(cacheKey, () =>
    Promise.resolve("fetched"),
  );
  if (isLoading) return <p>loading</p>;
  return <p>{data ?? "empty"}</p>;
}

function seedDisk(userId, key, data) {
  window.localStorage.setItem(
    `forge.swr.v1:${userId}:${key}`,
    JSON.stringify({ data, error: "", updatedAt: Date.now() }),
  );
}

beforeEach(() => {
  clearSWRCache();
  resetSWRHydration();
  window.localStorage.clear();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "test-key");
});

describe("SWRIdentityBridge (PR #417 re-review finding 1; hydration boundary #418)", () => {
  it("applies the server-provided identity before children hydrate, but persisted data stays hidden until hydration is marked", async () => {
    // A disk entry from a previous session for this user:
    seedDisk("user-1", "bridge-key", "disk-data");

    // Server render: the identity is set synchronously, but the persisted
    // entry must NOT become visible -- the server renders loading.
    const ssrHtml = renderToStaticMarkup(
      <>
        <SWRIdentityBridge initialUserId="user-1" />
        <Probe cacheKey="bridge-key" />
      </>,
    );
    expect(getCacheIdentity()).toBe("user-1");
    expect(ssrHtml).toContain("loading");
    expect(ssrHtml).not.toContain("disk-data");

    // Client mount: the bridge's effect marks hydration, and only then does
    // the persisted entry appear (without a network fetch).
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <>
          <SWRIdentityBridge initialUserId="user-1" />
          <Probe cacheKey="bridge-key" />
        </>,
      );
    });
    expect(container.textContent).toContain("disk-data");
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("stays fail-closed when no user is signed in", () => {
    seedDisk("user-1", "other-key", "disk-data");

    const html = renderToStaticMarkup(
      <>
        <SWRIdentityBridge initialUserId={null} />
        <Probe cacheKey="other-key" />
      </>,
    );
    expect(getCacheIdentity()).toBeNull();
    // No identity: the disk is never touched, so the probe loads (never the
    // other user's data).
    expect(html).toContain("loading");
    expect(html).not.toContain("disk-data");
  });

  it("marking hydration is idempotent under Strict Mode double effects", async () => {
    seedDisk("user-1", "bridge-key", "disk-data");

    // Marking twice (as Strict Mode's double-effect invocation does) is a
    // no-op and leaves the store marked.
    markSWRHydrated();
    markSWRHydrated();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <>
          <SWRIdentityBridge initialUserId="user-1" />
          <Probe cacheKey="bridge-key" />
        </>,
      );
    });
    expect(container.textContent).toContain("disk-data");
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
