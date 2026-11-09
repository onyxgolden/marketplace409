// UI-density redesign: the workspace switcher selects a workspace with a
// ?workspace=<ownerId> page param, and the server resolves it for that
// page's reads. Client fetches from the detail page and its panels must
// scope to the same workspace, or a switched page would show one
// workspace's panels while its mutations hit the default one. This helper
// appends the current page's workspace selection to a workspace-scoped API
// path. No-op when nothing is selected or the path already carries one, so
// existing behavior (and tests) are untouched when the switcher is hidden.
export function withWorkspaceQuery(path) {
  if (typeof window === "undefined") return path;
  const selected = new URLSearchParams(window.location.search).get("workspace");
  if (!selected) return path;
  const query = path.split("?")[1] || "";
  if (new URLSearchParams(query).has("workspace")) return path;
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}workspace=${encodeURIComponent(selected)}`;
}
