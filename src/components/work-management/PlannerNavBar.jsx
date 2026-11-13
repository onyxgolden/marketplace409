"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

// Shared persistent navigation for every Work Package Planner view
// (landing, Document library, Admin, New package, package detail). Jason,
// 2026-11-10 (standing rule, not a per-fix judgment call): every page/tab in
// FORGE must have a visible way to every other main view — a faint
// breadcrumb alone does not count. Before this component, the landing page
// had header buttons but Document library, Admin, and package detail each
// had at most one or zero links out.
//
// Client component because it needs the current ?workspace= selection
// (read via useSearchParams, same source WorkPackageWorkspaceSwitcher's
// links write) to carry the active workspace across a nav click — losing it
// would silently switch the user back to their default workspace mid-task.
const LINKS = [
  { href: "/forge/work", label: "Work Packages" },
  { href: "/forge/work?forgeProject=unassigned", label: "Unassigned packages", forgeProject: "unassigned" },
  { href: "/forge/work/documents", label: "Document library" },
  { href: "/forge/work/admin", label: "Admin" },
  { href: "/forge/work/new", label: "New package" },
];

export default function PlannerNavBar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const workspace = searchParams.get("workspace");
  const forgeProject = searchParams.get("forgeProject");

  function hrefFor(link) {
    // PR B: nav clicks carry the active project scope (and workspace)
    // so moving between Planner views never silently drops the user
    // back to the chooser. The Unassigned entry sets the scope
    // explicitly instead of carrying it.
    const params = new URLSearchParams();
    if (workspace) params.set("workspace", workspace);
    if (link.forgeProject) params.set("forgeProject", link.forgeProject);
    else if (forgeProject) params.set("forgeProject", forgeProject);
    const query = params.toString();
    const [path] = link.href.split("?");
    return query ? `${path}?${query}` : path;
  }

  return (
    <nav aria-label="Work Package Planner" className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-1 px-4 py-2">
        {LINKS.map((link) => {
          const { href, label } = link;
          const active = link.forgeProject
            ? pathname === "/forge/work" && forgeProject === "unassigned"
            : href === "/forge/work"
              ? pathname === "/forge/work" && forgeProject !== "unassigned"
              : pathname.startsWith(href);
          return (
            <Link
              key={`${href}-${link.forgeProject || ""}`}
              href={hrefFor(link)}
              aria-current={active ? "page" : undefined}
              className={
                active
                  ? "rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white"
                  : "rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100"
              }
            >
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
