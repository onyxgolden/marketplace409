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
//
// Slice-7 PDF blockers: the detail page's tab switch rewrote the URL with
// only tab + workspace, dropping ?forgeProject=, so every panel fetch
// after the first tab switch lost its scope and failed closed 404 — even
// though the header (server-rendered, scope intact) looked fine. The fix
// threads the server-validated scope through React context instead of
// re-reading window.location.search: withPageQuery(path, context) applies
// an explicit { workspace, forgeProject } pair, and usePageQuery() (see
// packagePageContext.jsx) binds it to the page's validated context. A
// fetch built from the context keeps its scope across tab changes, links
// and back/forward, regardless of what the URL bar holds at that moment.
// withWorkspaceQuery stays as the fallback for components rendered
// outside the detail-page provider (list page, standalone screens).
export function withPageQuery(path, context) {
  if (!context || (!context.workspace && !context.forgeProject)) return path;
  let result = path;
  for (const [param, selected] of [
    ["workspace", context.workspace],
    ["forgeProject", context.forgeProject],
  ]) {
    if (!selected) continue;
    const query = result.split("?")[1] || "";
    if (new URLSearchParams(query).has(param)) continue;
    const separator = result.includes("?") ? "&" : "?";
    result = `${result}${separator}${param}=${encodeURIComponent(selected)}`;
  }
  return result;
}

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

// SWR/cache keys must isolate by workspace + project scope: two scopes of
// the same package (unassigned vs an assigned project, or two workspaces)
// must never share a cached panel. Without a provider the key is the
// plain joined string, identical to before this change.
export function scopedSWRKey(context, ...parts) {
  const base = parts.filter((part) => part !== null && part !== undefined && part !== "").join(":");
  if (!context || (!context.workspace && !context.forgeProject)) return base;
  return `${context.workspace ?? "-"}:${context.forgeProject ?? "-"}:${base}`;
}
