/** @vitest-environment jsdom */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import Tax1099Panel from "./Tax1099Panel";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("Tax1099Panel (R23)", () => {
  it("renders the Tax / 1099 shell with the compliance banner, tabs, and tax-year selector", () => {
    const markup = renderToStaticMarkup(<Tax1099Panel />);
    expect(markup).toContain("Tax / 1099");
    expect(markup).toContain("Not tax advice.");
    expect(markup).toContain("confirm with your CPA");
    expect(markup).toContain("Year summary");
    expect(markup).toContain("Recipients");
    expect(markup).toContain("Previews");
    expect(markup).toContain("Export");
    expect(markup).toContain("Filing status");
    expect(markup).toContain("E-filing partner");
    expect(markup).toContain("Tax year");
    expect(markup).toContain("Loading 1099 data…");
  });

  it("documents the e-file gate on the partner surface (not a dead button)", () => {
    const markup = renderToStaticMarkup(<Tax1099Panel initialTab="partner" />);
    expect(markup).toContain("E-file: not connected");
    expect(markup).toContain("export and file manually");
    expect(markup).toContain("What Jason would need to approve before e-filing goes live");
  });

  it("explains the 1099-NEC vs 1099-MISC split in plain English", () => {
    const markup = renderToStaticMarkup(<Tax1099Panel />);
    expect(markup).toContain("1099-NEC — Nonemployee compensation");
    expect(markup).toContain("1099-MISC — Rents");
  });
});

describe("Tax1099Panel owner-editor link isolation (R23 race fix)", () => {
  function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  }

  const OWNER_A = { id: "rec-a", kind: "owner", displayName: "Owner A", entityType: "individual", tinMasked: "***-**-1234", city: "Houston", state: "TX" };
  const OWNER_B = { id: "rec-b", kind: "owner", displayName: "Owner B", entityType: "individual", tinMasked: "***-**-5678", city: "Dallas", state: "TX" };
  const UNITS = [
    { id: "u1", property_id: "prop-1", label: "123 Main St", status: "active" },
    { id: "u2", property_id: "prop-2", label: "456 Oak Ave", status: "active" },
  ];

  let container;
  let root;
  let linkDeferreds;
  let linkFailures;

  function installFetch() {
    linkDeferreds = {};
    linkFailures = new Set();
    vi.stubGlobal("fetch", async (url) => {
      const propertiesMatch = String(url).match(/^\/api\/rental\/1099\/recipients\/([^/]+)\/properties$/);
      if (propertiesMatch) {
        const id = decodeURIComponent(propertiesMatch[1]);
        if (linkFailures.has(id)) {
          return { ok: false, json: async () => ({ error: "link service down" }) };
        }
        if (!linkDeferreds[id]) linkDeferreds[id] = deferred();
        const current = linkDeferreds[id];
        return {
          ok: true,
          json: async () => ({ propertyIds: await current.promise }),
        };
      }
      const bodies = {
        "/api/rental/1099/recipients": { recipients: [OWNER_A, OWNER_B] },
        "/api/rental/vendors": { vendors: [] },
        "/api/rental/1099/payer-profile": { profile: null },
        "/api/rental/1099/efile-status": { efile: null },
        "/api/rental": { units: UNITS },
        "/api/rental/1099/summary": { rows: [] },
      };
      const key = Object.keys(bodies).find((k) => String(url).startsWith(k));
      return { ok: true, json: async () => bodies[key] || {} };
    });
  }

  async function flush() {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  }

  async function renderRecipients() {
    await act(async () => {
      root.render(<Tax1099Panel initialTab="recipients" />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flush();
  }

  function editButtonFor(name) {
    const row = [...container.querySelectorAll("tbody tr")].find((tr) => tr.textContent.includes(name));
    expect(row, `row for ${name}`).toBeTruthy();
    return [...row.querySelectorAll("button")].find((button) => button.textContent === "Edit");
  }

  async function clickEdit(name) {
    await act(async () => {
      editButtonFor(name).dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flush();
  }

  function checkboxFor(labelText) {
    const label = [...container.querySelectorAll("fieldset label")].find((el) => el.textContent.includes(labelText));
    expect(label, `checkbox label for ${labelText}`).toBeTruthy();
    return label.querySelector('input[type="checkbox"]');
  }

  function saveButton() {
    return [...container.querySelectorAll("button")].find((button) => button.textContent === "Save recipient");
  }

  beforeEach(() => {
    installFetch();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    container.remove();
    vi.unstubAllGlobals();
  });

  it("a delayed response for owner A arriving after owner B's editor opened does not clobber B's fields", async () => {
    await renderRecipients();
    // Open A's editor; its link fetch stays pending.
    await clickEdit("Owner A");
    expect(container.textContent).toContain("Loading this owner's attributed properties");
    // Open B's editor and resolve B's links: B owns prop-2.
    await clickEdit("Owner B");
    linkDeferreds["rec-b"].resolve(["prop-2"]);
    await flush();
    expect(container.textContent).not.toContain("Loading this owner's attributed properties");
    expect(checkboxFor("123 Main St").checked).toBe(false);
    expect(checkboxFor("456 Oak Ave").checked).toBe(true);
    // A's delayed response arrives now — it must be ignored (B's editor stays).
    linkDeferreds["rec-a"].resolve(["prop-1"]);
    await flush();
    expect(container.textContent).toContain("Edit recipient");
    expect(checkboxFor("123 Main St").checked).toBe(false);
    expect(checkboxFor("456 Oak Ave").checked).toBe(true);
  });

  it("shows a loading state with the fields non-editable until the current owner's links arrive", async () => {
    await renderRecipients();
    await clickEdit("Owner A");
    expect(container.textContent).toContain("Loading this owner's attributed properties");
    expect(saveButton().disabled).toBe(true);
    linkDeferreds["rec-a"].resolve(["prop-1"]);
    await flush();
    expect(container.textContent).not.toContain("Loading this owner's attributed properties");
    expect(checkboxFor("123 Main St").checked).toBe(true);
    expect(saveButton().disabled).toBe(false);
  });

  it("shows an error with retry on link-load failure and never leaves stale data in the fields", async () => {
    await renderRecipients();
    linkFailures.add("rec-a");
    await clickEdit("Owner A");
    expect(container.textContent).toContain("Could not load this owner's attributed properties");
    expect(container.textContent).toContain("Try again");
    // No stale checkboxes from another owner; save stays disabled so the
    // failed load can never wipe existing attribution.
    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
    expect(saveButton().disabled).toBe(true);
    // Retry succeeds: the editor populates with A's real links.
    linkFailures.delete("rec-a");
    await act(async () => {
      [...container.querySelectorAll("button")].find((button) => button.textContent === "Try again")
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    linkDeferreds["rec-a"].resolve(["prop-2"]);
    await flush();
    expect(container.textContent).not.toContain("Could not load this owner's attributed properties");
    expect(checkboxFor("123 Main St").checked).toBe(false);
    expect(checkboxFor("456 Oak Ave").checked).toBe(true);
    expect(saveButton().disabled).toBe(false);
  });
});
describe("syncRecipientPropertyLinks (R23 CHANGES fix)", () => {
  it("POSTs newly selected properties and DELETEs deselected ones, leaving untouched links alone", async () => {
    const calls = [];
    const { vi } = await import("vitest");
    vi.stubGlobal("fetch", async (url, options = {}) => {
      calls.push({ url, method: options.method || "GET", body: options.body });
      return { ok: true, json: async () => ({ success: true }) };
    });
    try {
      const { syncRecipientPropertyLinks } = await import("./Tax1099Panel");
      const result = await syncRecipientPropertyLinks("rec-1", ["prop-a", "prop-b"], ["prop-b", "prop-c"]);
      expect(result).toEqual({ added: 1, removed: 1 });
      const posts = calls.filter((call) => call.method === "POST");
      const deletes = calls.filter((call) => call.method === "DELETE");
      expect(posts).toHaveLength(1);
      expect(posts[0].url).toBe("/api/rental/1099/recipients/rec-1/properties");
      expect(JSON.parse(posts[0].body)).toEqual({ propertyId: "prop-c" });
      expect(deletes).toHaveLength(1);
      expect(deletes[0].url).toBe("/api/rental/1099/recipients/rec-1/properties?propertyId=prop-a");
      // prop-b was untouched: no call mentions it
      expect(calls.some((call) => call.url.includes("prop-b") || String(call.body || "").includes("prop-b"))).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("makes no API calls when the selection is unchanged (edits preserve links)", async () => {
    const calls = [];
    const { vi } = await import("vitest");
    vi.stubGlobal("fetch", async () => {
      calls.push(1);
      return { ok: true, json: async () => ({ success: true }) };
    });
    try {
      const { syncRecipientPropertyLinks } = await import("./Tax1099Panel");
      const result = await syncRecipientPropertyLinks("rec-1", ["prop-a"], ["prop-a"]);
      expect(result).toEqual({ added: 0, removed: 0 });
      expect(calls).toHaveLength(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("surfaces a server failure instead of silently dropping the link change", async () => {
    const { vi } = await import("vitest");
    vi.stubGlobal("fetch", async () => ({ ok: false, json: async () => ({ error: "Unable to link the property." }) }));
    try {
      const { syncRecipientPropertyLinks } = await import("./Tax1099Panel");
      await expect(syncRecipientPropertyLinks("rec-1", [], ["prop-a"])).rejects.toThrow("Unable to link the property.");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
