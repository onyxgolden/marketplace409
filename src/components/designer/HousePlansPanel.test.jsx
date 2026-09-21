// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import HousePlansPanel, {
  HOUSE_PLANS_DISCLAIMER,
  HOUSE_PLANS_FIRST_USE,
} from "./HousePlansPanel";

const EXPECTED_TABS = ["Project", "Suggested", "Browse", "Search", "Saved"];

// HP-L2: the Browse tab fetches the live reference library. Flush pending
// fetch promises so assertions run against the settled UI.
const flushFetch = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

const ORIGINAL_FETCH = globalThis.fetch;

const mockFetchReferences = (references) => {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ success: true, references }),
  }));
  globalThis.fetch = fetchMock;
  return fetchMock;
};

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
    // HP-L2: Browse tab fetches the live reference library; default to an
    // empty library so the shell tests stay deterministic.
    mockFetchReferences([]);
  });

  afterEach(async () => {
    globalThis.fetch = ORIGINAL_FETCH;
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
    await flushFetch();
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

describe("HousePlansPanel Browse tab (HP-L2)", () => {
  let container;
  let root;

  const renderPanel = async (props = {}) => {
    await act(async () => {
      root.render(<HousePlansPanel {...props} />);
    });
  };

  const clickTab = async (label) => {
    const tab = [...container.querySelectorAll('[role="tab"]')].find(
      (t) => t.textContent === label
    );
    await act(async () => {
      tab.click();
    });
  };

  const fullReference = {
    id: "r1",
    title: "Sample Building Reference",
    sectionIdentifier: "SEC-101.4",
    issuingAuthority: "Sample Building Authority",
    jurisdiction: "Texas",
    edition: "2024",
    effectiveDate: "2024-01-01",
    officialUrl: "https://example.gov/sample-101",
    topicTags: ["stairs", "egress"],
    provenance: "curated",
    retrievalDate: "2026-09-21",
    verificationDate: "2026-09-21",
    jurisdictionState: "VERIFIED_SOURCE",
  };

  const minimalReference = {
    id: "r2",
    title: "Minimal Reference",
    sectionIdentifier: null,
    issuingAuthority: "Another Authority",
    jurisdiction: null,
    edition: null,
    effectiveDate: null,
    officialUrl: "https://example.gov/minimal",
    topicTags: [],
    provenance: null,
    retrievalDate: null,
    verificationDate: null,
    jurisdictionState: "UNRESOLVED",
  };

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    globalThis.fetch = ORIGINAL_FETCH;
    await act(async () => root.unmount());
    container.remove();
  });

  it("does not fetch the reference library until the Browse tab opens", async () => {
    const fetchMock = mockFetchReferences([]);
    await renderPanel();
    expect(fetchMock).not.toHaveBeenCalled();
    await clickTab("Project");
    expect(fetchMock).not.toHaveBeenCalled();
    await clickTab("Browse");
    await flushFetch();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/forge/designer/house-plans/references");
  });

  it("fetches the reference library once even when the Browse tab is reopened", async () => {
    const fetchMock = mockFetchReferences([]);
    await renderPanel();
    expect(fetchMock).not.toHaveBeenCalled();
    await clickTab("Browse");
    await flushFetch();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await clickTab("Project");
    await clickTab("Browse");
    await flushFetch();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("renders the reference list with factual metadata and official links", async () => {
    mockFetchReferences([fullReference, minimalReference]);
    await renderPanel();
    await clickTab("Browse");
    await flushFetch();

    const text = container.textContent;
    expect(text).toContain("Sample Building Reference");
    expect(text).toContain("Section SEC-101.4");
    expect(text).toContain("Sample Building Authority");
    expect(text).toContain("Texas");
    expect(text).toContain("2024 edition");
    expect(text).toContain("Effective 2024-01-01");
    expect(text).toContain("stairs");
    expect(text).toContain("Minimal Reference");
    expect(text).toContain("Jurisdiction status: VERIFIED_SOURCE");
    expect(text).toContain("Jurisdiction status: UNRESOLVED");

    const links = [...container.querySelectorAll("a")];
    const officialLinks = links.filter((a) => a.textContent.includes("Official source"));
    expect(officialLinks).toHaveLength(2);
    expect(officialLinks[0].getAttribute("href")).toBe("https://example.gov/sample-101");
    expect(officialLinks[0].getAttribute("target")).toBe("_blank");
    expect(officialLinks[0].getAttribute("rel")).toBe("noopener noreferrer");

    // Reference-only language: no findings, no check vocabulary.
    expect(text).not.toMatch(/\bPASS\b/);
    expect(text).not.toMatch(/\bFAIL\b/);
    expect(text.toLowerCase()).not.toContain("code check");
    expect(text.toLowerCase()).not.toContain("compliant");
    expect(text).toContain(HOUSE_PLANS_DISCLAIMER);
  });

  it("shows the honest empty state when the library is empty", async () => {
    mockFetchReferences([]);
    await renderPanel();
    await clickTab("Browse");
    await flushFetch();
    expect(container.textContent).toContain("The reference library is empty for now.");
    expect(container.querySelectorAll("a")).toHaveLength(0);
  });

  it("shows an honest error state when the library cannot load", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("network down");
    });
    await renderPanel();
    await clickTab("Browse");
    await flushFetch();
    const text = container.textContent;
    expect(text).toContain("Couldn't load the reference library.");
    // No invented entries, no placeholder links.
    expect(text).not.toContain("Sample Building Reference");
    expect(container.querySelectorAll("a")).toHaveLength(0);
  });
});
