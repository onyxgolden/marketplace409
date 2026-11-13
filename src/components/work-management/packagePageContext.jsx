// Canonical validated package-page context for the work-package detail
// page (slice-7 PDF blockers).
//
// The server page resolves the workspace owner selection and the project
// scope (forgeProject = "unassigned" or a validated project id) and
// passes both down to WorkPackageDetailClient, which provides them here.
// Every child panel reads the same context through usePageQuery(), so
// nested package read/write requests carry the page's scope even after a
// tab switch, a link, or browser back/forward — the scope no longer
// depends on window.location.search surviving each navigation.
//
// Outside the provider (list page, standalone screens) the hooks fall
// back to the location-based withWorkspaceQuery, so behavior there is
// unchanged.
"use client";

import { createContext, useCallback, useContext, useMemo } from "react";
import { withPageQuery, withWorkspaceQuery } from "./workspaceQuery.js";

export const PackagePageContext = createContext(null);

export function PackagePageProvider({ workspace, forgeProject, children }) {
  const value = useMemo(
    () => ({ workspace: workspace ?? null, forgeProject: forgeProject ?? null }),
    [workspace, forgeProject],
  );
  return <PackagePageContext.Provider value={value}>{children}</PackagePageContext.Provider>;
}

export function usePackagePageContext() {
  return useContext(PackagePageContext);
}

// Bound query builder for the current page. Inside the detail-page
// provider it applies the server-validated { workspace, forgeProject };
// outside it behaves exactly like withWorkspaceQuery.
export function usePageQuery() {
  const context = usePackagePageContext();
  return useCallback(
    (path) => (context ? withPageQuery(path, context) : withWorkspaceQuery(path)),
    [context],
  );
}
