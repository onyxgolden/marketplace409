// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import RentalSupportPanel from "./RentalSupportPanel";

const cases = [{
  id: "case_1", title: "Failed rent payment", case_type: "failed_payment",
  priority: "high", status: "investigating",
}];

function stubFetch(postHandler) {
  vi.stubGlobal("fetch", vi.fn(async (url, options) => {
    if (url === "/api/rental" && options?.method === "POST") {
      if (postHandler) return postHandler(JSON.parse(options.body));
      return { ok: true, json: async () => ({ success: true }) };
    }
    if (url === "/api/rental") {
      return { ok: true, json: async () => ({ supportCases: cases }) };
    }
    throw new Error(`unexpected fetch ${url}`);
  }));
}

async function flush(times = 6) {
  for (let i = 0; i < times; i++) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("RentalSupportPanel save confirmation", () => {
  it("saving a case update confirms at the top of the panel, not the bottom", async () => {
    stubFetch();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => { root.render(<RentalSupportPanel />); });
    await flush();
    const form = container.querySelector("form");
    expect(form).toBeTruthy();
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    const banner = container.querySelector('p[role="status"]');
    expect(banner).toBeTruthy();
    expect(banner.textContent).toBe("✓ Support case updated.");
    // The banner sits above the case list, where the user is looking.
    const article = container.querySelector("article");
    expect(article).toBeTruthy();
    expect(banner.compareDocumentPosition(article) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("a failed case update still reports as an error, never as success", async () => {
    stubFetch(() => ({ ok: false, json: async () => ({ error: "Resolution is required." }) }));
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => { root.render(<RentalSupportPanel />); });
    await flush();
    const form = container.querySelector("form");
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(container.querySelector('p[role="status"]')).toBeNull();
    const alert = container.querySelector('p[role="alert"]');
    expect(alert).toBeTruthy();
    expect(alert.textContent).toContain("Resolution is required.");
  });
});
