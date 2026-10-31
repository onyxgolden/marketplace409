// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import ScreeningPanel from "./ScreeningPanel";

async function mount(screening) {
  vi.stubGlobal("fetch", vi.fn(async (url, options) => {
    if (options?.method === "POST" || options?.method === "PATCH") {
      return { ok: true, json: async () => ({ screening: screening || { status: "requested" } }) };
    }
    return { ok: true, json: async () => ({ screening, events: [], providers: [], suggestion: null }) };
  }));
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<ScreeningPanel applicationId="app_1" applicantName="Dana Applicant" />);
  });
  return { container, root };
}

async function flush(times = 6) {
  for (let i = 0; i < times; i++) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  }
}

describe("ScreeningPanel save confirmations", () => {
  let mounted;
  afterEach(() => {
    if (mounted) { act(() => mounted.root.unmount()); mounted.container.remove(); mounted = null; }
    vi.unstubAllGlobals();
  });

  it("requesting screening confirms with the applicant's name", async () => {
    mounted = await mount(null);
    await flush();
    const button = [...mounted.container.querySelectorAll("button")].find((item) => item.textContent === "Request screening");
    expect(button).toBeTruthy();
    await act(async () => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();
    const banner = mounted.container.querySelector('p[role="status"]');
    expect(banner).toBeTruthy();
    expect(banner.textContent).toBe("✓ Screening requested for Dana Applicant.");
  });

  it("marking a screening in progress confirms the status change", async () => {
    mounted = await mount({ status: "requested" });
    await flush();
    const button = [...mounted.container.querySelectorAll("button")].find((item) => item.textContent === "Mark in progress");
    expect(button).toBeTruthy();
    await act(async () => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();
    const banner = mounted.container.querySelector('p[role="status"]');
    expect(banner).toBeTruthy();
    expect(banner.textContent).toBe("✓ Screening marked in progress.");
  });
});
