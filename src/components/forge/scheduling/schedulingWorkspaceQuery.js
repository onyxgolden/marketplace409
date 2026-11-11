// Mirrors src/components/work-management/workspaceQuery.js exactly (that
// helper is already reviewed and merged via PR #758/#767) -- kept as its
// own local copy rather than a cross-app import, matching this repo's
// existing app-boundary convention (Scheduling's component tree does not
// import from Work Management's). No-op when nothing is selected or the
// path already carries one, so this is safe even though Scheduling has no
// workspace-switcher UI yet (PR #773 added the route-layer plumbing only).
export function withWorkspaceQuery(path) {
  if (typeof window === "undefined") return path;
  const selected = new URLSearchParams(window.location.search).get("workspace");
  if (!selected) return path;
  const query = path.split("?")[1] || "";
  if (new URLSearchParams(query).has("workspace")) return path;
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}workspace=${encodeURIComponent(selected)}`;
}
