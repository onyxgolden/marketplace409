// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RentalSetupWizardPanel, { readSetupWizardDismissal, SETUP_WIZARD_DISMISSAL_STORAGE_KEY } from "./RentalSetupWizardPanel";
import { buildSetupWizardStatus } from "@/application/rental/setupWizard";
import { clearSWRCache } from "../../../hooks/swrCache";

function wizardPayload(overrides = {}) {
  return {
    success: true,
    ...buildSetupWizardStatus({
      units: [], tenants: [], bankAccountCount: 0, settingsConfigured: false, members: [], ...overrides,
    }),
  };
}

function stubFetch(payload) {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => payload })));
}

function renderPanel(props = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  return { container, root };
}

async function flush() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

describe("RentalSetupWizardPanel", () => {
  let mounted;
  beforeEach(() => {
    clearSWRCache();
    window.localStorage.removeItem(SETUP_WIZARD_DISMISSAL_STORAGE_KEY);
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    if (mounted) {
      act(() => mounted.root.unmount());
      mounted.container.remove();
      mounted = null;
    }
    vi.unstubAllGlobals();
  });

  it("renders the six Rentec-ordered steps with why-order copy and honest progress", async () => {
    stubFetch(wizardPayload());
    mounted = renderPanel({ mode: "first-run" });
    act(() => mounted.root.render(<RentalSetupWizardPanel mode="first-run" onNavigate={() => {}} onExit={() => {}} />));
    await flush();
    const panel = mounted.container.querySelector("[data-setup-wizard-panel]");
    expect(panel).not.toBeNull();
    const steps = [...mounted.container.querySelectorAll("[data-setup-wizard-step]")];
    expect(steps.map((step) => step.getAttribute("data-setup-wizard-step"))).toEqual(
      ["settings", "banking", "owners", "managers", "properties", "tenants"],
    );
    // Plain-English why-order copy on the banking tile (Brandy-readable, no jargon).
    expect(mounted.container.textContent).toContain("so rent has somewhere to land");
    // Progress is derived from data: 0 of 4 required steps done on a fresh workspace.
    expect(mounted.container.textContent).toContain("0 of 4 required steps done");
    // Owners is optional-but-complete by definition; managers is optional and pending.
    expect(mounted.container.querySelector('[data-setup-wizard-step="owners"]').getAttribute("data-setup-wizard-step-status")).toBe("done");
    expect(mounted.container.querySelector('[data-setup-wizard-step="managers"]').getAttribute("data-setup-wizard-step-status")).toBe("optional");
    expect(mounted.container.querySelector('[data-setup-wizard-step="banking"]').getAttribute("data-setup-wizard-step-status")).toBe("todo");
  });

  it("shows the first-run welcome copy and skip control only in first-run mode", async () => {
    stubFetch(wizardPayload());
    mounted = renderPanel();
    act(() => mounted.root.render(<RentalSetupWizardPanel mode="first-run" onNavigate={() => {}} onExit={() => {}} />));
    await flush();
    expect(mounted.container.textContent).toContain("This takes about 10 minutes and you only do it once");
    expect(mounted.container.querySelector("[data-setup-wizard-skip]")).not.toBeNull();
    expect(mounted.container.querySelector("[data-setup-wizard-exit]")).toBeNull();
  });

  it("guide mode shows Back to Summary and no skip control", async () => {
    stubFetch(wizardPayload());
    const onExit = vi.fn();
    mounted = renderPanel();
    act(() => mounted.root.render(<RentalSetupWizardPanel mode="guide" onNavigate={() => {}} onExit={onExit} />));
    await flush();
    expect(mounted.container.textContent).not.toContain("This takes about 10 minutes");
    expect(mounted.container.querySelector("[data-setup-wizard-skip]")).toBeNull();
    const exit = mounted.container.querySelector("[data-setup-wizard-exit]");
    expect(exit).not.toBeNull();
    act(() => exit.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it("skip writes the dismissal and exits — the wizard never traps the user", async () => {
    stubFetch(wizardPayload());
    const onExit = vi.fn();
    expect(readSetupWizardDismissal()).toBe(false);
    mounted = renderPanel();
    act(() => mounted.root.render(<RentalSetupWizardPanel mode="first-run" onNavigate={() => {}} onExit={onExit} />));
    await flush();
    const skip = mounted.container.querySelector("[data-setup-wizard-skip]");
    act(() => skip.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(readSetupWizardDismissal()).toBe(true);
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it("deep-links step actions to the real surfaces: function buttons and external hrefs", async () => {
    stubFetch(wizardPayload());
    const onNavigate = vi.fn();
    mounted = renderPanel();
    act(() => mounted.root.render(<RentalSetupWizardPanel mode="guide" onNavigate={onNavigate} onExit={() => {}} />));
    await flush();
    // Banking tile's action navigates in-shell to the bank ledger.
    const bankingTile = mounted.container.querySelector('[data-setup-wizard-step="banking"]');
    const ledgerButton = [...bankingTile.querySelectorAll("button")].find((button) => button.textContent.includes("bank ledger"));
    act(() => ledgerButton.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onNavigate).toHaveBeenCalledWith("bank-ledger");
    // Owners tile's action is an external link to the workspace members surface.
    const ownersTile = mounted.container.querySelector('[data-setup-wizard-step="owners"]');
    const inviteLink = ownersTile.querySelector('a[href="/forge/workspace"]');
    expect(inviteLink).not.toBeNull();
    expect(inviteLink.textContent).toContain("Invite a co-owner");
  });

  it("marks steps done from data: a mid-setup workspace shows partial completion", async () => {
    stubFetch(wizardPayload({ settingsConfigured: true, bankAccountCount: 1, members: [{ role: "manager", status: "active" }] }));
    mounted = renderPanel();
    act(() => mounted.root.render(<RentalSetupWizardPanel mode="guide" onNavigate={() => {}} onExit={() => {}} />));
    await flush();
    expect(mounted.container.textContent).toContain("2 of 4 required steps done");
    expect(mounted.container.querySelector('[data-setup-wizard-step="settings"]').getAttribute("data-setup-wizard-step-status")).toBe("done");
    expect(mounted.container.querySelector('[data-setup-wizard-step="banking"]').getAttribute("data-setup-wizard-step-status")).toBe("done");
    expect(mounted.container.querySelector('[data-setup-wizard-step="managers"]').getAttribute("data-setup-wizard-step-status")).toBe("done");
    expect(mounted.container.querySelector('[data-setup-wizard-step="properties"]').getAttribute("data-setup-wizard-step-status")).toBe("todo");
  });

  it("renders an error state with retry when the status feed fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    mounted = renderPanel();
    act(() => mounted.root.render(<RentalSetupWizardPanel mode="guide" onNavigate={() => {}} onExit={() => {}} />));
    await flush();
    await flush();
    expect(mounted.container.textContent).toContain("Unable to load setup progress");
  });
});
