import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { useStaleWhileRevalidate } from "./useStaleWhileRevalidate";
import { clearSWRCache, fetchWithDedupe } from "./swrCache";

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
});

describe("useStaleWhileRevalidate (server-render contract)", () => {
  it("renders cached data on first paint with no loading flash (warm switch-back)", async () => {
    await fetchWithDedupe("warm:key", () => Promise.resolve("cached-payload"));
    const html = renderToStaticMarkup(<Probe cacheKey="warm:key" />);
    expect(html).toContain("data:cached-payload");
    expect(html).not.toContain("Loading");
  });

  it("renders the loading state only when there is truly nothing cached", () => {
    const html = renderToStaticMarkup(<Probe cacheKey="cold:key" />);
    expect(html).toContain("Loading…");
  });

  it("keeps stale data visible when a cached error entry exists", async () => {
    await fetchWithDedupe("err:key", () => Promise.resolve("stale-ok"));
    await fetchWithDedupe("err:key", () => Promise.reject(new Error("refresh failed"))).catch(() => {});
    const html = renderToStaticMarkup(<Probe cacheKey="err:key" />);
    expect(html).toContain("data:stale-ok");
    expect(html).toContain("error:refresh failed");
    expect(html).not.toContain("Loading");
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
