// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { useStaleWhileRevalidate } from "./useStaleWhileRevalidate";
import { clearSWRCache, setCacheIdentity } from "./swrCache";

function Probe({ cacheKey, fetcher }) {
  const { data, isLoading } = useStaleWhileRevalidate(cacheKey, fetcher, { ttlMs: 60000 });
  return <p>{isLoading ? "loading" : `data:${data}`}</p>;
}

function mountProbe(cacheKey, fetcher) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  return { container, root };
}

beforeEach(() => {
  clearSWRCache();
});

describe("useStaleWhileRevalidate identity-change lifecycle (PR #417 re-review)", () => {
  it("an already-mounted consumer refetches after an identity change with the same key", async () => {
    setCacheIdentity("user-a");
    let calls = 0;
    const fetcher = () => {
      calls += 1;
      return Promise.resolve(`data-from-call-${calls}`);
    };

    const { container, root } = mountProbe("lifecycle-key", fetcher);
    await act(async () => {
      root.render(<Probe cacheKey="lifecycle-key" fetcher={fetcher} />);
    });
    expect(container.textContent).toContain("data-from-call-1");
    expect(calls).toBe(1);

    // Account switch: same key, same TTL, new identity. Before the fix, the
    // notify re-rendered into loading state but the fetch effect never re-ran
    // (deps unchanged), leaving the component stuck on "loading" forever.
    await act(async () => {
      setCacheIdentity("user-b");
    });

    expect(calls).toBe(2); // exactly one refetch -- no duplicate, none missing
    expect(container.textContent).toContain("data-from-call-2");
    expect(container.textContent).not.toContain("loading");

    root.unmount();
    container.remove();
  });

  it("two mounted consumers sharing a key trigger only one refetch on identity change", async () => {
    setCacheIdentity("user-a");
    let calls = 0;
    const fetcher = () => {
      calls += 1;
      return Promise.resolve(`v${calls}`);
    };

    const a = mountProbe("shared-key", fetcher);
    const b = mountProbe("shared-key", fetcher);
    await act(async () => {
      a.root.render(<Probe cacheKey="shared-key" fetcher={fetcher} />);
      b.root.render(<Probe cacheKey="shared-key" fetcher={fetcher} />);
    });
    expect(calls).toBe(1); // deduped on mount

    await act(async () => {
      setCacheIdentity("user-b");
    });

    expect(calls).toBe(2); // one shared refetch, not one per consumer
    expect(a.container.textContent).toContain("v2");
    expect(b.container.textContent).toContain("v2");

    a.root.unmount();
    b.root.unmount();
    a.container.remove();
    b.container.remove();
  });

  it("ordinary data notifications do not cause duplicate fetches", async () => {
    setCacheIdentity("user-a");
    let calls = 0;
    const fetcher = () => {
      calls += 1;
      return Promise.resolve(`v${calls}`);
    };

    const { container, root } = mountProbe("quiet-key", fetcher);
    await act(async () => {
      root.render(<Probe cacheKey="quiet-key" fetcher={fetcher} />);
    });
    expect(calls).toBe(1);

    // Let every notification settle; the epoch is unchanged so the fetch
    // effect must not re-run.
    await act(async () => {});
    expect(calls).toBe(1);
    expect(container.textContent).toContain("v1");

    root.unmount();
    container.remove();
  });
});
