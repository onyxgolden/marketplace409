// Placement-harness entry: the Slice-9 Busts panel on its own, with
// the same page-query context the detail page provides. The API is
// mocked by e2e/placement/mock.js (loaded before this bundle).
import React from "react";
import { createRoot } from "react-dom/client";
import WorkPackageBusts from "../../../src/components/work-management/WorkPackageBusts.jsx";
import { PackagePageProvider } from "../../../src/components/work-management/packagePageContext.jsx";

const root = createRoot(document.getElementById("root"));
root.render(
  <PackagePageProvider workspace={null} forgeProject={null}>
    <div className="mx-auto max-w-4xl p-4">
      <h1 className="mb-4 text-lg font-semibold text-slate-900">
        Slice-9 busts — placement harness
      </h1>
      <WorkPackageBusts packageId="pkg_1" />
    </div>
  </PackagePageProvider>,
);
