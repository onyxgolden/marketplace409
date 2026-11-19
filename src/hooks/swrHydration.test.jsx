// @vitest-environment jsdom
import { StrictMode, act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SWRIdentityBridge from "@/components/SWRIdentityBridge";
import { useStaleWhileRevalidate } from "./useStaleWhileRevalidate";
import {
  clearSWRCache,
  setCacheIdentity,
} from "./swrCache";
import { markSWRHydrated, resetSWRHydration, getSWRHydrationSnapshot, getSWRHydrationServerSnapshot } from "./swrHydration";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// The bridge creates a supabase client and subscribes to auth state; stub it
// so the hydration tests exercise the bridge, not the network.
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

const USER_ID = "user-1";
const WORKSPACE_ID = "ws-1";
const HEALTH_KEY = `health:dashboard:${WORKSPACE_ID}`;

// A valid Health snapshot (the shape HealthDashboard renders full Overview
// content from) -- the confirmed #418 trigger key.
const HEALTH_SNAPSHOT = {
  profiles: [{ id: "profile-1", display_name: "jasonmorgan99@gmail.com", profile_type: "self" }],
  conditions: [],
  careTeam: [],
  labs: [],
  regimen: [],
  measurements: [],
  workouts: [],
  timeline: [],
  programs: [],
  programDays: [],
  documents: [],
};

function Probe({ cacheKey, fetcher }) {
  const { data, isLoading } = useStaleWhileRevalidate(cacheKey, fetcher, { ttlMs: 60_000 });
  if (isLoading) return <p>Loading…</p>;
  const name = data?.profiles?.[0]?.display_name ?? "no-profile";
  return <p>profile:{name}</p>;
}

function seedDisk(userId, key, data) {
  window.localStorage.setItem(
    `forge.swr.v1:${userId}:${key}`,
    JSON.stringify({ data, error: "", updatedAt: Date.now() }),
  );
}

function renderServerTree({ userId, fetcher }) {
  return renderToString(
    <>
      <SWRIdentityBridge initialUserId={userId} />
      <Probe cacheKey={HEALTH_KEY} fetcher={fetcher} />
    </>,
  );
}

function hydrateTree(container, { userId, fetcher, onRecoverableError, strict = false }) {
  const tree = (
    <>
      <SWRIdentityBridge initialUserId={userId} />
      <Probe cacheKey={HEALTH_KEY} fetcher={fetcher} />
    </>
  );
  const root = hydrateRoot(container, strict ? <StrictMode>{tree}</StrictMode> : tree, {
    onRecoverableError,
  });
  return root;
}

beforeEach(() => {
  resetSWRHydration();
  clearSWRCache();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("SWR hydration boundary (React #418) — real renderToString → hydrateRoot", () => {
  it("server renders loading, hydration matches with zero recoverable errors, then cached content appears without network", async () => {
    const fetcher = vi.fn(() => Promise.resolve(HEALTH_SNAPSHOT));
    const onRecoverableError = vi.fn();
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // A fresh persisted Health snapshot for the signed-in user.
    seedDisk(USER_ID, HEALTH_KEY, HEALTH_SNAPSHOT);

    const serverHtml = renderServerTree({ userId: USER_ID, fetcher });
    expect(serverHtml).toContain("Loading…");
    expect(serverHtml).not.toContain("jasonmorgan99@gmail.com");

    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = serverHtml;

    let root;
    await act(async () => {
      root = hydrateTree(container, { userId: USER_ID, fetcher, onRecoverableError });
      await Promise.resolve();
    });

    // First hydration markup matches the server (loading) -- no mismatch.
    expect(onRecoverableError).not.toHaveBeenCalled();
    const hydrationErrors = consoleSpy.mock.calls.filter((args) =>
      String(args[0]).includes("hydrat"),
    );
    expect(hydrationErrors).toEqual([]);

    // After the root bridge marks hydration, the persisted snapshot appears
    // without waiting for the network fetch.
    expect(container.textContent).toContain("profile:jasonmorgan99@gmail.com");
    expect(fetcher).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
    container.remove();
    consoleSpy.mockRestore();
  });

  it("a cold cache transitions from loading to fetched data (no deadlock)", async () => {
    const fetcher = vi.fn(() => Promise.resolve(HEALTH_SNAPSHOT));
    const onRecoverableError = vi.fn();

    const serverHtml = renderServerTree({ userId: USER_ID, fetcher });
    expect(serverHtml).toContain("Loading…");

    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = serverHtml;

    let root;
    await act(async () => {
      root = hydrateTree(container, { userId: USER_ID, fetcher, onRecoverableError });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onRecoverableError).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("profile:jasonmorgan99@gmail.com");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("a persisted entry for another user is never shown after an account switch", async () => {
    // user-2's own snapshot is deliberately different from user-1's, so the
    // test proves the displayed data came from user-2's fetch, not user-1's disk.
    const user2Snapshot = {
      ...HEALTH_SNAPSHOT,
      profiles: [{ id: "profile-2", display_name: "spouse@example.com", profile_type: "self" }],
    };
    const fetcher = vi.fn(() => Promise.resolve(user2Snapshot));
    const onRecoverableError = vi.fn();

    // The disk holds user-1's snapshot, but the signed-in user is user-2.
    seedDisk(USER_ID, HEALTH_KEY, HEALTH_SNAPSHOT);

    const serverHtml = renderServerTree({ userId: "user-2", fetcher });
    expect(serverHtml).toContain("Loading…");
    expect(serverHtml).not.toContain("jasonmorgan99@gmail.com");
    expect(serverHtml).not.toContain("spouse@example.com");

    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = serverHtml;

    let root;
    await act(async () => {
      root = hydrateTree(container, { userId: "user-2", fetcher, onRecoverableError });
      await Promise.resolve();
      await Promise.resolve();
    });

    // Hydration matches (loading) and user-1's data never appears; the fetch
    // runs for user-2 and supplies their own snapshot.
    expect(onRecoverableError).not.toHaveBeenCalled();
    expect(container.textContent).toContain("profile:spouse@example.com");
    expect(container.textContent).not.toContain("jasonmorgan99@gmail.com");
    expect(fetcher).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("Strict Mode double effects do not duplicate hydration marking or fetches", async () => {
    const fetcher = vi.fn(() => Promise.resolve(HEALTH_SNAPSHOT));
    const onRecoverableError = vi.fn();

    seedDisk(USER_ID, HEALTH_KEY, HEALTH_SNAPSHOT);

    const serverHtml = renderServerTree({ userId: USER_ID, fetcher });
    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = serverHtml;

    let root;
    await act(async () => {
      root = hydrateTree(container, { userId: USER_ID, fetcher, onRecoverableError, strict: true });
      await Promise.resolve();
    });

    expect(onRecoverableError).not.toHaveBeenCalled();
    expect(container.textContent).toContain("profile:jasonmorgan99@gmail.com");
    // The fresh disk entry means no network fetch at all, even with Strict
    // Mode's double-effect invocation.
    expect(fetcher).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("the store contract: client snapshot starts false, server snapshot is always false, marking is idempotent", () => {
    expect(getSWRHydrationSnapshot()).toBe(false);
    expect(getSWRHydrationServerSnapshot()).toBe(false);
    markSWRHydrated();
    expect(getSWRHydrationSnapshot()).toBe(true);
    // The server snapshot must stay false even after the client marks
    // hydration -- it is what SSR and the first hydration render read.
    expect(getSWRHydrationServerSnapshot()).toBe(false);
    // Marking again is a no-op (no throw, no state change).
    markSWRHydrated();
    expect(getSWRHydrationSnapshot()).toBe(true);
  });
});
