// UI-density redesign: the workspace switcher selects a workspace with a
// ?workspace=<ownerId> page param, and the server resolves it for that
// page's reads. Client fetches from the detail page and its panels must
// scope to the same workspace, or a switched page would show one
// workspace's panels while its mutations hit the default one.
//
// PR B extends the same rule to the project scope: a client fetch from a
// Planner page also carries the page's ?forgeProject= selection, so the
// package-scoped API routes see the same scope the server rendered
// under. A fetch without it would fail closed (404) on every
// package-scoped route. No-op for a param that is absent or already on
// the path, so existing behavior (and tests) are untouched when the
// switcher/selector are not in use.
export function withWorkspaceQuery(path) {
  if (typeof window === "undefined") return path;
  const search = new URLSearchParams(window.location.search);
  let result = path;
  for (const param of ["workspace", "forgeProject"]) {
    const selected = search.get(param);
    if (!selected) continue;
    const query = result.split("?")[1] || "";
    if (new URLSearchParams(query).has(param)) continue;
    const separator = result.includes("?") ? "&" : "?";
    result = `${result}${separator}${param}=${encodeURIComponent(selected)}`;
  }
  return result;
}
