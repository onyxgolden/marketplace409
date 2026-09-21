import { describe, expect, it } from "vitest";
import {
  CHART_TEMPLATE_IDS,
  getChartTemplate,
  listChartTemplates,
  listChartTemplatesByType,
} from "../chartTemplates.js";

const EXPECTED = [
  { id: "org-classic-hierarchy", type: "org" },
  { id: "org-executive-tree", type: "org" },
  { id: "org-department-columns", type: "org" },
  { id: "org-compact-tv-board", type: "org" },
  { id: "workflow-left-to-right", type: "workflow" },
  { id: "workflow-swimlane", type: "workflow" },
  { id: "workflow-decision-tree", type: "workflow" },
  { id: "workflow-kanban-flow", type: "workflow" },
];

describe("chartTemplates", () => {
  it("exposes exactly the 8 expected template ids/types", () => {
    expect(CHART_TEMPLATE_IDS).toEqual(EXPECTED.map((t) => t.id));
    expect(listChartTemplates()).toHaveLength(8);
  });

  it("each template carries the required shape", () => {
    for (const template of listChartTemplates()) {
      const expected = EXPECTED.find((t) => t.id === template.id);
      expect(expected).toBeDefined();
      expect(template.type).toBe(expected.type);
      expect(template.defaultNodeStyle).toBeDefined();
      expect(template.edgeStyle).toBeDefined();
      expect(template.layoutPreset).toBeDefined();
    }
  });

  it("getChartTemplate and listChartTemplatesByType work", () => {
    expect(getChartTemplate("org-compact-tv-board").type).toBe("org");
    expect(getChartTemplate("nope")).toBeNull();
    expect(listChartTemplatesByType("org")).toHaveLength(4);
    expect(listChartTemplatesByType("workflow")).toHaveLength(4);
  });
});
