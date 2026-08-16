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
    id: "dev",
    name: "Dev",
    href: "/forge/developer",
    iconName: "Code2",
    description: "Programmer tools and engineering controls.",
  }),
]);

// Forge's own routes (financial/property/connections/results/import) are
// nested under /forge/*, but /forge/rental and /forge/developer have been
// promoted to their own sibling workspaces, so "Forge" must not read as
// active on those two subtrees even though they share the URL prefix.
export function isWorkspaceActive(pathname, workspace) {
  if (!pathname) return false;

  if (workspace.id === "forge") {
    if (pathname === "/forge") return true;
    return (
      pathname.startsWith("/forge/") &&
      !pathname.startsWith("/forge/rental") &&
      !pathname.startsWith("/forge/developer")
    );
  }

  return pathname === workspace.href || pathname.startsWith(`${workspace.href}/`);
}

export function findActiveWorkspace(pathname) {
  return WORKSPACES.find((workspace) => isWorkspaceActive(pathname, workspace)) ?? null;
}
