import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";

// D5: /forge/work list filters. The page keeps the same owner-scoped read
// (listWorkPackages with ownerId only) and filters the loaded array in
// memory from allowlisted ?status / ?propertyId params. These tests mock
// the auth boundary and the service reads, then render the server
// component's markup directly — the same pattern as the health page test.

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((href) => { throw new Error(`NEXT_REDIRECT:${href}`); }),
  listWorkPackages: vi.fn(),
  listPackagePropertyOptions: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

vi.mock("@/lib/supabase/createAuthenticatedForgeApplication", () => ({
  createAuthenticatedForgeApplication: async () => ({
    supabaseClient: { fakeDb: true },
    effectiveOwnerId: "owner_1",
  }),
}));

vi.mock("@/application/work-management/workPackages", () => ({
  listWorkPackages: mocks.listWorkPackages,
  listPackagePropertyOptions: mocks.listPackagePropertyOptions,
}));

import WorkPackagesPage from "./page.jsx";

const PROPERTIES = [
  { slug: "1900-w-decker", label: "1900 W. Decker" },
  { slug: "4800-kent-ave", label: "4800 Kent Ave" },
];

const PACKAGES = [
  { id: "wp_1", code: "WP-0001", title: "Decker turnover", package_type: "rental_turn", priority: "normal", status: "draft", planned_start: null, planned_finish: null, percent_complete: 0, unit: null, area: null, system: null, property_id: "1900-w-decker", updated_at: "2026-10-01T00:00:00Z" },
  { id: "wp_2", code: "WP-0002", title: "Kent kitchen", package_type: "remodel", priority: "high", status: "in_progress", planned_start: null, planned_finish: null, percent_complete: 40, unit: null, area: null, system: null, property_id: "4800-kent-ave", updated_at: "2026-10-02T00:00:00Z" },
  { id: "wp_3", code: "WP-0003", title: "Unassigned repairs", package_type: "maintenance_repair", priority: "normal", status: "draft", planned_start: null, planned_finish: null, percent_complete: 0, unit: null, area: null, system: null, property_id: null, updated_at: "2026-10-03T00:00:00Z" },
];

async function renderPage(params = {}) {
  const element = await WorkPackagesPage({ searchParams: Promise.resolve(params) });
  return renderToStaticMarkup(element);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listWorkPackages.mockResolvedValue({ ok: true, packages: PACKAGES });
  mocks.listPackagePropertyOptions.mockResolvedValue({ ok: true, properties: PROPERTIES });
});

describe("/forge/work list filters (D5)", () => {
  it("loads all of the owner's packages unfiltered when no params are given", async () => {
    const html = await renderPage();
    expect(html).toContain("Decker turnover");
    expect(html).toContain("Kent kitchen");
    expect(html).toContain("Unassigned repairs");
    // Same owner-scoped read as before filtering existed: ownerId only,
    // no status/property filter pushed into the query.
    expect(mocks.listWorkPackages).toHaveBeenCalledWith({ fakeDb: true }, { ownerId: "owner_1" });
  });

  it("treats status=all and propertyId=all as no filter", async () => {
    const html = await renderPage({ status: "all", propertyId: "all" });
    expect(html).toContain("Decker turnover");
    expect(html).toContain("Kent kitchen");
    expect(html).toContain("Unassigned repairs");
  });

  it("filters by a known status", async () => {
    const html = await renderPage({ status: "draft" });
    expect(html).toContain("Decker turnover");
    expect(html).toContain("Unassigned repairs");
    expect(html).not.toContain("Kent kitchen");
  });

  it("filters by a canonical property slug", async () => {
    const html = await renderPage({ propertyId: "4800-kent-ave" });
    expect(html).toContain("Kent kitchen");
    expect(html).not.toContain("Decker turnover");
  });

  it("resolves an alias property param to the canonical slug", async () => {
    const html = await renderPage({ propertyId: "1900-west-decker" });
    expect(html).toContain("Decker turnover");
    expect(html).not.toContain("Kent kitchen");
  });

  it("filters to unassigned packages with the sentinel", async () => {
    const html = await renderPage({ propertyId: "__unassigned__" });
    expect(html).toContain("Unassigned repairs");
    expect(html).not.toContain("Decker turnover");
    expect(html).not.toContain("Kent kitchen");
  });

  it("combines status and property filters", async () => {
    const html = await renderPage({ status: "draft", propertyId: "1900-w-decker" });
    expect(html).toContain("Decker turnover");
    expect(html).not.toContain("Unassigned repairs");
    expect(html).not.toContain("Kent kitchen");
  });

  it("ignores an invalid status safely instead of erroring or widening", async () => {
    const html = await renderPage({ status: "bogus_status' OR 1=1" });
    expect(html).toContain("Decker turnover");
    expect(html).toContain("Kent kitchen");
    expect(html).toContain("Unassigned repairs");
  });

  it("distinguishes 'no packages yet' from 'no matches' and offers Clear filters", async () => {
    mocks.listWorkPackages.mockResolvedValue({ ok: true, packages: [] });
    const emptyHtml = await renderPage();
    expect(emptyHtml).toContain("No work packages yet");
    expect(emptyHtml).not.toContain("match these filters");

    mocks.listWorkPackages.mockResolvedValue({ ok: true, packages: PACKAGES });
    const noMatchHtml = await renderPage({ status: "verified_closed" });
    expect(noMatchHtml).toContain("No work packages match these filters");
    expect(noMatchHtml).toContain('href="/forge/work"');
    expect(noMatchHtml).toContain("Clear filters");
  });

  it("deep-links directly: params applied on first render with no client fetch", async () => {
    const html = await renderPage({ status: "in_progress", propertyId: "4800-kent-ave" });
    expect(html).toContain("Kent kitchen");
    expect(html).not.toContain("Decker turnover");
  });

  it("renders accessible native GET-form selects reflecting the active filters", async () => {
    const html = await renderPage({ status: "draft", propertyId: "1900-w-decker" });
    expect(html).toContain('action="/forge/work" method="get"');
    expect(html).toContain('for="filter-status"');
    expect(html).toContain('id="filter-status" name="status"');
    expect(html).toContain('for="filter-property"');
    expect(html).toContain('id="filter-property" name="propertyId"');
    expect(html).toContain("Apply filters");
    expect(html).toContain("All statuses");
    expect(html).toContain("All properties");
    expect(html).toContain("No property assigned");
    expect(html).toContain("1900 W. Decker");
    expect(html).toContain("4800 Kent Ave");
    // Native selects keep their value in the submitted URL on refresh.
    expect(html).toContain('value="draft" selected=""');
  });

  it("preserves the new-package and detail links", async () => {
    const html = await renderPage();
    expect(html).toContain('href="/forge/work/new"');
    expect(html).toContain('href="/forge/work/wp_1"');
    expect(html).toContain('href="/forge/work/wp_2"');
  });

  it("never leaks another owner's packages: filtering runs only over the owner-scoped read", async () => {
    const html = await renderPage({ propertyId: "4800-kent-ave" });
    expect(html).not.toContain("Decker turnover");
    expect(mocks.listWorkPackages).toHaveBeenCalledTimes(1);
    expect(mocks.listPackagePropertyOptions).toHaveBeenCalledWith({ fakeDb: true }, { ownerId: "owner_1" });
  });
});
