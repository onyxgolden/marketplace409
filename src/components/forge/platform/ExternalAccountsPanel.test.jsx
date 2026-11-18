// @vitest-environment jsdom
// Unit tests for the External Accounts Register panel: list rendering,
// create with a plain-words confirmation, delete with a confirmation
// naming the provider, and seed preview (no writes on preview).
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import ExternalAccountsPanel from "./ExternalAccountsPanel.jsx";

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

function setSelect(element, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
  return act(async () => {
    setter.call(element, value);
    element.dispatchEvent(new Event("change", { bubbles: true }));
    await Promise.resolve();
  });
}

function buttonByText(container, text) {
  return [...container.querySelectorAll("button")].find((b) => b.textContent.includes(text));
}

function inputByLabel(container, labelText) {
  const label = [...container.querySelectorAll("label")].find((l) =>
    l.textContent.includes(labelText),
  );
  return label?.querySelector("input, select, textarea");
}

const ACCOUNTS = [
  {
    id: "acc-1",
    provider_name: "GitHub",
    purpose: "Development",
    associated_app: "FORGE",
    record_status: "confirmed_account",
    setup_status: "ready",
    version: 1,
    deleted_at: null,
  },
  {
    id: "acc-2",
    provider_name: "Namecheap",
    purpose: "Domain registration",
    associated_app: "409 Marketplace",
    record_status: "confirmed_account",
    setup_status: "in_progress",
    version: 3,
    deleted_at: null,
  },
];

let fetchCalls;
let fetchImpl;

function installFetch() {
  fetchCalls = [];
  fetchImpl = vi.fn(async (url, options = {}) => {
    fetchCalls.push({ url, method: options.method ?? "GET", body: options.body });
    if (url.startsWith("/api/forge/platform/external-accounts?")) {
      return response({ ok: true, accounts: ACCOUNTS });
    }
    if (url === "/api/forge/platform/external-accounts" && options.method === "POST") {
      return response({ ok: true, message: "Saved New Co.", id: "acc-3" }, 201);
    }
    if (url === "/api/forge/platform/external-accounts/acc-1") {
      return response({ ok: true, account: ACCOUNTS[0], threads: [], audit: [] });
    }
    if (url === "/api/forge/platform/external-accounts/seed") {
      return response({ ok: true, preview: { creates: 137, matches: 2, conflicts: 0 } });
    }
    return response({ ok: true });
  });
  globalThis.fetch = fetchImpl;
}

async function renderPanel() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<ExternalAccountsPanel />);
  });
  await flush(2);
  return { container, root };
}

describe("ExternalAccountsPanel", () => {
  beforeEach(() => {
    installFetch();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("lists accounts with counts and opens the detail view", async () => {
    const { container } = await renderPanel();
    expect(container.textContent).toContain("GitHub");
    expect(container.textContent).toContain("Namecheap");
    expect(container.textContent).toContain("2 accounts");
    expect(container.textContent).toContain("1 in progress");

    await click(buttonByText(container, "GitHub"));
    await flush(2);
    expect(container.textContent).toContain("Edit GitHub");
    expect(fetchCalls.some((c) => c.url === "/api/forge/platform/external-accounts/acc-1")).toBe(
      true,
    );
  });

  it("creates an account and shows the plain-words confirmation", async () => {
    const { container } = await renderPanel();
    await click(buttonByText(container, "Add account"));
    await flush(1);

    await setValue(inputByLabel(container, "Provider name"), "New Co");
    await setValue(inputByLabel(container, "Purpose"), "Testing");
    const submit = container.querySelector('form button[type="submit"]');
    await act(async () => {
      submit.closest("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    await flush(2);
    expect(container.textContent).toContain("Saved New Co.");
    const createCall = fetchCalls.find(
      (c) => c.url === "/api/forge/platform/external-accounts" && c.method === "POST",
    );
    expect(createCall).toBeDefined();
    expect(JSON.parse(createCall.body).payload.provider_name).toBe("New Co");
  });

  it("delete asks first and names the provider", async () => {
    const { container } = await renderPanel();
    await click(buttonByText(container, "GitHub"));
    await flush(2);
    await click(buttonByText(container, "Delete GitHub"));
    await flush(1);
    expect(container.textContent).toContain("Delete GitHub?");
    expect(buttonByText(container, "Yes, delete GitHub")).toBeDefined();
    // Nothing deleted yet — the confirm has not been tapped.
    expect(
      fetchCalls.some((c) => c.method === "DELETE"),
    ).toBe(false);
  });

  it("seed preview shows counts and makes no apply call", async () => {
    const { container } = await renderPanel();
    await click(buttonByText(container, "Preview seed"));
    await flush(2);
    expect(container.textContent).toContain("137 to add");
    expect(container.textContent).toContain("2 already there");
    expect(
      fetchCalls.some(
        (c) =>
          c.url === "/api/forge/platform/external-accounts/seed" &&
          JSON.parse(c.body ?? "{}").action === "apply",
      ),
    ).toBe(false);
  });

  it("search filters the list", async () => {
    const { container } = await renderPanel();
    await setValue(inputByLabel(container, "Search"), "namecheap");
    await flush(1);
    expect(container.textContent).toContain("Namecheap");
    expect(container.textContent).not.toContain("GitHub");
  });
});
