// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import ApplicationsPanel from "./ApplicationsPanel";

// Controls-sweep follow-up G21 (O-11): paper entry + finality paths.
const ANSWERS = { personal: { firstName: "Dana", lastName: "Denied", email: "dana@example.com", phone: "555-2" } };
const PENDING_APP = { id: "app_p", status: "pending", answers: { personal: { firstName: "Pam", lastName: "Pending", email: "pam@example.com" } }, submittedAt: "2026-10-20T00:00:00Z", listing: { title: "Unit A" } };
const DENIED_APP = { id: "app_d", status: "denied", answers: ANSWERS, submittedAt: "2026-10-18T00:00:00Z", listing: { title: "Unit A" } };
const APPROVED_APP = { id: "app_a", status: "approved", answers: { personal: { firstName: "Ann", lastName: "Approved", email: "ann@example.com" } }, submittedAt: "2026-10-15T00:00:00Z", listing: { title: "Unit A" } };
const LISTINGS = [{ id: "listing_1", title: "Unit A", status: "published" }];

function detailFor(app) {
  return {
    application: app,
    listing: { id: "listing_1", title: "Unit A", rentCents: 185000 },
    form: null,
    decisions: app.status === "denied"
      ? [{ id: "dec_1", action: "denied", reason: "Low income", created_at: "2026-10-19T00:00:00Z" }]
      : [],
  };
}

async function flush(times = 10) {
  for (let i = 0; i < times; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
function click(el) { act(() => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); }); }
function buttonWithText(root, text) {
  return [...root.querySelectorAll("button")].find((b) => b.textContent.includes(text));
}
function setValue(el, value) {
  const proto = el instanceof window.HTMLSelectElement ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
  act(() => { setter.call(el, value); el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); });
}

describe("ApplicationsPanel follow-up G21", () => {
  let container;
  let root;
  let posts;

  async function renderPanel() {
    posts = [];
    vi.stubGlobal("fetch", async (url, options = {}) => {
      if (options.method === "POST") {
        const body = JSON.parse(options.body || "{}");
        posts.push({ url: String(url), body });
        return { ok: true, json: async () => ({ success: true, application: { id: "app_x", status: "pending" } }) };
      }
      if (String(url).startsWith("/api/rental/applications/")) {
        const id = decodeURIComponent(String(url).split("/").pop());
        const app = { app_p: PENDING_APP, app_d: DENIED_APP, app_a: APPROVED_APP }[id];
        return { ok: true, json: async () => detailFor(app) };
      }
      if (String(url).startsWith("/api/rental/applications")) {
        const status = new URL(url, "https://t/").searchParams.get("status");
        const list = status === "denied" ? [DENIED_APP] : status === "approved" ? [APPROVED_APP] : [PENDING_APP];
        return { ok: true, json: async () => ({ applications: list }) };
      }
      if (String(url).startsWith("/api/rental/listings")) return { ok: true, json: async () => ({ listings: LISTINGS }) };
      return { ok: true, json: async () => ({}) };
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => { root.render(<ApplicationsPanel />); });
    await flush();
  }

  async function openDetailFor(name) {
    click(buttonWithText(container, name));
    await flush();
  }

  afterEach(() => {
    if (root) act(() => root.unmount());
    container?.remove();
    container = null;
    root = null;
    vi.unstubAllGlobals();
  });

  it("O-11: paper entry posts the listing + applicant answers and confirms", async () => {
    await renderPanel();
    click(buttonWithText(container, "Enter a paper application"));
    await flush();
    const form = container.querySelector("form");
    expect(form.textContent).toContain("Unit A");
    setValue(form.querySelector("select"), "listing_1");
    // Text inputs in DOM order: first name, last name, phone.
    const textInputs = [...form.querySelectorAll("input")].filter((i) => i.type === "text" || i.type === "");
    setValue(textInputs[0], "Pat");
    setValue(textInputs[1], "Paper");
    setValue([...form.querySelectorAll("input")].find((i) => i.type === "email"), "pat@example.com");
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await flush();
    const created = posts.find((p) => p.url === "/api/rental/applications");
    expect(created).toBeTruthy();
    expect(created.body.listingId).toBe("listing_1");
    expect(created.body.answers.personal.firstName).toBe("Pat");
    expect(container.textContent).toContain("Paper application entered");
  });

  it("O-11: denied detail reopens; approved detail states finality with no reopen/delete", async () => {
    await renderPanel();
    click(buttonWithText(container, "Denied"));
    await flush();
    await openDetailFor("Dana Denied");
    expect(buttonWithText(container, "Reopen application")).toBeTruthy();
    expect(container.textContent).toContain("cannot be deleted — reopen it to review again");
    click(buttonWithText(container, "Reopen application"));
    await flush();
    expect(posts.find((p) => p.url.endsWith("/manage") && p.body.action === "reopen")).toBeTruthy();
    expect(container.textContent).toContain("Application reopened");

    click(buttonWithText(container, "Approved"));
    await flush();
    await openDetailFor("Ann Approved");
    expect(container.textContent).toContain("cannot be reopened or deleted here");
    expect(buttonWithText(container, "Reopen application")).toBeFalsy();
    expect(buttonWithText(container, "Delete application")).toBeFalsy();
  });

  it("O-11: pending detail deletes with confirmation", async () => {
    await renderPanel();
    await openDetailFor("Pam Pending");
    click(buttonWithText(container, "Delete application"));
    await flush();
    expect(container.textContent).toContain("Spam and duplicates only");
    click(buttonWithText(container, "Yes, delete"));
    await flush();
    expect(posts.find((p) => p.url.endsWith("/manage") && p.body.action === "delete")).toBeTruthy();
    expect(container.textContent).toContain("Application deleted.");
  });
});
