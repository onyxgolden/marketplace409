// @vitest-environment jsdom

// Object library: the four TEMA categories grouped under one heading.

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import ObjectLibraryPanel from "./ObjectLibraryPanel";
import "@/domains/roomDesigner/processEquipmentCatalog";
import "@/components/designer/symbolDrawRoutines";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("ObjectLibraryPanel — TEMA category group", () => {
  let container;
  let root;
  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("groups the TEMA categories in an optgroup and leaves the rest ungrouped", async () => {
    await act(async () => {
      root.render(<ObjectLibraryPanel dispatch={() => {}} pendingCatalogId={null} pendingSymbol={null} initialDomain="processEquipment" />);
    });
    const select = container.querySelector('select[aria-label="Object category"]');
    const groups = [...select.querySelectorAll("optgroup")];
    expect(groups.map((g) => g.label)).toEqual(["TEMA heat exchangers"]);
    expect([...groups[0].querySelectorAll("option")].map((o) => o.value)).toEqual([
      "TEMA exchangers", "TEMA front heads", "TEMA shells", "TEMA rear heads",
    ]);
    const ungrouped = [...select.children].filter((c) => c.tagName === "OPTION").map((o) => o.value);
    expect(ungrouped[0]).toBe("Pumps");
    expect(ungrouped).toHaveLength(13); // 12 process categories + Structures (racks)
    expect(ungrouped).toContain("Structures");
  });

  it("lists the TEMA front heads when that category is chosen", async () => {
    const dispatch = vi.fn();
    await act(async () => {
      root.render(<ObjectLibraryPanel dispatch={dispatch} pendingCatalogId={null} pendingSymbol={null} initialDomain="processEquipment" />);
    });
    const select = container.querySelector('select[aria-label="Object category"]');
    await act(async () => {
      select.value = "TEMA front heads";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const items = [...container.querySelectorAll('button[role="option"]')];
    expect(items).toHaveLength(5);
    await act(async () => items[0].dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(dispatch).toHaveBeenCalledWith({ type: "SET_PENDING_SYMBOL", domain: "processEquipment", symbolId: "tema-front-a" });
  });
});
