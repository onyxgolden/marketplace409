// FORGE Chart Builder — starter content for the 8 slice-1 templates (slice 2).
// seedChartFromTemplate(template) returns { nodes, edges } as constructed
// domain objects (no positions — the caller runs layoutChart and stamps
// positions). Ids are deterministic per template. These are generic starter
// placeholders the user edits, not invented user data.

import { createEdge, createNode } from "./chartDocument.js";

function person(id, label, title, department, template) {
  return createNode({
    id,
    label,
    subtitle: title,
    fields: { title, department },
    style: { ...template.defaultNodeStyle },
  });
}

function step(id, label, subtitle, department, template) {
  return createNode({
    id,
    label,
    subtitle,
    fields: department ? { department } : {},
    style: { ...template.defaultNodeStyle },
  });
}

function link(id, from, to, type, label = "") {
  return createEdge({ id, from, to, type, label });
}

const SEEDS = {
  "org-classic-hierarchy"(t) {
    return {
      nodes: [
        person("ceo", "Alex Rivera", "Chief Executive Officer", "Executive", t),
        person("vp-ops", "Sam Chen", "VP Operations", "Operations", t),
        person("vp-fin", "Jordan Lee", "VP Finance", "Finance", t),
        person("ops-mgr", "Casey Kim", "Operations Manager", "Operations", t),
        person("fin-mgr", "Riley Patel", "Finance Manager", "Finance", t),
        person("hr-lead", "Taylor Brooks", "HR Lead", "People", t),
      ],
      edges: [
        link("e1", "ceo", "vp-ops", "supervisor"),
        link("e2", "ceo", "vp-fin", "supervisor"),
        link("e3", "vp-ops", "ops-mgr", "supervisor"),
        link("e4", "vp-fin", "fin-mgr", "supervisor"),
        link("e5", "ceo", "hr-lead", "supervisor"),
      ],
    };
  },
  "org-executive-tree"(t) {
    return {
      nodes: [
        person("ceo", "Alex Rivera", "Chief Executive Officer", "Executive", t),
        person("cto", "Sam Chen", "Chief Technology Officer", "Technology", t),
        person("cfo", "Jordan Lee", "Chief Financial Officer", "Finance", t),
        person("coo", "Casey Kim", "Chief Operating Officer", "Operations", t),
        person("cmo", "Riley Patel", "Chief Marketing Officer", "Marketing", t),
      ],
      edges: [
        link("e1", "ceo", "cto", "supervisor"),
        link("e2", "ceo", "cfo", "supervisor"),
        link("e3", "ceo", "coo", "supervisor"),
        link("e4", "ceo", "cmo", "supervisor"),
      ],
    };
  },
  "org-department-columns"(t) {
    return {
      nodes: [
        person("sales-1", "Alex Rivera", "Sales Director", "Sales", t),
        person("sales-2", "Sam Chen", "Account Executive", "Sales", t),
        person("eng-1", "Jordan Lee", "Engineering Manager", "Engineering", t),
        person("eng-2", "Casey Kim", "Senior Engineer", "Engineering", t),
        person("ops-1", "Riley Patel", "Operations Lead", "Operations", t),
        person("ops-2", "Taylor Brooks", "Logistics Coordinator", "Operations", t),
      ],
      edges: [
        link("e1", "sales-1", "sales-2", "supervisor"),
        link("e2", "eng-1", "eng-2", "supervisor"),
        link("e3", "ops-1", "ops-2", "supervisor"),
      ],
    };
  },
  "org-compact-tv-board"(t) {
    const members = [
      ["board-1", "Alex Rivera", "Board Chair"],
      ["board-2", "Sam Chen", "Vice Chair"],
      ["board-3", "Jordan Lee", "Treasurer"],
      ["board-4", "Casey Kim", "Secretary"],
      ["board-5", "Riley Patel", "Member"],
      ["board-6", "Taylor Brooks", "Member"],
      ["board-7", "Morgan Diaz", "Member"],
      ["board-8", "Jamie Fox", "Member"],
      ["board-9", "Avery Lane", "Member"],
    ];
    return {
      nodes: members.map(([id, label, title]) =>
        person(id, label, title, "Board", t)
      ),
      edges: members.slice(1).map(([id], i) =>
        link(`e${i + 1}`, "board-1", id, "supervisor")
      ),
    };
  },
  "workflow-left-to-right"(t) {
    return {
      nodes: [
        step("intake", "Intake", "Request received", "", t),
        step("review", "Review", "Check details", "", t),
        step("approve", "Approve", "Sign off", "", t),
        step("complete", "Complete", "Done", "", t),
      ],
      edges: [
        link("e1", "intake", "review", "sequence"),
        link("e2", "review", "approve", "sequence"),
        link("e3", "approve", "complete", "sequence"),
      ],
    };
  },
  "workflow-swimlane"(t) {
    return {
      nodes: [
        step("lead", "Lead captured", "New inquiry", "Sales", t),
        step("qualify", "Qualify", "Confirm fit", "Sales", t),
        step("pack", "Pack", "Prepare order", "Fulfillment", t),
        step("ship", "Ship", "Send to customer", "Fulfillment", t),
      ],
      edges: [
        link("e1", "lead", "qualify", "sequence"),
        link("e2", "qualify", "pack", "sequence"),
        link("e3", "pack", "ship", "sequence"),
      ],
    };
  },
  "workflow-decision-tree"(t) {
    return {
      nodes: [
        step("decision", "Budget approved?", "Decision point", "", t),
        step("proceed", "Proceed", "Start the work", "", t),
        step("revise", "Revise request", "Adjust and resubmit", "", t),
      ],
      edges: [
        link("e1", "decision", "proceed", "decision-yes", "Yes"),
        link("e2", "decision", "revise", "decision-no", "No"),
        link("e3", "revise", "decision", "sequence"),
      ],
    };
  },
  "workflow-kanban-flow"(t) {
    return {
      nodes: [
        step("todo-1", "Draft plan", "To do", "", t),
        step("todo-2", "Gather quotes", "To do", "", t),
        step("doing-1", "Renovation", "In progress", "", t),
        step("done-1", "Inspect", "Done", "", t),
      ],
      edges: [
        link("e1", "todo-1", "doing-1", "sequence"),
        link("e2", "todo-2", "doing-1", "sequence"),
        link("e3", "doing-1", "done-1", "sequence"),
      ],
    };
  },
};

export function seedChartFromTemplate(template) {
  if (!template || typeof template.id !== "string" || !SEEDS[template.id]) {
    throw new Error(`seedChartFromTemplate: unknown template "${template?.id}"`);
  }
  return SEEDS[template.id](template);
}
