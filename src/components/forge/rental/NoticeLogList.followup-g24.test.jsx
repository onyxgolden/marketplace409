// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import NoticeLogList from "./NoticeLogList";

// Controls-sweep follow-up G24 (O-19): the notice log states the
// print-and-mail delivery path with a Mailing link — no silent absence.
async function flush(times = 10) {
  for (let i = 0; i < times; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

describe("NoticeLogList follow-up G24", () => {
  let container;
  let root;

  afterEach(() => { act(() => { root?.unmount(); }); container?.remove(); vi.unstubAllGlobals(); });

  it("O-19: log states print-and-mail delivery with a Mailing link", async () => {
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      json: async () => ({ notices: [{ id: "n1", formName: "Rent increase", renderedBody: "Rent goes up.", createdAt: "2026-11-01T00:00:00Z", tenantId: "t1" }] }),
    }));
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => { root.render(<NoticeLogList />); });
    await flush();
    expect(container.textContent).toContain("delivered by print and mail");
    const link = container.querySelector('a[href="/forge/rental?section=mailing"]');
    expect(link).toBeTruthy();
    expect(container.textContent).toContain("Rent increase");
  });
});
