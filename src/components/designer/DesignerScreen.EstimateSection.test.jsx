// @vitest-environment jsdom

// EstimateSection: the HOME DESIGNER slice 4 estimate readout.
//
// Contract: one row per assembly with the live geometry quantity; unit-cost
// inputs commit integer cents on blur (invalid input is rejected, never
// committed; clearing returns the line to pending); the empty state promises
// no placeholder prices; "Print proposal" on a dirty project shows the
// unsaved-changes warning (print current / save and print / cancel) without
// blocking printing. A damaged project renders a status line, never a crash.

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { EstimateSection } from "./DesignerScreen";
import {
  createHomeProject,
  resetHomeProjectIds,
  updateLevelDesign,
} from "@/domains/roomDesigner/homeProject";
import { setUnitCost } from "@/domains/roomDesigner/homeEstimate";
import {
  addRoomFromTemplate,
  createEmptyDesign,
  resetDesignerIds,
} from "@/domains/roomDesigner/designerDocument";
import "@/domains/roomDesigner/pipingCatalog";

beforeEach(() => {
  resetDesignerIds();
  resetHomeProjectIds();
});

function bedroomProject(units = "ft") {
  let p = createHomeProject("Remodel", { units });
  let d = createEmptyDesign("Bedroom");
  d = addRoomFromTemplate(d, "bedroom", { x: 0, y: 0 }); // 12x12 = 144 sq ft
  p = updateLevelDesign(p, p.levels[0].id, () => d);
  return p;
}

describe("EstimateSection", () => {
  let container;
  let root;

  const renderSection = (props) => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(
        <EstimateSection
          project={null}
          design={null}
          dirty={false}
          onSetUnitCost={() => {}}
          onPrintProposal={() => {}}
          onSaveAndPrint={() => {}}
          {...props}
        />,
      );
    });
    return container;
  };

  const rerender = (props) => {
    act(() => {
      root.render(
        <EstimateSection
          project={null}
          design={null}
          dirty={false}
          onSetUnitCost={() => {}}
          onPrintProposal={() => {}}
          onSaveAndPrint={() => {}}
          {...props}
        />,
      );
    });
    return container;
  };

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const flooringInput = () =>
    container.querySelector('input[aria-label="Unit cost for Flooring ($/sq ft)"]');

  const blurInput = (input, value) => {
    input.value = value;
    // React 17+ delegates onBlur via native focusout (focus/blur don't bubble).
    act(() => {
      input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
  };

  it("renders one row per assembly with live geometry quantities", () => {
    const project = bedroomProject();
    const el = renderSection({ project, design: project.levels[0].design });
    const text = el.textContent;
    expect(text).toContain("Estimate");
    expect(text).toContain("Flooring");
    expect(text).toContain("Interior paint");
    expect(text).toContain("Baseboard trim");
    expect(text).toContain("126 sq ft"); // bedroom net room area (144 gross minus wall footprints)
  });

  it("shows the empty state when nothing is priced", () => {
    const project = bedroomProject();
    const el = renderSection({ project, design: project.levels[0].design });
    expect(el.textContent).toContain(
      "Nothing here is priced until you type a cost — no placeholder prices.",
    );
  });

  it("commits a unit cost as integer cents on blur", () => {
    const project = bedroomProject();
    const onSetUnitCost = vi.fn();
    renderSection({
      project,
      design: project.levels[0].design,
      onSetUnitCost,
    });
    blurInput(flooringInput(), "2.50");
    expect(onSetUnitCost).toHaveBeenCalledTimes(1);
    expect(onSetUnitCost).toHaveBeenCalledWith("flooring", 250);
  });

  it("rejects invalid input — never committed, value reverts", () => {
    const project = bedroomProject();
    const onSetUnitCost = vi.fn();
    renderSection({
      project,
      design: project.levels[0].design,
      onSetUnitCost,
    });
    blurInput(flooringInput(), "abc");
    expect(onSetUnitCost).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Enter a non-negative cost");
    expect(flooringInput().value).toBe("");
  });

  it("clearing the input clears the cost back to pending", () => {
    let project = setUnitCost(bedroomProject(), "flooring", 250);
    const onSetUnitCost = vi.fn();
    renderSection({
      project,
      design: project.levels[0].design,
      onSetUnitCost,
    });
    expect(flooringInput().value).toBe("2.50");
    blurInput(flooringInput(), "");
    expect(onSetUnitCost).toHaveBeenCalledWith("flooring", null);
  });

  it("shows extended cost and subtotal once a cost is set", () => {
    const project = setUnitCost(bedroomProject(), "flooring", 250); // $2.50 x 126 sq ft
    const el = renderSection({ project, design: project.levels[0].design });
    expect(el.textContent).toContain("$315.00");
    expect(el.textContent).toContain("Subtotal");
    expect(el.textContent).toContain("6 of 7 items to be priced");
  });

  it("reflects unsaved edits on screen in the quantities", () => {
    const project = setUnitCost(bedroomProject(), "flooring", 100);
    const el = renderSection({ project, design: createEmptyDesign() });
    expect(el.textContent).toContain("$0.00"); // emptied design: 0 sq ft
    expect(el.textContent).not.toContain("$144.00");
  });

  it("prints directly when the project is clean", () => {
    const project = bedroomProject();
    const onPrintProposal = vi.fn();
    renderSection({
      project,
      design: project.levels[0].design,
      dirty: false,
      onPrintProposal,
    });
    const button = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "Print proposal",
    );
    act(() => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onPrintProposal).toHaveBeenCalledTimes(1);
    expect(onPrintProposal.mock.calls[0][0].ok).toBe(true);
    expect(container.textContent).not.toContain("Unsaved changes");
  });

  it("warns on a dirty project — print current version prints without blocking", () => {
    const project = bedroomProject();
    const onPrintProposal = vi.fn();
    const onSaveAndPrint = vi.fn();
    renderSection({
      project,
      design: project.levels[0].design,
      dirty: true,
      onPrintProposal,
      onSaveAndPrint,
    });
    const button = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "Print proposal",
    );
    act(() => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    // The reviewer-required warning, verbatim.
    expect(container.textContent).toContain(
      "This proposal uses current unsaved changes. Save first if you want the proposal tied to the saved project.",
    );
    const dialog = container.querySelector('[role="alertdialog"]');
    const labels = [...dialog.querySelectorAll("button")].map((b) => b.textContent);
    expect(labels).toEqual(["Print current version", "Save and print", "Cancel"]);
    // "Print current version" prints — never blocked.
    const printCurrent = [...dialog.querySelectorAll("button")].find(
      (b) => b.textContent === "Print current version",
    );
    act(() => {
      printCurrent.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onPrintProposal).toHaveBeenCalledTimes(1);
    expect(onSaveAndPrint).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it("dirty warning: save and print saves first", () => {
    const project = bedroomProject();
    const onSaveAndPrint = vi.fn();
    renderSection({
      project,
      design: project.levels[0].design,
      dirty: true,
      onSaveAndPrint,
    });
    const button = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "Print proposal",
    );
    act(() => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const saveBtn = [...container.querySelectorAll('[role="alertdialog"] button')].find(
      (b) => b.textContent === "Save and print",
    );
    act(() => {
      saveBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onSaveAndPrint).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it("dirty warning: cancel dismisses without printing", () => {
    const project = bedroomProject();
    const onPrintProposal = vi.fn();
    renderSection({
      project,
      design: project.levels[0].design,
      dirty: true,
      onPrintProposal,
    });
    const button = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "Print proposal",
    );
    act(() => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const cancel = [...container.querySelectorAll('[role="alertdialog"] button')].find(
      (b) => b.textContent === "Cancel",
    );
    act(() => {
      cancel.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onPrintProposal).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it("renders a status line — not a crash — on a damaged project", () => {
    const damaged = { version: 1, levels: [], currentLevelId: "x" };
    const el = renderSection({ project: damaged, design: createEmptyDesign() });
    expect(el.textContent).toContain("Estimate unavailable");
  });

  it("renders nothing when there is no project", () => {
    const el = renderSection({ project: null, design: null });
    expect(el.textContent).toBe("");
  });
});
