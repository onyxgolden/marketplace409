// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import RentalAnimalsPanel from "./RentalAnimalsPanel";

const animals = [{
  id: "animal_1", name: "Biscuit", breed_description: "Lab mix",
  classification: "pet", approval_status: "requested",
}];

function stubFetch(postHandler) {
  vi.stubGlobal("fetch", vi.fn(async (url, options) => {
    if (url === "/api/rental" && options?.method === "POST") {
      if (postHandler) return postHandler(JSON.parse(options.body));
      return { ok: true, json: async () => ({ success: true }) };
    }
    if (url === "/api/rental") {
      return { ok: true, json: async () => ({ animals }) };
    }
    throw new Error(`unexpected fetch ${url}`);
  }));
}

async function flush(times = 6) {
  for (let i = 0; i < times; i++) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  }
}

function setInputValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  act(() => { setter.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("RentalAnimalsPanel save confirmation", () => {
  it("saving an animal review confirms at the top of the panel, not the bottom", async () => {
    stubFetch();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => { root.render(<RentalAnimalsPanel />); });
    await flush();
    const form = container.querySelector("form");
    expect(form).toBeTruthy();
    const evidence = form.querySelector('input[name="approvalEvidenceId"]');
    setInputValue(evidence, "evidence-doc-1");
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    const banner = container.querySelector('p[role="status"]');
    expect(banner).toBeTruthy();
    expect(banner.textContent).toBe("✓ Animal review saved.");
    const article = container.querySelector("article");
    expect(article).toBeTruthy();
    expect(banner.compareDocumentPosition(article) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
