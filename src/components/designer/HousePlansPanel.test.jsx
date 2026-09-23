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
    expect(container.textContent).toContain("Sources by topic");
    expect(container.textContent).toContain("No suggestions yet.");
    await clickTab("Browse");
    await flushFetch();
    expect(container.textContent).toContain("The reference library is empty for now.");
    await clickTab("Search");
    // HP-L6: search is live client-side filtering over the loaded index.
    const searchInput = container.querySelector('input[type="search"]');
    expect(searchInput.disabled).toBe(false);
    expect(container.textContent).toContain("Search references");
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

  const REFERENCES_URL = "/api/forge/designer/house-plans/references";
  const referencesCalls = (fetchMock) =>
    fetchMock.mock.calls.filter(([url]) => url === REFERENCES_URL);

  it("does not fetch the reference library until a tab that needs it opens", async () => {
    const fetchMock = mockFetchReferences([]);
    await renderPanel();
    // HP-L6: the Project tab (default) loads the snapshots list on open —
    // the references endpoint itself still stays unfetched.
    expect(referencesCalls(fetchMock)).toHaveLength(0);
    await clickTab("Project");
    expect(referencesCalls(fetchMock)).toHaveLength(0);
    await clickTab("Browse");
    await flushFetch();
    expect(referencesCalls(fetchMock)).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith(REFERENCES_URL);
  });

  it("fetches the reference library once even when the Browse tab is reopened", async () => {
    const fetchMock = mockFetchReferences([]);
    await renderPanel();
    expect(referencesCalls(fetchMock)).toHaveLength(0);
    await clickTab("Browse");
    await flushFetch();
    expect(referencesCalls(fetchMock)).toHaveLength(1);
    await clickTab("Project");
    await clickTab("Browse");
    await flushFetch();
    expect(referencesCalls(fetchMock)).toHaveLength(1);
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

describe("HousePlansPanel (HP-L6)", () => {
  let container;
  let root;

  const REFERENCES_URL = "/api/forge/designer/house-plans/references";
  const SNAPSHOTS_URL = "/api/forge/designer/house-plans/snapshots";

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

  const mockHousePlansApi = ({ references = [], snapshots = [] } = {}) => {
    const fetchMock = vi.fn(async (url, init) => {
      if (url === SNAPSHOTS_URL && init?.method === "POST") {
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, created: true, snapshot: { id: "s-new" } }),
        };
      }
      if (url === SNAPSHOTS_URL) {
        return { ok: true, status: 200, json: async () => ({ success: true, snapshots }) };
      }
      return { ok: true, status: 200, json: async () => ({ success: true, references }) };
    });
    globalThis.fetch = fetchMock;
    return fetchMock;
  };

  const writeDraft = (projectId, symbols) => {
    localStorage.setItem(
      `forge-designer-draft:${projectId}`,
      JSON.stringify({
        schemaVersion: 1,
        designRevision: 3,
        envelope: { levels: [{ id: "L01", design: { symbols } }] },
      })
    );
  };

  const statuteRef = {
    id: "tx-statute",
    title: "Texas Local Government Code — Chapter 214",
    sectionIdentifier: "§214.212",
    issuingAuthority: "Texas Legislature",
    jurisdiction: "Texas",
    edition: null,
    effectiveDate: null,
    officialUrl: "https://statutes.capitol.texas.gov/Docs/LG/htm/LG.214.htm",
    topicTags: ["building-codes", "municipal-authority"],
    provenance: "Official site of the Texas Legislature",
    retrievalDate: "2026-09-23",
    verificationDate: "2026-09-23",
    jurisdictionState: "VERIFIED_SOURCE",
  };

  const agencyRef = {
    id: "tx-agency",
    title: "What you need to know about windstorm inspections",
    sectionIdentifier: null,
    issuingAuthority: "Texas Department of Insurance",
    jurisdiction: "Texas",
    edition: null,
    effectiveDate: null,
    officialUrl: "https://tdi.texas.gov/tips/need-windstorm-inspection.html",
    topicTags: ["windstorm", "inspections"],
    provenance: "Texas Department of Insurance",
    retrievalDate: "2026-09-23",
    verificationDate: "2026-09-23",
    jurisdictionState: "VERIFIED_SOURCE",
  };

  const municipalRef = {
    id: "tx-municipal",
    title: "Building Codes — City of Beaumont",
    sectionIdentifier: null,
    issuingAuthority: "City of Beaumont",
    jurisdiction: "Beaumont, Texas",
    edition: null,
    effectiveDate: null,
    officialUrl: "https://beaumonttexas.gov/707/Building-Codes",
    topicTags: ["building-codes", "permits", "inspections"],
    provenance: "City of Beaumont",
    retrievalDate: "2026-09-23",
    verificationDate: "2026-09-23",
    jurisdictionState: "VERIFIED_SOURCE",
  };

  const windowRef = {
    id: "tx-windows",
    title: "TDI Product Evaluations index",
    sectionIdentifier: null,
    issuingAuthority: "Texas Department of Insurance",
    jurisdiction: "Texas",
    edition: null,
    effectiveDate: null,
    officialUrl: "https://tdi.texas.gov/wind/prod/index.html",
    topicTags: ["windstorm", "windows", "doors"],
    provenance: "Texas Department of Insurance",
    retrievalDate: "2026-09-23",
    verificationDate: "2026-09-23",
    jurisdictionState: "VERIFIED_SOURCE",
  };

  const otherRef = {
    id: "other",
    title: "Unlisted Reference",
    sectionIdentifier: null,
    issuingAuthority: "Some Authority",
    jurisdiction: "Texas",
    edition: null,
    effectiveDate: null,
    officialUrl: "https://example.gov/other",
    topicTags: ["landscaping"],
    provenance: null,
    retrievalDate: null,
    verificationDate: null,
    jurisdictionState: "UNRESOLVED",
  };

  const ALL_REFS = [statuteRef, agencyRef, municipalRef, windowRef, otherRef];

  const FORBIDDEN_PHRASES = [
    "Applicable sources",
    "Required references",
    "Compliance checklist",
    "Code violations",
    "Missing requirements",
  ];

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    localStorage.clear();
    mockHousePlansApi({ references: ALL_REFS, snapshots: [] });
  });

  afterEach(async () => {
    globalThis.fetch = ORIGINAL_FETCH;
    await act(async () => root.unmount());
    container.remove();
  });

  it("never uses forbidden requirement language on any tab", async () => {
    writeDraft("proj-1", [{ domain: "buildingElements", symbolId: "window_double_hung" }]);
    await renderPanel({ projectId: "proj-1" });
    await flushFetch();
    for (const tab of ["Project", "Suggested", "Browse", "Search", "Saved"]) {
      await clickTab(tab);
      await flushFetch();
      const text = container.textContent;
      for (const phrase of FORBIDDEN_PHRASES) {
        expect(text).not.toContain(phrase);
      }
    }
    // And the positive, review-sanctioned language is used instead.
    await clickTab("Suggested");
    expect(container.textContent).toContain("Sources by topic");
  });

  it("Suggested matches placed entities to reference topic tags (entity → topic)", async () => {
    writeDraft("proj-1", [
      { domain: "buildingElements", symbolId: "window_double_hung" },
      { domain: "furniture", symbolId: "toilet" },
    ]);
    await renderPanel({ projectId: "proj-1" });
    await clickTab("Suggested");
    await flushFetch();

    const text = container.textContent;
    // window_double_hung → windows matches the TDI product-evaluations index.
    expect(text).toContain("TDI Product Evaluations index");
    // toilet → plumbing/residential-code matches nothing in ALL_REFS; no
    // invented suggestions, and non-matching refs stay out.
    expect(text).not.toContain("Unlisted Reference");
    expect(text).not.toContain("Building Codes — City of Beaumont");
  });

  it("Suggested shows matches for plumbing fixtures by topic", async () => {
    const plumbingRef = {
      ...otherRef,
      id: "plumbing-ref",
      title: "Plumbing Reference",
      officialUrl: "https://example.gov/plumbing",
      topicTags: ["plumbing"],
    };
    mockHousePlansApi({ references: [...ALL_REFS, plumbingRef], snapshots: [] });
    writeDraft("proj-1", [{ domain: "furniture", symbolId: "toilet" }]);
    await renderPanel({ projectId: "proj-1" });
    await clickTab("Suggested");
    await flushFetch();

    const text = container.textContent;
    expect(text).toContain("Plumbing Reference");
    // landscaping reference does not intersect toilet topics.
    expect(text).not.toContain("Unlisted Reference");
  });

  it("Suggested shows an honest empty state when nothing is placed", async () => {
    writeDraft("proj-1", []);
    await renderPanel({ projectId: "proj-1" });
    await clickTab("Suggested");
    await flushFetch();
    expect(container.textContent).toContain("No suggestions yet.");
  });

  it("Suggested shows an honest state with no connected project", async () => {
    await renderPanel();
    await clickTab("Suggested");
    await flushFetch();
    expect(container.textContent).toContain("No project connected.");
  });

  it("Search filters the index client-side by title, authority, and topic", async () => {
    await renderPanel();
    await clickTab("Search");
    await flushFetch();
    expect(container.textContent).toContain("TDI Product Evaluations index");

    const input = container.querySelector('input[type="search"]');
    await act(async () => {
      input.focus();
      // React onChange via native setter.
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value"
      ).set;
      setter.call(input, "windstorm");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // input event may not trigger React's onChange; also try change.
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const text = container.textContent;
    expect(text).toContain("TDI Product Evaluations index");
    expect(text).not.toContain("Building Codes — City of Beaumont");
  });

  it("Saved bookmarks persist per project in localStorage", async () => {
    await renderPanel({ projectId: "proj-1" });
    await clickTab("Browse");
    await flushFetch();

    const bookmarkButtons = [...container.querySelectorAll('[aria-label="Bookmark this reference"]')];
    expect(bookmarkButtons.length).toBeGreaterThan(0);
    await act(async () => {
      bookmarkButtons[0].click();
    });
    expect(JSON.parse(localStorage.getItem("forge-house-plans-bookmarks:proj-1"))).toEqual([
      "tx-statute",
    ]);

    await clickTab("Saved");
    await flushFetch();
    expect(container.textContent).toContain("Texas Local Government Code — Chapter 214");
    expect(container.textContent).not.toContain("Nothing saved yet.");
  });

  it("Saved shows an honest empty state and stays project-isolated", async () => {
    await renderPanel({ projectId: "proj-1" });
    await clickTab("Saved");
    await flushFetch();
    expect(container.textContent).toContain("Nothing saved yet.");

    // A bookmark under another project does not leak in.
    localStorage.setItem("forge-house-plans-bookmarks:proj-2", JSON.stringify(["tx-statute"]));
    await clickTab("Project");
    await clickTab("Saved");
    await flushFetch();
    expect(container.textContent).toContain("Nothing saved yet.");
  });

  it("Project shows jurisdiction facts and the snapshot count", async () => {
    const snapshots = [
      {
        id: "snap-1",
        label: "Texas references — 2026-09-23",
        sourceCount: 7,
        capturedAt: "2026-09-23T10:00:00Z",
      },
    ];
    mockHousePlansApi({ references: ALL_REFS, snapshots });
    const jurisdiction = {
      jurisdictionState: "VERIFIED_SOURCE",
      provenance: "U.S. Census Geocoder",
      geography: {
        place: { name: "Beaumont city" },
        county: { name: "Jefferson County" },
        state: { name: "Texas" },
      },
    };
    await renderPanel({ projectId: "proj-1", jurisdiction });
    await flushFetch();

    const text = container.textContent;
    expect(text).toContain("Beaumont city, Jefferson County, Texas");
    expect(text).toContain("Status: VERIFIED_SOURCE");
    expect(text).toContain("1 pinned snapshot");
    expect(text).toContain("Texas references — 2026-09-23");
    expect(text).toContain("7 sources");
    // Pin control is present.
    expect(container.textContent).toContain("Pin current library");
  });

  it("Project pin control posts a snapshot and reports the result", async () => {
    const fetchMock = mockHousePlansApi({ references: ALL_REFS, snapshots: [] });
    await renderPanel({ projectId: "proj-1" });
    await flushFetch();

    const pinButton = [...container.querySelectorAll("button")].find((b) =>
      b.textContent.includes("Pin current library")
    );
    await act(async () => {
      pinButton.click();
    });
    await flushFetch();

    expect(
      fetchMock.mock.calls.some(
        ([url, init]) => url === SNAPSHOTS_URL && init?.method === "POST"
      )
    ).toBe(true);
    expect(container.textContent).toContain("Snapshot pinned.");
  });

  it("Reference cards show source-type badges from the curated seed only", async () => {
    await renderPanel({ projectId: "proj-1" });
    await clickTab("Browse");
    await flushFetch();

    const text = container.textContent;
    expect(text).toContain("Statute");
    expect(text).toContain("Agency resource");
    expect(text).toContain("Municipal reference");
    // The unlisted URL gets no badge — count badge elements directly.
    const badges = [...container.querySelectorAll("span")].filter((s) =>
      ["Statute", "Agency resource", "Municipal reference"].includes(s.textContent)
    );
    expect(badges).toHaveLength(4); // four seed references
  });
});
