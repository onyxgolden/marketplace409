"use client";

/**
 * Test-data fixture — DEV ONLY.
 *
 * Renders the real PlannerHierarchyManager so the Playwright layout /
 * behavior check measures the actual component at real phone viewports
 * instead of a copy of its markup. In production this route 404s.
 *
 * Cases (?case=): owner-real | owner-test | co-owner. The case only
 * labels the scenario for the test run — the hierarchy data itself
 * comes from the /api/forge/hierarchy responses, which Playwright
 * intercepts per scenario with canned inventory JSON:
 *   owner-real — canUseOwnerTestData true, real clients only.
 *   owner-test — canUseOwnerTestData true, one test client + one real.
 *   co-owner   — canUseOwnerTestData false, real clients only, and no
 *                test client anywhere in the payload.
 * The page sets data-fixture-ready once the case has rendered.
 */

import { notFound } from "next/navigation";
import { useState } from "react";
import PlannerHierarchyManager from "@/components/work-management/PlannerHierarchyManager";

const CASES = ["owner-real", "owner-test", "co-owner"];

export default function TestDataFixturePage() {
  const [fixtureCase] = useState(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("case") || "owner-real";
  });
  if (process.env.NODE_ENV === "production") notFound();
  if (!fixtureCase) return <main data-fixture-ready="false" />;
  if (!CASES.includes(fixtureCase)) {
    return <main data-fixture-ready="missing">Unknown case: {fixtureCase}</main>;
  }
  return (
    <div data-fixture-ready="true" data-fixture-case={fixtureCase}>
      <main className="mx-auto w-full max-w-7xl px-4 py-8">
        <PlannerHierarchyManager />
      </main>
    </div>
  );
}
