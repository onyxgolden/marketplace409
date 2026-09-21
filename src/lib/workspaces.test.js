import { describe, expect, it } from "vitest";
import { WORKSPACES, findActiveWorkspace, isWorkspaceActive } from "./workspaces";

describe("WORKSPACES", () => {
  it("lists Marketplace, Rentals, Private Financing, Reservations, Forge, Scheduling, Designer, then Dev, in that order", () => {
    expect(WORKSPACES.map((w) => w.id)).toEqual(["marketplace", "rentals", "private-financing", "reservations", "forge", "scheduling", "designer", "dev"]);
  });

  it("is frozen, and gives every workspace an id, name, href, iconName, and description", () => {
    expect(Object.isFrozen(WORKSPACES)).toBe(true);
    for (const workspace of WORKSPACES) {
      expect(workspace.id.length).toBeGreaterThan(0);
      expect(workspace.name.length).toBeGreaterThan(0);
      expect(workspace.href.startsWith("/")).toBe(true);
      expect(workspace.iconName.length).toBeGreaterThan(0);
      expect(workspace.description.length).toBeGreaterThan(0);
    }
  });
});

describe("isWorkspaceActive", () => {
  it("matches Forge on its own root and on ordinary Forge sub-routes", () => {
    const forge = WORKSPACES.find((w) => w.id === "forge");
    expect(isWorkspaceActive("/forge", forge)).toBe(true);
    expect(isWorkspaceActive("/forge/financial", forge)).toBe(true);
    expect(isWorkspaceActive("/forge/property/123", forge)).toBe(true);
  });

  it("does not match Forge on subtrees promoted to their own workspace (rental, private-financing, reservations, developer, scheduling, designer)", () => {
    const forge = WORKSPACES.find((w) => w.id === "forge");
    expect(isWorkspaceActive("/forge/rental", forge)).toBe(false);
    expect(isWorkspaceActive("/forge/rental/portal", forge)).toBe(false);
    expect(isWorkspaceActive("/forge/private-financing", forge)).toBe(false);
    expect(isWorkspaceActive("/forge/private-financing/portal", forge)).toBe(false);
    expect(isWorkspaceActive("/forge/reservations", forge)).toBe(false);
    expect(isWorkspaceActive("/forge/developer", forge)).toBe(false);
    expect(isWorkspaceActive("/forge/scheduling", forge)).toBe(false);
    expect(isWorkspaceActive("/forge/scheduling/schedule_project_1", forge)).toBe(false);
    expect(isWorkspaceActive("/forge/designer", forge)).toBe(false);
    expect(isWorkspaceActive("/forge/designer/design_1", forge)).toBe(false);
  });

  it("matches Scheduling on its own root and nested project routes", () => {
    const scheduling = WORKSPACES.find((w) => w.id === "scheduling");
    expect(isWorkspaceActive("/forge/scheduling", scheduling)).toBe(true);
    expect(isWorkspaceActive("/forge/scheduling/schedule_project_1", scheduling)).toBe(true);
    expect(isWorkspaceActive("/forge/scheduling/schedule_project_1/wbs", scheduling)).toBe(true);
    expect(isWorkspaceActive("/forge/financial", scheduling)).toBe(false);
  });

  it("matches Designer on its own root and nested design routes", () => {
    const designer = WORKSPACES.find((w) => w.id === "designer");
    expect(isWorkspaceActive("/forge/designer", designer)).toBe(true);
    expect(isWorkspaceActive("/forge/designer/design_1", designer)).toBe(true);
    expect(isWorkspaceActive("/forge/financial", designer)).toBe(false);
  });

  it("returns false for an empty or missing pathname", () => {
    const scheduling = WORKSPACES.find((w) => w.id === "scheduling");
    expect(isWorkspaceActive("", scheduling)).toBe(false);
    expect(isWorkspaceActive(null, scheduling)).toBe(false);
  });
});

describe("findActiveWorkspace", () => {
  it("finds Scheduling for a scheduling route, not Forge", () => {
    expect(findActiveWorkspace("/forge/scheduling/schedule_project_1")?.id).toBe("scheduling");
  });

  it("finds Designer for a designer route, not Forge", () => {
    expect(findActiveWorkspace("/forge/designer/design_1")?.id).toBe("designer");
  });

  it("finds Private Financing and Reservations for their promoted routes, not Forge", () => {
    expect(findActiveWorkspace("/forge/private-financing")?.id).toBe("private-financing");
    expect(findActiveWorkspace("/forge/private-financing/portal")?.id).toBe("private-financing");
    expect(findActiveWorkspace("/forge/reservations")?.id).toBe("reservations");
  });

  it("finds Forge for an ordinary Forge route", () => {
    expect(findActiveWorkspace("/forge/financial")?.id).toBe("forge");
  });

  it("returns null when nothing matches", () => {
    expect(findActiveWorkspace("/nonexistent")).toBeNull();
  });
});
