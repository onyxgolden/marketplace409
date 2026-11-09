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
    id: "private-financing",
    name: "Private Financing",
    href: "/forge/private-financing",
    iconName: "Landmark",
    description: "Private lending — borrower accounts, payments, and messages.",
  }),
  Object.freeze({
    id: "reservations",
    name: "Reservations",
    href: "/forge/reservations",
    iconName: "Tent",
    description: "RV & cabin reservations — inventory, rate plans, and bookings.",
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
    id: "work-packages",
    name: "Work Packages",
    href: "/forge/work",
    iconName: "ClipboardList",
    description: "Work package planner — drawings, steps, manpower, and IFA-to-IFC review.",
  }),
  Object.freeze({
    id: "designer",
    name: "Designer",
    href: "/forge/designer",
    iconName: "DraftingCompass",
    description: "Room and layout designer — 2D floor plans with 3D preview.",
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
const PROMOTED_OUT_OF_FORGE = ["/forge/rental", "/forge/developer", "/forge/scheduling", "/forge/designer", "/forge/private-financing", "/forge/reservations", "/forge/work", "/forge/work-packages"];

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

  if (workspace.id === "work-packages") {
    // The planner's list and detail pages live under /forge/work, but takeoff
    // pages live under /forge/work-packages/[packageId]/takeoff -- both belong
    // to this workspace, so the tile highlights on either prefix.
    return (
      pathname === workspace.href ||
      pathname.startsWith(`${workspace.href}/`) ||
      pathname === "/forge/work-packages" ||
      pathname.startsWith("/forge/work-packages/")
    );
  }

  return pathname === workspace.href || pathname.startsWith(`${workspace.href}/`);
}

export function findActiveWorkspace(pathname) {
  return WORKSPACES.find((workspace) => isWorkspaceActive(pathname, workspace)) ?? null;
}
