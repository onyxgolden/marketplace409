// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import React from "react";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  renderToStaticMarkup,
} from "react-dom/server";

import PropertyConditionAssessmentPanel, {
  buildConditionObservation,
  formatPropertyConditionDate,
} from "../PropertyConditionAssessmentPanel.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe(
  "PropertyConditionAssessmentPanel",
  () => {
    it(
      "renders a compact condition workflow landing",
      () => {
        const markup =
          renderToStaticMarkup(
            <PropertyConditionAssessmentPanel />,
          );

        expect(markup).toContain(
          "data-property-condition-assessment-panel",
        );

        expect(markup).toContain(
          "Standardized property condition history",
        );

        expect(markup).toContain(
          "What do you want to do?",
        );

        expect(markup).toContain(
          "Record condition assessment",
        );

        expect(markup).toContain(
          "Review condition history",
        );

        expect(markup).toContain(
          "Saved assessments",
        );

        expect(markup).toContain(
          "max-w-5xl",
        );

        expect(markup).not.toContain(
          "Checklist section",
        );

        expect(markup).not.toContain(
          "Add observation",
        );

        expect(markup).not.toContain(
          "Save assessment",
        );

        expect(markup).not.toContain(
          "Add from photo or document",
        );

        expect(markup).not.toContain(
          "Future OCR imports",
        );
      },
    );

    it(
      "builds a complete catalog-backed observation payload",
      () => {
        expect(
          buildConditionObservation({
            section:
              "structural_systems",
            itemKey:
              "roof_structures_and_attics",
            status: "observed",
            attributes: {
              roofStructureType:
                "conventional",
              averageInsulationDepth:
                8,
            },
            notes:
              "Viewed from attic access.",
            estimatedReplacementCostCents:
              125000,
            plannedReplacementYear:
              2027,
          }),
        ).toEqual({
          section:
            "structural_systems",
          systemKey:
            "roof_structures_and_attics",
          itemKey:
            "roof_structures_and_attics",
          label:
            "Roof Structures and Attics",
          observationStatus:
            "observed",
          condition: "unknown",
          replacementPriority:
            "unknown",
          estimatedReplacementCostCents:
            125000,
          plannedReplacementYear:
            2027,
          valuationImpact: "unknown",
          attributes: {
            roofStructureType:
              "conventional",
            averageInsulationDepth:
              8,
          },
          notes:
            "Viewed from attic access.",
        });
      },
    );

    it(
      "normalizes optional observation values to persistence-safe defaults",
      () => {
        expect(
          buildConditionObservation({
            section: "hvac_systems",
            itemKey:
              "cooling_equipment",
            status: "observed",
            notes: "  ",
          }),
        ).toEqual({
          section: "hvac_systems",
          systemKey:
            "cooling_equipment",
          itemKey:
            "cooling_equipment",
          label:
            "Cooling Equipment",
          observationStatus:
            "observed",
          condition: "unknown",
          replacementPriority:
            "unknown",
          estimatedReplacementCostCents:
            null,
          plannedReplacementYear:
            null,
          valuationImpact: "unknown",
          attributes: {},
          notes: null,
        });
      },
    );

    it(
      "preserves the effective calendar date across local time zones",
      () => {
        expect(
          formatPropertyConditionDate(
            "2026-08-08T00:00:00.000Z",
          ),
        ).toBe("8/8/2026");
      },
    );

    it(
      "rejects an unknown checklist identity before persistence",
      () => {
        expect(() =>
          buildConditionObservation({
            section:
              "structural_systems",
            itemKey:
              "not_in_catalog",
            status: "observed",
          }),
        ).toThrow(
          "Choose a supported checklist item.",
        );
      },
    );
  },
);

function jsonResponse(body, ok = true) {
  return Promise.resolve({ ok, json: () => Promise.resolve(body) });
}
function mount(ui) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(ui));
  return { container, root };
}
function unmount({ container, root }) {
  act(() => root.unmount());
  container.remove();
}
async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
}
function setInputValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
function setSelectValue(select, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
  setter.call(select, value);
  select.dispatchEvent(new Event("change", { bubbles: true }));
}
function fieldControl(container, labelText) {
  const label = [...container.querySelectorAll("label")].find((el) => el.textContent.trim().startsWith(labelText));
  return label?.querySelector("select, input");
}
function findButtonByText(container, text) {
  return [...container.querySelectorAll("button")].find((button) => button.textContent.trim() === text);
}

// Regression test for a real production bug: this component's "record" workflow referenced six
// handler functions (changeSection, changeItem, updateAttribute, addObservation,
// removeObservation, saveAssessment) and a `definitions` variable that were never actually
// defined anywhere in scope -- a no-undef repo-wide audit caught it (see the scheduling block-
// drawer crash this same class of bug caused). renderToStaticMarkup never advances past the
// landing screen (workflow stays null), so none of this was ever exercised by the tests above --
// this walks the real "record" workflow interactively instead: pick a property, change section,
// pick a checklist item, fill an attribute, add/remove/re-add an observation, then save.
describe("PropertyConditionAssessmentPanel -- the record workflow", () => {
  beforeEach(() => {
    global.fetch = vi.fn((url, init) => {
      if (typeof url === "string" && url.startsWith("/api/financial/read-models")) {
        return jsonResponse({
          data: { business: { reports: { properties: [{ propertyId: "prop_1", propertyName: "123 Main St" }] } } },
        });
      }
      if (typeof url === "string" && url.startsWith("/api/property-condition-assessments") && (!init || init.method === undefined)) {
        return jsonResponse({ success: true, assessments: [] }); // GET by property
      }
      if (typeof url === "string" && url === "/api/property-condition-assessments" && init?.method === "POST") {
        const body = JSON.parse(init.body);
        return jsonResponse({
          success: true,
          assessment: { id: "assessment_1", ...body.assessment, createdAt: "2026-08-08T00:00:00.000Z" },
        });
      }
      return jsonResponse({ success: true });
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it("records, edits, removes, re-adds, and saves an observation without crashing", async () => {
    const mounted = mount(<PropertyConditionAssessmentPanel />);
    await flush();

    // Property auto-selects (only one loaded) -- move into the record workflow.
    act(() => { findButtonByText(mounted.container, "Record condition assessment").click(); });
    await flush();
    expect(mounted.container.textContent).toContain("Checklist section");

    // changeSection: switch away and back -- must not throw even with no item selected.
    const sectionSelect = fieldControl(mounted.container, "Checklist section");
    act(() => { setSelectValue(sectionSelect, "electrical_systems"); });
    await flush();
    act(() => { setSelectValue(sectionSelect, "structural_systems"); });
    await flush();

    // changeItem + the `definitions` memo: selecting an item with attribute fields must render
    // them, not throw "definitions is not defined".
    const itemSelect = fieldControl(mounted.container, "Checklist item");
    act(() => { setSelectValue(itemSelect, "roof_structures_and_attics"); });
    await flush();
    expect(mounted.container.textContent).toContain("Roof structure type");

    // updateAttribute
    const roofTypeInput = fieldControl(mounted.container, "Roof structure type");
    act(() => { setInputValue(roofTypeInput, "conventional"); });
    await flush();

    // addObservation
    act(() => { findButtonByText(mounted.container, "Add observation").click(); });
    await flush();
    expect(mounted.container.textContent).toContain("Assessment observations");
    expect(mounted.container.textContent).toContain("Roof Structures and Attics");

    // removeObservation
    act(() => { findButtonByText(mounted.container, "Remove").click(); });
    await flush();
    expect(mounted.container.textContent).not.toContain("Assessment observations");

    // A successful add resets itemKey/attributes (ready for the next item) -- re-select before
    // re-adding, same as a real user picking their next checklist item would.
    act(() => { setSelectValue(fieldControl(mounted.container, "Checklist item"), "roof_structures_and_attics"); });
    await flush();
    act(() => { setInputValue(fieldControl(mounted.container, "Roof structure type"), "conventional"); });
    await flush();
    act(() => { findButtonByText(mounted.container, "Add observation").click(); });
    await flush();
    expect(mounted.container.textContent).toContain("Roof Structures and Attics");

    // saveAssessment
    act(() => { findButtonByText(mounted.container, "Save assessment").click(); });
    await flush();

    const postCall = global.fetch.mock.calls.find(([url, init]) => url === "/api/property-condition-assessments" && init?.method === "POST");
    expect(postCall).toBeTruthy();
    const body = JSON.parse(postCall[1].body);
    expect(body).toMatchObject({ operation: "record-owner-assessment", assessment: { propertyId: "prop_1" } });
    expect(body.assessment.items).toHaveLength(1);
    expect(body.assessment.items[0]).toMatchObject({ itemKey: "roof_structures_and_attics", attributes: { roofStructureType: "conventional" } });

    expect(mounted.container.textContent).toContain("Assessment saved.");
    expect(mounted.container.textContent).not.toContain("Assessment observations"); // cleared on success

    unmount(mounted);
  });
});
