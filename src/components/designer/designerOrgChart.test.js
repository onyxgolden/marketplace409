import { describe, expect, it } from "vitest";
import { createInitialState, designerReducer, TOOLS } from "./designerReducer";
import { createEmptyDesign, resetDesignerIds } from "@/domains/roomDesigner/designerDocument";

function stateWithChart(name = "Leadership") {
  let state = createInitialState(createEmptyDesign("Org test"));
  state = designerReducer(state, { type: "ADD_ORG_CHART", name, x: 100, y: 200 });
  return state;
}

describe("designerReducer — org charts", () => {
  it("registers the orgchart tool and starts with no charts", () => {
    expect(TOOLS).toContain("orgchart");
    const state = createInitialState(createEmptyDesign("Blank"));
    expect(state.design.orgCharts).toEqual([]);
  });

  it("places a chart, selects it, and returns to the select tool", () => {
    const state = stateWithChart();
    expect(state.design.orgCharts).toHaveLength(1);
    expect(state.design.orgCharts[0]).toMatchObject({ name: "Leadership", x: 100, y: 200 });
    expect(state.selection).toEqual({ kind: "orgchart", id: state.design.orgCharts[0].id });
    expect(state.tool).toBe("select");
    expect(state.dirty).toBe(true);
  });

  it("moves and renames a chart, ignoring unknown ids", () => {
    let state = stateWithChart();
    const id = state.design.orgCharts[0].id;
    state = designerReducer(state, { type: "MOVE_ORG_CHART", chartId: id, x: 10, y: 20 });
    expect(state.design.orgCharts[0]).toMatchObject({ x: 10, y: 20 });
    state = designerReducer(state, { type: "RENAME_ORG_CHART", chartId: id, name: "Exec" });
    expect(state.design.orgCharts[0].name).toBe("Exec");
    const before = state.design.orgCharts[0];
    state = designerReducer(state, { type: "MOVE_ORG_CHART", chartId: "missing", x: 0, y: 0 });
    state = designerReducer(state, { type: "RENAME_ORG_CHART", chartId: "missing", name: "X" });
    expect(state.design.orgCharts[0]).toBe(before);
  });

  it("adds, updates, reassigns, and removes people", () => {
    resetDesignerIds();
    let state = stateWithChart();
    const chartId = state.design.orgCharts[0].id;
    const rootId = state.design.orgCharts[0].nodes[0].id;

    state = designerReducer(state, {
      type: "ADD_PERSON",
      chartId,
      person: { name: "Brandy Morgan", title: "COO", department: "Operations", managerId: rootId },
    });
    expect(state.design.orgCharts[0].nodes).toHaveLength(2);
    const personId = state.design.orgCharts[0].nodes[1].id;
    expect(state.design.orgCharts[0].nodes[1]).toMatchObject({ name: "Brandy Morgan", managerId: rootId });

    state = designerReducer(state, {
      type: "UPDATE_PERSON",
      chartId,
      personId,
      fields: { title: "Chief operating officer" },
    });
    expect(state.design.orgCharts[0].nodes[1].title).toBe("Chief operating officer");

    state = designerReducer(state, {
      type: "SET_PERSON_MANAGER",
      chartId,
      personId,
      managerId: null,
    });
    expect(state.design.orgCharts[0].nodes[1].managerId).toBeNull();

    state = designerReducer(state, { type: "DELETE_PERSON", chartId, personId });
    expect(state.design.orgCharts[0].nodes).toHaveLength(1);
  });

  it("lets UPDATE_PERSON clear a name to empty (transient editing state)", () => {
    // Regression: deleting the last character of a person's name used to throw
    // inside updatePerson; the reducer swallowed the error and the controlled
    // input snapped back, so the final character could never be removed.
    let state = stateWithChart();
    const chartId = state.design.orgCharts[0].id;
    const rootId = state.design.orgCharts[0].nodes[0].id;
    state = designerReducer(state, { type: "UPDATE_PERSON", chartId, personId: rootId, fields: { name: "N" } });
    expect(state.design.orgCharts[0].nodes[0].name).toBe("N");
    state = designerReducer(state, { type: "UPDATE_PERSON", chartId, personId: rootId, fields: { name: "" } });
    expect(state.design.orgCharts[0].nodes[0].name).toBe("");
    state = designerReducer(state, {
      type: "UPDATE_PERSON",
      chartId,
      personId: rootId,
      fields: { name: "Jason Morgan" },
    });
    expect(state.design.orgCharts[0].nodes[0].name).toBe("Jason Morgan");
  });

  it("fails soft on invalid person edits instead of throwing", () => {
    let state = stateWithChart();
    const chartId = state.design.orgCharts[0].id;
    const rootId = state.design.orgCharts[0].nodes[0].id;
    const before = state.design.orgCharts[0];

    // blank name, unknown manager, and a reporting cycle all leave state alone
    state = designerReducer(state, { type: "ADD_PERSON", chartId, person: { name: "   " } });
    state = designerReducer(state, { type: "ADD_PERSON", chartId, person: { name: "X", managerId: "ghost" } });
    state = designerReducer(state, { type: "SET_PERSON_MANAGER", chartId, personId: rootId, managerId: rootId });
    expect(state.design.orgCharts[0]).toBe(before);
    expect(state.design.orgCharts[0].nodes).toHaveLength(1);
  });

  it("rejects a reporting cycle through the reducer", () => {
    let state = stateWithChart();
    const chartId = state.design.orgCharts[0].id;
    const rootId = state.design.orgCharts[0].nodes[0].id;
    state = designerReducer(state, {
      type: "ADD_PERSON",
      chartId,
      person: { name: "Report", managerId: rootId },
    });
    const reportId = state.design.orgCharts[0].nodes[1].id;
    const before = state.design.orgCharts[0];
    state = designerReducer(state, { type: "SET_PERSON_MANAGER", chartId, personId: rootId, managerId: reportId });
    expect(state.design.orgCharts[0]).toBe(before);
    expect(state.design.orgCharts[0].nodes[0].managerId).toBeNull();
  });

  it("deletes a chart via DELETE_SELECTION and DELETE_OBJECT", () => {
    let state = stateWithChart();
    const id = state.design.orgCharts[0].id;
    state = designerReducer(state, { type: "DELETE_SELECTION" });
    expect(state.design.orgCharts).toHaveLength(0);
    expect(state.selection).toBeNull();

    state = stateWithChart();
    const id2 = state.design.orgCharts[0].id;
    state = designerReducer(state, { type: "DELETE_OBJECT", target: { kind: "orgchart", id: id2 } });
    expect(state.design.orgCharts).toHaveLength(0);
    expect(id2).not.toBe(id); // sanity: fresh chart each time
  });

  it("allows the orgchart tool in SET_TOOL", () => {
    let state = createInitialState();
    state = designerReducer(state, { type: "SET_TOOL", tool: "orgchart" });
    expect(state.tool).toBe("orgchart");
  });

  it("defaults orgCharts on designs saved before Phase 3", () => {
    const old = createEmptyDesign("Old");
    delete old.orgCharts;
    const state = createInitialState(old);
    expect(state.design.orgCharts).toEqual([]);
  });
});
