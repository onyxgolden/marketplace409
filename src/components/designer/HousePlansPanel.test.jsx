// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import HousePlansPanel, {
  HOUSE_PLANS_DISCLAIMER,
  HOUSE_PLANS_FIRST_USE,
} from "./HousePlansPanel";

const EXPECTED_TABS = ["Project", "Suggested", "Browse", "Search", "Saved"];

describe("HousePlansPanel (HP-L0)", () => {
  let container;
  let root;

  const renderPanel = async (props = {}) => {
    await act(async () => {
      root.render(<HousePlansPanel {...props} />);
    });
  };

  const tabLabels = () =>
    [...container.querySelectorAll('[role="tab"]')].map((t) => t.textContent);

  const clickTab = async (label) => {
    const tab = [...container.querySelectorAll('[role="tab"]')].find(
      (t) => t.textContent === label
    );
    await act(async () => {
      tab.click();
    });
  };

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("renders the five HP-L0 tabs and no Hazards tab (HP-L10)", async () => {
    await renderPanel();
    expect(tabLabels()).toEqual(EXPECTED_TABS);
    expect(container.textContent).not.toContain("Hazards");
  });

  it("shows the exact persistent reference-only disclaimer", async () => {
    await renderPanel();
    expect(HOUSE_PLANS_DISCLAIMER).toBe(
      "REFERENCE LIBRARY — NOT A COMPLIANCE DETERMINATION. Verify requirements with the applicable authority and qualified professionals."
    );
    expect(container.textContent).toContain(HOUSE_PLANS_DISCLAIMER);
    // Disclaimer stays visible on every tab.
    await clickTab("Saved");
    expect(container.textContent).toContain(HOUSE_PLANS_DISCLAIMER);
  });

  it("shows the exact first-use statement and lets the user dismiss it", async () => {
    await renderPanel();
    expect(HOUSE_PLANS_FIRST_USE).toBe(
      "HOUSE PLANS organizes regulatory resources and selected factual public-data references. FORGE does not interpret regulatory requirements, evaluate your design, or determine code compliance. Confirm jurisdiction and requirements with the appropriate authorities and professionals."
    );
    expect(container.textContent).toContain(HOUSE_PLANS_FIRST_USE);
    const dismiss = container.querySelector('[aria-label="Dismiss first-use notice"]');
    await act(async () => {
      dismiss.click();
    });
    expect(container.textContent).not.toContain(HOUSE_PLANS_FIRST_USE);
  });

  it("uses reference-only terminology, never check/compliance language", async () => {
    await renderPanel();
    const text = container.textContent;
    expect(text).toContain("Reference library");
    expect(text.toLowerCase()).not.toContain("code check");
    expect(text).not.toMatch(/\bPASS\b/);
    expect(text).not.toMatch(/\bFAIL\b/);
    expect(text).not.toContain("PASS/FAIL");
  });

  it("renders honest empty states with no fake data and no authority links", async () => {
    await renderPanel();
    // No placeholder links to real authorities anywhere in the L0 shell.
    expect(container.querySelectorAll("a")).toHaveLength(0);

    await clickTab("Project");
    expect(container.textContent).toContain("No project reference context yet.");
    await clickTab("Suggested");
    expect(container.textContent).toContain("Suggested References");
    expect(container.textContent).toContain("No suggestions yet.");
    await clickTab("Browse");
    expect(container.textContent).toContain("The reference library is empty for now.");
    await clickTab("Search");
    expect(container.textContent).toContain("Search over the reference index arrives in a later slice");
    const searchInput = container.querySelector('input[type="search"]');
    expect(searchInput.disabled).toBe(true);
    await clickTab("Saved");
    expect(container.textContent).toContain("Nothing saved yet.");
  });

  it("marks tabs with aria-selected and switches the active tab", async () => {
    await renderPanel();
    const selected = () =>
      [...container.querySelectorAll('[role="tab"][aria-selected="true"]')].map(
        (t) => t.textContent
      );
    expect(selected()).toEqual(["Project"]);
    await clickTab("Browse");
    expect(selected()).toEqual(["Browse"]);
  });

  it("fires onClose when the close button is clicked", async () => {
    const onClose = vi.fn();
    await renderPanel({ onClose });
    const close = container.querySelector('[aria-label="Close House Plans panel"]');
    await act(async () => {
      close.click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders without a close button when onClose is not provided", async () => {
    await renderPanel();
    expect(container.querySelector('[aria-label="Close House Plans panel"]')).toBeNull();
  });
});
