// Single source of truth for the top-level FORGE/409 Marketplace workspaces.
// Kept free of React/Next imports so it is safe to use from both server
// and client components without crossing any serialization boundary.
export const WORKSPACES = Object.freeze([
  Object.freeze({
    id: "marketplace",
    name: "Marketplace",
    href: "/market",
    iconName: "Store",
    description: "Buy, sell, and browse local listings.",
  }),
  Object.freeze({
    id: "rentals",
    name: "Rentals",
    href: "/forge/rental",
    iconName: "Building2",
    description: "FORGE Rental Manager — leases, payments, tenants.",
  }),
  Object.freeze({
    id: "forge",
    name: "Forge",
    href: "/forge",
    iconName: "Hammer",
    description: "Financial operations, properties, and connections.",
  }),
  Object.freeze({
    id: "scheduling",
    name: "Scheduling",
    href: "/forge/scheduling",
    iconName: "GanttChart",
    description: "Gantt chart wall-boards, calendars, and project templates.",
  }),
  Object.freeze({
    id: "dev",
    name: "Dev",
    href: "/forge/developer",
    iconName: "Code2",
    description: "Programmer tools and engineering controls.",
  }),
]);

// Subtrees promoted out of Forge's own ForgeApplicationRail into their own
// sibling workspace (see that file's PROMOTED_PREFIXES) -- "Forge" must not
// read as active on any of these even though they share the /forge/* URL
// prefix, or the wrong tile would highlight.
const PROMOTED_OUT_OF_FORGE = ["/forge/rental", "/forge/developer", "/forge/scheduling"];

export function isWorkspaceActive(pathname, workspace) {
  if (!pathname) return false;

  if (workspace.id === "forge") {
    if (pathname === "/forge") return true;
    return (
      pathname.startsWith("/forge/") &&
      !PROMOTED_OUT_OF_FORGE.some(
        (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
      )
    );
  }

  return pathname === workspace.href || pathname.startsWith(`${workspace.href}/`);
}

export function findActiveWorkspace(pathname) {
  return WORKSPACES.find((workspace) => isWorkspaceActive(pathname, workspace)) ?? null;
}
