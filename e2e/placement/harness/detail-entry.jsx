// Placement-harness entry: the full work-package detail client, with
// the same shape of `initial` the server page passes. The API is mocked
// by e2e/placement/mock.js (loaded before this bundle). Only the
// overview tab's Package section is exercised here (Package Edit Save).
import React from "react";
import { createRoot } from "react-dom/client";
import WorkPackageDetailClient from "../../../src/components/work-management/WorkPackageDetailClient.jsx";
import { PackagePageProvider } from "../../../src/components/work-management/packagePageContext.jsx";

const BASE_PKG = {
  id: "forge_wp_1",
  code: "WP-0001",
  title: "Turnover",
  status: "draft",
  description: null,
  package_type: "other",
  priority: "normal",
  project_id: null,
  property_id: null,
  planned_start: null,
  planned_finish: null,
  actual_start: null,
  actual_finish: null,
  percent_complete: 0,
  progress_basis: "pct_estimate",
  planned_qty: null,
  planned_unit: null,
  planned_manhours: null,
  earned_qty: null,
  earned_manhours: null,
  actual_manhours: null,
  responsible_party: null,
  scope_baseline_id: null,
  designated_verifier: null,
  blocked_reason: null,
  version: 1,
};

const initial = {
  package: BASE_PKG,
  transitions: [],
  attestations: [],
  baselines: [],
  scopeChanges: [],
  observations: [],
  planningSummary: null,
  deletionEligibility: null,
};

const root = createRoot(document.getElementById("root"));
root.render(
  <PackagePageProvider workspace={null} forgeProject={null}>
    {/* Same page wrapper as src/app/forge/work/[packageId]/page.jsx —
        the tab bar's -mx-4 cancels this px-4; without it the bar bleeds
        16px past the viewport and the overflow check false-fails. */}
    <main className="mx-auto w-full max-w-7xl px-4 py-8">
      <WorkPackageDetailClient initial={initial} initialLinks={[]} initialTab="overview" />
    </main>
  </PackagePageProvider>,
);
