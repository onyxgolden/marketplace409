import { describe, expect, it } from "vitest";
import { WORKSPACES, findActiveWorkspace, isWorkspaceActive } from "./workspaces";

describe("WORKSPACES", () => {
  it("lists Marketplace, Rentals, Forge, Scheduling, then Dev, in that order", () => {
    expect(WORKSPACES.map((w) => w.id)).toEqual(["marketplace", "rentals", "forge", "scheduling", "dev"]);
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

  it("does not match Forge on subtrees promoted to their own workspace (rental, developer, scheduling)", () => {
    const forge = WORKSPACES.find((w) => w.id === "forge");
    expect(isWorkspaceActive("/forge/rental", forge)).toBe(false);
    expect(isWorkspaceActive("/forge/rental/portal", forge)).toBe(false);
    expect(isWorkspaceActive("/forge/developer", forge)).toBe(false);
    expect(isWorkspaceActive("/forge/scheduling", forge)).toBe(false);
    expect(isWorkspaceActive("/forge/scheduling/schedule_project_1", forge)).toBe(false);
  });

  it("matches Scheduling on its own root and nested project routes", () => {
    const scheduling = WORKSPACES.find((w) => w.id === "scheduling");
    expect(isWorkspaceActive("/forge/scheduling", scheduling)).toBe(true);
    expect(isWorkspaceActive("/forge/scheduling/schedule_project_1", scheduling)).toBe(true);
    expect(isWorkspaceActive("/forge/scheduling/schedule_project_1/wbs", scheduling)).toBe(true);
    expect(isWorkspaceActive("/forge/financial", scheduling)).toBe(false);
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

  it("finds Forge for an ordinary Forge route", () => {
    expect(findActiveWorkspace("/forge/financial")?.id).toBe("forge");
  });

  it("returns null when nothing matches", () => {
    expect(findActiveWorkspace("/nonexistent")).toBeNull();
  });
});
