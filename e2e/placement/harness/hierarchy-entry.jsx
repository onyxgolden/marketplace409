// Placement-harness entry: the Planner hierarchy manager
// (Clients / Sites / Projects) on its own. The API is mocked by
// e2e/placement/mock.js (loaded before this bundle); the `scenario`
// query param selects the fixture variant the mock serves
// (default | hierarchy-readonly).
import React from "react";
import { createRoot } from "react-dom/client";
import PlannerHierarchyManager from "../../../src/components/work-management/PlannerHierarchyManager.jsx";

const root = createRoot(document.getElementById("root"));
root.render(
  <div className="mx-auto max-w-4xl p-4">
    <h1 className="mb-4 text-lg font-semibold text-slate-900">
      Clients, sites &amp; projects — placement harness
    </h1>
    <PlannerHierarchyManager />
  </div>,
);
