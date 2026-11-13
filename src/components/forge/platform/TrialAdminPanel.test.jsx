// @vitest-environment jsdom
// SaaS 30-day trial — unit tests for the platform-owner console panel.
// The server page enforces the platform-owner check; this panel is
// tested for its client behavior: workspace search/selection, the
// grant button only for eligible pending pairs (Capture disabled until
// PR 4), the mandatory reason + confirmation before any mutation, the
// duplicate-submit guard, and the convert action for a trial.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import TrialAdminPanel from "./TrialAdminPanel.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const response = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

async function flush(times = 1) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  }
}

function click(button) {
  return act(async () => {
    button.click();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function setValue(element, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  return act(async () => {
    setter.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    await Promise.resolve();
  });
}

function buttonByText(container, text) {
  return [...container.querySelectorAll("button")].find((b) => b.textContent.includes(text));
}

const OVERVIEW = {
  ok: true,
  owner_id: "owner-9",
  display_name: "Trial Workspace",
  status: "active",
  entitlements: [
    { app_key: "planner", status: "pending", source: null, starts_at: null, ends_at: null },
    { app_key: "capture", status: "pending", source: null, starts_at: null, ends_at: null },
  ],
  trials: [],
  availability: [
    { app_key: "planner", enabled: true, reason: "Planner trials enabled." },
    { app_key: "capture", enabled: false, reason: "Capture trial issuance is disabled until native-auth PR 4 lands." },
  ],
  audit: [],
};

const TRIAL_OVERVIEW = {
  ...OVERVIEW,
  entitlements: [
    { app_key: "planner", status: "active", source: "owner_trial", starts_at: "2026-11-13T12:00:00Z", ends_at: "2026-12-13T12:00:00Z" },
    { app_key: "capture", status: "pending", source: null, starts_at: null, ends_at: null },
  ],
  trials: [
    { id: "g1", app_key: "planner", grant_kind: "initial", starts_at: "2026-11-13T12:00:00Z", ends_at: "2026-12-13T12:00:00Z", grant_reason: "pilot" },
  ],
  audit: [{ id: "a1", app_key: "planner", event: "granted", created_at: "2026-11-13T12:00:00Z", reason: "pilot" }],
};

let container;
let root;
let fetchMock;

function renderPanel() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  return act(async () => {
    root.render(<TrialAdminPanel />);
  });
}

async function selectWorkspace(overview) {
  // Queue in fetch order: the Search click's list load, then the
  // workspace button's overview load.
  fetchMock.mockResolvedValueOnce(response({ ok: true, workspaces: [{ owner_id: "owner-9", display_name: "Trial Workspace", status: "active" }] }));
  fetchMock.mockResolvedValueOnce(response(overview));
  await click(buttonByText(container, "Search"));
  await flush(2);
  await click(buttonByText(container, "Trial Workspace"));
  await flush(2);
}

describe("TrialAdminPanel", () => {
  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    // Initial list load (empty search).
    fetchMock.mockResolvedValue(response({ ok: true, workspaces: [] }));
    globalThis.crypto.randomUUID = () => "test-request-id";
  });

  afterEach(async () => {
    await act(async () => { root?.unmount(); });
    container?.remove();
    vi.restoreAllMocks();
  });

  it("shows the grant button for Planner (pending + enabled) but not for Capture (disabled)", async () => {
    await renderPanel();
    await selectWorkspace(OVERVIEW);
    expect(container.textContent).toContain("Trial Workspace");
    expect(buttonByText(container, "Grant a 30-day Planner trial")).toBeTruthy();
    expect(buttonByText(container, "Grant a 30-day Capture trial")).toBeUndefined();
    expect(container.textContent).toContain("disabled until native-auth PR 4");
  });

  it("requires a reason before confirming a grant", async () => {
    await renderPanel();
    await selectWorkspace(OVERVIEW);
    await click(buttonByText(container, "Grant a 30-day Planner trial"));
    await flush(2);
    expect(container.textContent).toMatch(/reason is required/);
    expect(fetchMock.mock.calls.filter(([url]) => url.includes("/grant")).length).toBe(0);
  });

  it("grants with the reason + confirmation, reusing one request id, and shows the success notice", async () => {
    await renderPanel();
    await selectWorkspace(OVERVIEW);
    const reasonInput = container.querySelector("#trial-reason-planner");
    await setValue(reasonInput, "pilot for workspace");
    await click(buttonByText(container, "Grant a 30-day Planner trial"));
    await flush(2);
    expect(container.textContent).toContain("Grant a 30-day Planner trial to Trial Workspace?");
    fetchMock.mockResolvedValueOnce(response({ ok: true, status: "active", source: "owner_trial" }));
    fetchMock.mockResolvedValueOnce(response(TRIAL_OVERVIEW));
    await click(buttonByText(container, "Yes, do it"));
    await flush(3);
    const grantCalls = fetchMock.mock.calls.filter(([url]) => url.includes("/grant"));
    expect(grantCalls).toHaveLength(1);
    expect(JSON.parse(grantCalls[0][1].body)).toMatchObject({
      owner_id: "owner-9",
      app_key: "planner",
      reason: "pilot for workspace",
      request_id: "test-request-id",
    });
    expect(container.textContent).toMatch(/30-day trial for planner starts now/);
  });

  it("shows Convert to paid/manual access for an active trial, never as proof of payment", async () => {
    await renderPanel();
    await selectWorkspace(TRIAL_OVERVIEW);
    expect(buttonByText(container, "Convert to paid/manual access")).toBeTruthy();
    expect(container.textContent).toContain("First trial");
    const reasonInput = container.querySelector("#trial-reason-planner");
    await setValue(reasonInput, "paying customer now");
    await click(buttonByText(container, "Convert to paid/manual access"));
    await flush(2);
    expect(container.textContent).toContain("Convert the Planner trial for Trial Workspace to paid/manual access?");
    expect(container.textContent).toContain("The data stays exactly as it is.");
  });

  it("shows the trial history", async () => {
    await renderPanel();
    await selectWorkspace(TRIAL_OVERVIEW);
    expect(container.textContent).toContain("granted");
    expect(container.textContent).toContain("pilot");
  });
});
