// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import ApplicationsPanel from "./ApplicationsPanel";

// ScreeningPanel mount (R22 gate doc): the application review drawer must
// render the screening tab, so landlords can reach screening reopen.
const PENDING_APP = { id: "app_p", status: "pending", answers: { personal: { firstName: "Pam", lastName: "Pending", email: "pam@example.com" } }, submittedAt: "2026-10-20T00:00:00Z", listing: { title: "Unit A" } };

async function flush(times = 10) {
  for (let i = 0; i < times; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
function click(el) { act(() => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); }); }
function buttonWithText(root, text) {
  return [...root.querySelectorAll("button")].find((b) => b.textContent.includes(text));
}

describe("ApplicationsPanel screening mount", () => {
  let container;
  let root;
  let seenUrls;

  async function renderPanel() {
    seenUrls = [];
    vi.stubGlobal("fetch", async (url, options = {}) => {
      seenUrls.push(String(url));
      if (String(url).includes("/screening")) {
        return { ok: true, json: async () => ({ screening: null, events: [], providers: [], suggestion: null }) };
      }
      if (String(url).startsWith("/api/rental/applications/")) {
        return { ok: true, json: async () => ({ application: PENDING_APP, listing: { id: "listing_1", title: "Unit A", rentCents: 185000 }, form: null, decisions: [] }) };
      }
      if (String(url).startsWith("/api/rental/applications")) {
        return { ok: true, json: async () => ({ applications: [PENDING_APP] }) };
      }
      if (String(url).startsWith("/api/rental/listings")) return { ok: true, json: async () => ({ listings: [] }) };
      return { ok: true, json: async () => ({}) };
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => { root.render(<ApplicationsPanel />); });
    await flush();
  }

  afterEach(() => {
    if (root) act(() => root.unmount());
    container?.remove();
    container = null;
    vi.unstubAllGlobals();
  });

  it("renders the screening section inside the review drawer", async () => {
    await renderPanel();
    click(buttonWithText(container, "Pam Pending"));
    await flush();
    expect(container.textContent).toContain("Screening");
    expect(container.textContent).toContain("No screening requested yet");
    expect(seenUrls.some((u) => u === "/api/rental/applications/app_p/screening")).toBe(true);
  });
});
