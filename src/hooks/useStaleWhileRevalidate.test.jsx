// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { useStaleWhileRevalidate } from "./useStaleWhileRevalidate";
import { clearSWRCache, fetchWithDedupe } from "./swrCache";
import { markSWRHydrated, resetSWRHydration } from "./swrHydration";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function Probe({ cacheKey }) {
  const { data, error, isLoading, isRefreshing } = useStaleWhileRevalidate(
    cacheKey,
    () => Promise.resolve("fetched"),
  );
  if (isLoading) return <p>Loading…</p>;
  return (
    <p>
      data:{String(data)} error:{error} refreshing:{String(isRefreshing)}
    </p>
  );
}

beforeEach(() => {
  clearSWRCache();
  resetSWRHydration();
});

describe("useStaleWhileRevalidate (server-render contract)", () => {
  it("renders the loading state on SSR even with a warm cache (hydration boundary, React #418)", async () => {
    await fetchWithDedupe("warm:key", () => Promise.resolve("cached-payload"));
    const html = renderToStaticMarkup(<Probe cacheKey="warm:key" />);
    // The server has no disk entry and renders loading; the first client
    // render must match it, so a warm cache is NOT served during SSR.
    expect(html).toContain("Loading…");
    expect(html).not.toContain("cached-payload");
  });

  it("renders the loading state only when there is truly nothing cached", () => {
    const html = renderToStaticMarkup(<Probe cacheKey="cold:key" />);
    expect(html).toContain("Loading…");
  });

  it("keeps stale data visible after hydration when a cached error entry exists", async () => {
    await fetchWithDedupe("err:key", () => Promise.resolve("stale-ok"));
    await fetchWithDedupe("err:key", () => Promise.reject(new Error("refresh failed"))).catch(() => {});
    // SSR itself shows loading (the boundary), not the stale payload.
    const ssrHtml = renderToStaticMarkup(<Probe cacheKey="err:key" />);
    expect(ssrHtml).toContain("Loading…");
    expect(ssrHtml).not.toContain("stale-ok");

    // After the root hydrates, the stale data + error surface together.
    markSWRHydrated();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<Probe cacheKey="err:key" />);
    });
    expect(container.textContent).toContain("data:stale-ok");
    expect(container.textContent).toContain("error:refresh failed");
    expect(container.textContent).not.toContain("Loading");
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("is idle when the key is null", () => {
    const html = renderToStaticMarkup(<Probe cacheKey={null} />);
    expect(html).toContain("data:null");
    expect(html).not.toContain("Loading");
  });

  it("does not trigger a fetch during server render", () => {
    const fetcher = vi.fn(() => Promise.resolve("x"));
    function P() {
      useStaleWhileRevalidate("ssr:key", fetcher);
      return <p>ok</p>;
    }
    renderToStaticMarkup(<P />);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("useStaleWhileRevalidate (warm switch-back after hydration)", () => {
  it("serves a warm cache synchronously on a client remount after hydration (no loading flash)", async () => {
    await fetchWithDedupe("warm:key", () => Promise.resolve("cached-payload"));
    // The root has already hydrated in the running app, so the cache is
    // visible immediately on remount -- no loading flash.
    markSWRHydrated();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<Probe cacheKey="warm:key" />);
    });
    expect(container.textContent).toContain("data:cached-payload");
    expect(container.textContent).not.toContain("Loading");
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("stays in loading on a client mount before hydration is marked, then shows the cache", async () => {
    await fetchWithDedupe("warm:key", () => Promise.resolve("cached-payload"));
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<Probe cacheKey="warm:key" />);
    });
    // Before the root marks hydration, the warm cache stays hidden.
    expect(container.textContent).toContain("Loading…");
    await act(async () => {
      markSWRHydrated();
    });
    expect(container.textContent).toContain("data:cached-payload");
    expect(container.textContent).not.toContain("Loading");
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
