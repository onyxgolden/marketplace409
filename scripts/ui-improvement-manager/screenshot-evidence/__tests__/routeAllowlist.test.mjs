import { describe, expect, it } from "vitest";
import { APPROVED_ROUTES, RouteNotApprovedError, assertRouteApproved, findApprovedRoute } from "../routeAllowlist.mjs";

describe("route allowlisting", () => {
  it("finds an approved route by its exact path", () => {
    expect(findApprovedRoute("/")?.routeId).toBe("home");
    expect(findApprovedRoute("/forge/financial")?.routeId).toBe("forge-financial-overview");
  });

  it("returns null for a path that is not on the approved list", () => {
    expect(findApprovedRoute("/admin/anything")).toBeNull();
  });

  it("does not approve a path via prefix/substring matching", () => {
    // "/forge/financial" is approved; "/forge/financial/../../admin" and "/forge/financialize" must
    // not be -- exact match only, no glob/prefix behavior that could be walked around.
    expect(findApprovedRoute("/forge/financialize")).toBeNull();
    expect(findApprovedRoute("/forge/financial/secret")).toBeNull();
  });

  it("assertRouteApproved throws RouteNotApprovedError for an unapproved path", () => {
    expect(() => assertRouteApproved("/anything/else")).toThrow(RouteNotApprovedError);
  });

  it("assertRouteApproved returns the route definition for an approved path", () => {
    expect(assertRouteApproved("/").routeId).toBe("home");
  });

  it("every approved route declares requiresAuth explicitly (never left undefined)", () => {
    for (const route of APPROVED_ROUTES) {
      expect(typeof route.requiresAuth).toBe("boolean");
    }
  });

  it("the public home route requires no authentication and has no sensitive components", () => {
    const home = findApprovedRoute("/");
    expect(home.requiresAuth).toBe(false);
    expect(home.components).toEqual([]);
  });

  it("the authenticated financial route declares at least one readiness marker and one component", () => {
    const financial = findApprovedRoute("/forge/financial");
    expect(financial.requiresAuth).toBe(true);
    expect(financial.readinessMarkers.length).toBeGreaterThan(0);
    expect(financial.components.length).toBeGreaterThan(0);
  });

  it("route list entries are frozen and cannot be mutated at runtime", () => {
    expect(() => { APPROVED_ROUTES[0].path = "/hacked"; }).toThrow();
  });
});
