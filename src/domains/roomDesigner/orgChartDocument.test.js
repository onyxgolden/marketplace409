import { describe, expect, it, beforeEach } from "vitest";
import {
  addOrgChart,
  addPerson,
  createEmptyDesign,
  deleteOrgChart,
  findOrgChart,
  findPerson,
  moveOrgChart,
  parseDesign,
  removePerson,
  renameOrgChart,
  resetDesignerIds,
  serializeDesign,
  setPersonManager,
  updatePerson,
  validateDesign,
} from "./designerDocument";

beforeEach(() => {
  resetDesignerIds();
});

function chartWithTeam() {
  let d = createEmptyDesign("Org test");
  d = addOrgChart(d, "Leadership", 100, 200);
  const chart = d.orgCharts[0];
  const rootId = chart.nodes[0].id;
  d = updatePerson(d, chart.id, rootId, { name: "Jason Morgan", title: "Owner", department: "Executive" });
  d = addPerson(d, chart.id, { name: "Brandy Morgan", title: "COO", department: "Operations", managerId: rootId });
  return { design: d, chartId: chart.id, rootId };
}

describe("org chart document — charts", () => {
  it("starts empty on a new design", () => {
    expect(createEmptyDesign().orgCharts).toEqual([]);
  });

  it("places a chart with a placeholder person", () => {
    let d = createEmptyDesign();
    d = addOrgChart(d, "Leadership", 100, 200);
    expect(d.orgCharts).toHaveLength(1);
    const chart = d.orgCharts[0];
    expect(chart).toMatchObject({ name: "Leadership", x: 100, y: 200 });
    expect(chart.nodes).toHaveLength(1);
    expect(chart.nodes[0]).toMatchObject({ name: "New person", managerId: null });
    expect(findOrgChart(d, chart.id)).toBe(chart);
  });

  it("defaults a blank name and rejects a bad position", () => {
    let d = createEmptyDesign();
    d = addOrgChart(d, "   ", 0, 0);
    expect(d.orgCharts[0].name).toBe("Org chart");
    expect(() => addOrgChart(d, "X", NaN, 0)).toThrow("position must be valid");
  });

  it("moves, renames, and deletes a chart", () => {
    let { design: d, chartId } = chartWithTeam();
    d = moveOrgChart(d, chartId, 10, 20);
    expect(findOrgChart(d, chartId)).toMatchObject({ x: 10, y: 20 });
    d = renameOrgChart(d, chartId, "Exec team");
    expect(findOrgChart(d, chartId).name).toBe("Exec team");
    d = renameOrgChart(d, chartId, "   ");
    expect(findOrgChart(d, chartId).name).toBe("Org chart");
    d = deleteOrgChart(d, chartId);
    expect(d.orgCharts).toHaveLength(0);
    expect(() => moveOrgChart(d, chartId, 0, 0)).toThrow("Unknown org chart");
  });

  it("round-trips through serialize/parse", () => {
    const { design } = chartWithTeam();
    const revived = parseDesign(serializeDesign(design));
    expect(revived.orgCharts).toHaveLength(1);
    expect(revived.orgCharts[0].nodes).toHaveLength(2);
    expect(validateDesign(revived)).toEqual([]);
  });
});

describe("org chart document — people", () => {
  it("adds a person under a manager", () => {
    let { design: d, chartId, rootId } = chartWithTeam();
    d = addPerson(d, chartId, { name: "Ethan Morgan", title: "Engineer", department: "Ops", managerId: rootId });
    const people = findOrgChart(d, chartId).nodes;
    expect(people).toHaveLength(3);
    expect(people[2]).toMatchObject({ name: "Ethan Morgan", title: "Engineer", department: "Ops", managerId: rootId });
    expect(findPerson(findOrgChart(d, chartId), people[2].id).name).toBe("Ethan Morgan");
  });

  it("requires a name and a valid manager", () => {
    const { design: d, chartId, rootId } = chartWithTeam();
    expect(() => addPerson(d, chartId, { name: "   " })).toThrow("Person name is required");
    expect(() => addPerson(d, chartId, { name: "X", managerId: "ghost" })).toThrow("Unknown manager");
    expect(() => addPerson(d, "ghost", { name: "X" })).toThrow("Unknown org chart");
  });

  it("patches name/title/department and clears with blanks", () => {
    let { design: d, chartId, rootId } = chartWithTeam();
    d = updatePerson(d, chartId, rootId, { title: "CEO", department: "" });
    expect(findPerson(findOrgChart(d, chartId), rootId)).toMatchObject({ title: "CEO", department: "" });
    expect(() => updatePerson(d, chartId, rootId, { name: "" })).toThrow("Person name is required");
    expect(() => updatePerson(d, chartId, "ghost", { name: "X" })).toThrow("Unknown person");
  });

  it("reassigns managers and rejects cycles", () => {
    let { design: d, chartId, rootId } = chartWithTeam();
    const childId = findOrgChart(d, chartId).nodes[1].id;
    // promote the report to top level
    d = setPersonManager(d, chartId, childId, null);
    expect(findPerson(findOrgChart(d, chartId), childId).managerId).toBeNull();
    // now make the old root report to the child, then try to reverse it (cycle)
    d = setPersonManager(d, chartId, rootId, childId);
    expect(() => setPersonManager(d, chartId, childId, rootId)).toThrow("reporting cycle");
    expect(() => setPersonManager(d, chartId, childId, childId)).toThrow("own manager");
    expect(() => setPersonManager(d, chartId, childId, "ghost")).toThrow("Unknown manager");
  });

  it("removing a person reparents their reports to the removed person's manager", () => {
    let { design: d, chartId, rootId } = chartWithTeam();
    d = addPerson(d, chartId, { name: "Middle", managerId: rootId });
    const middleId = findOrgChart(d, chartId).nodes[2].id;
    d = addPerson(d, chartId, { name: "Leaf", managerId: middleId });
    const leafId = findOrgChart(d, chartId).nodes[3].id;
    d = removePerson(d, chartId, middleId);
    const chart = findOrgChart(d, chartId);
    expect(chart.nodes.map((p) => p.id)).not.toContain(middleId);
    expect(findPerson(chart, leafId).managerId).toBe(rootId);
    expect(validateDesign(d)).toEqual([]);
  });

  it("removing a root promotes their reports to roots", () => {
    let { design: d, chartId, rootId } = chartWithTeam();
    const childId = findOrgChart(d, chartId).nodes[1].id;
    d = removePerson(d, chartId, rootId);
    expect(findPerson(findOrgChart(d, chartId), childId).managerId).toBeNull();
  });
});

describe("org chart document — validation", () => {
  it("flags people reporting to unknown ids", () => {
    let d = createEmptyDesign();
    d = addOrgChart(d, "Broken", 0, 0);
    const chart = d.orgCharts[0];
    const broken = {
      ...chart,
      nodes: [...chart.nodes, { id: "p_x", name: "Ghost", title: "", department: "", managerId: "nobody" }],
    };
    d = { ...d, orgCharts: [broken] };
    const errors = validateDesign(d);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/reports to unknown person/);
  });
});
