/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The Add Expense form is stubbed: it posts on submit, which this file never exercises.
// The stub marker also lets us assert the form never appears inside the full-screen dialog.
vi.mock("./ManualFinancialEventForm", () => ({
  default: () => <div data-manual-form-stub="true" />,
}));

import PropertyExpenseHistory from "./PropertyExpenseHistory";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ledger = {
  totalCents: 125000,
  suppressedDuplicateCount: 0,
  entries: [{
    id: "exp_1", date: "2026-09-01", vendor: "Acme Roofing", category: "repairs",
    source: "manual", sourceLabel: "Manual entry", method: "bank_transfer",
    reference: "INV-101", amountCents: 125000,
  }],
};

const PROPERTY_ID = "fullscreen-test-prop";

async function flushPromises() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function expandButton(container) {
  return container.querySelector('button[aria-label="Expand expense history to full screen"]');
}

function expandedDialog(container) {
  return container.querySelector('[data-expense-history-expanded][data-fullscreen="true"]');
}

describe("PropertyExpenseHistory full-screen expand", () => {
  let container;
  let root;

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      if (String(url).startsWith("/api/rental/property-expenses")) {
        return { ok: true, json: async () => ({ ledger }) };
      }
      throw new Error(`unexpected fetch: ${url}`);
    }));
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  async function renderCard() {
    await act(async () => {
      root.render(<PropertyExpenseHistory propertyId={PROPERTY_ID} propertyLabel="Test Prop" />);
    });
    await flushPromises();
  }

  async function clickExpand() {
    await act(async () => {
      expandButton(container).click();
    });
  }

  it("shows a visible Expand control in the card header", async () => {
    await renderCard();
    const button = expandButton(container);
    expect(button).not.toBeNull();
    // ⛶-style icon (inline SVG, never an emoji) plus a text label for wider screens.
    expect(button.querySelector("svg")).not.toBeNull();
    expect(button.textContent).toContain("Expand");
    expect(expandedDialog(container)).toBeNull();
  });

  it("opens the genuinely full-screen dialog from the Expand control", async () => {
    await renderCard();
    await clickExpand();
    const dialog = expandedDialog(container);
    expect(dialog).not.toBeNull();
    expect(dialog.getAttribute("role")).toBe("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.className).toContain("fixed inset-0");
    // Full-bleed: no centered max-width panel, no side padding on the frame.
    expect(dialog.className).not.toContain("max-w-");
    expect(dialog.querySelector("table")).not.toBeNull();
    expect(dialog.textContent).toContain("Acme Roofing");
    expect(dialog.textContent).toContain("$1,250.00");
    // Focus moves into the dialog on open (the Close control).
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Close expanded expense history");
    // Read-only view: the Add Expense form stays on the inline card.
    expect(dialog.querySelector('[data-manual-form-stub="true"]')).toBeNull();
  });

  it("dismisses the dialog with the Close button", async () => {
    await renderCard();
    await clickExpand();
    expect(expandedDialog(container)).not.toBeNull();
    const close = container.querySelector('[data-expense-history-expanded] button[aria-label="Close expanded expense history"]');
    await act(async () => {
      close.click();
    });
    expect(expandedDialog(container)).toBeNull();
  });

  it("dismisses the dialog on Escape", async () => {
    await renderCard();
    await clickExpand();
    expect(expandedDialog(container)).not.toBeNull();
    await act(async () => {
      window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(expandedDialog(container)).toBeNull();
  });

  it("right-clicking the card still opens the expanded view", async () => {
    await renderCard();
    const section = container.querySelector("section[data-property-expense-history]");
    await act(async () => {
      section.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 60, clientY: 60 }));
    });
    const menuItem = container.querySelector('[role="menuitem"]');
    expect(menuItem).not.toBeNull();
    expect(menuItem.textContent).toBe("Expand expense history");
    await act(async () => {
      menuItem.click();
    });
    expect(expandedDialog(container)).not.toBeNull();
  });
});
