// Slice-7 PDF blockers, fix round 1 — detail server-page render tests.
//
// The original build rendered forgeProjectParam={forgeProjectParam}
// without ever declaring it, so the server threw a ReferenceError
// before any panel could render. These tests prove the page renders
// for both scopes and passes the CANONICAL prop derived from the
// already validated scope — never the raw ?forgeProject= value.
// Same pattern as the /forge/work list page test: mock the auth
// boundary and the service reads, then render the server component's
// markup directly. The detail client is stubbed at the page boundary
// so the test asserts exactly what the server page hands it.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((href) => { throw new Error(`NEXT_REDIRECT:${href}`); }),
  notFound: vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }),
  createAuthenticatedForgeApplication: vi.fn(),
  listWorkspacesForActor: vi.fn(),
  getWorkPackageDetail: vi.fn(),
  listLinks: vi.fn(),
  resolvePlannerProjectScope: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
  notFound: mocks.notFound,
}));

vi.mock("@/lib/supabase/createAuthenticatedForgeApplication", () => ({
  createAuthenticatedForgeApplication: mocks.createAuthenticatedForgeApplication,
}));

vi.mock("@/lib/supabase/resolveEffectiveOwnerId", () => ({
  listWorkspacesForActor: mocks.listWorkspacesForActor,
}));

vi.mock("@/application/work-management/workPackages", () => ({
  getWorkPackageDetail: mocks.getWorkPackageDetail,
}));

vi.mock("@/application/work-management/workLinks", () => ({
  listLinks: mocks.listLinks,
}));

vi.mock("@/application/work-management/projectScope", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    resolvePlannerProjectScope: mocks.resolvePlannerProjectScope,
  };
});

vi.mock("@/components/work-management/WorkPackageDetailClient", async () => {
  const React = await import("react");
  return {
    default: function DetailClientStub(props) {
      return React.createElement("div", {
        "data-testid": "detail-client",
        "data-forge-project": props.forgeProjectParam ?? "",
        "data-workspace": props.workspaceParam ?? "",
        "data-tab": props.initialTab ?? "",
      }, props.initial?.package?.title ?? "");
    },
  };
});

vi.mock("@/components/work-management/WorkPackageWorkspaceSwitcher", async () => {
  const React = await import("react");
  return {
    default: function WorkspaceSwitcherStub() {
      return React.createElement("div", { "data-testid": "workspace-switcher" });
    },
  };
});

import WorkPackagePage from "./page.jsx";

const DETAIL = {
  ok: true,
  package: { code: "WP-0008", title: "Test package" },
};

async function renderPage(searchParams, packageId = "pkg_1") {
  const element = await WorkPackagePage({
    params: Promise.resolve({ packageId }),
    searchParams: Promise.resolve(searchParams),
  });
  return renderToStaticMarkup(element);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createAuthenticatedForgeApplication.mockImplementation(async (opts) => ({
    supabaseClient: { fakeDb: true },
    effectiveOwnerId: opts?.requestedOwnerId || "owner_1",
    user: { id: "owner_1" },
  }));
  mocks.listWorkspacesForActor.mockResolvedValue([
    { ownerId: "owner_1", role: "owner", label: "My workspace" },
  ]);
  mocks.getWorkPackageDetail.mockResolvedValue(DETAIL);
  mocks.listLinks.mockResolvedValue({ ok: true, links: [] });
});

describe("/forge/work/[packageId] server page (slice-7 fix round 1)", () => {
  it("renders the unassigned scope with the exact 'unassigned' sentinel", async () => {
    mocks.resolvePlannerProjectScope.mockResolvedValue({
      ok: true, scope: { kind: "unassigned" },
    });
    const html = await renderPage({ forgeProject: "unassigned" });
    expect(html).toContain("Test package");
    expect(html).toContain('data-forge-project="unassigned"');
    // The detail read runs under the validated unassigned scope.
    expect(mocks.getWorkPackageDetail).toHaveBeenCalledWith(
      { fakeDb: true },
      expect.objectContaining({ packageId: "pkg_1", scope: { kind: "unassigned" } }),
    );
  });

  it("renders a project scope with the validated project id, not the raw query value", async () => {
    mocks.resolvePlannerProjectScope.mockResolvedValue({
      ok: true, scope: { kind: "project", projectId: "forge_prj_validated" },
    });
    // The raw hint differs from the validated id: the page must pass
    // the scope's projectId, never the query string.
    const html = await renderPage({ forgeProject: "forge_prj_raw" });
    expect(html).toContain("Test package");
    expect(html).toContain('data-forge-project="forge_prj_validated"');
    expect(html).not.toContain("forge_prj_raw");
    expect(mocks.getWorkPackageDetail).toHaveBeenCalledWith(
      { fakeDb: true },
      expect.objectContaining({
        packageId: "pkg_1",
        scope: { kind: "project", projectId: "forge_prj_validated" },
      }),
    );
  });

  it("redirects to the list when the scope cannot be resolved (chooser state)", async () => {
    mocks.resolvePlannerProjectScope.mockResolvedValue({
      ok: true, scope: { kind: "none" },
    });
    await expect(renderPage({})).rejects.toThrow("NEXT_REDIRECT:/forge/work");
    expect(mocks.getWorkPackageDetail).not.toHaveBeenCalled();
  });
});
