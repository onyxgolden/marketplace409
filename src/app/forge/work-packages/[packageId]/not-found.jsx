import Link from "next/link";

// D8(a) fix: a consistent, planner-aware "not found" for any URL under
// /forge/work-packages/<id> that isn't the real .../takeoff route. Renders
// inside this subtree's layout.jsx (WorkspaceShell + PlannerNavBar).
export default function WorkPackagesSegmentNotFound() {
  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-16 text-center">
      <h1 className="text-xl font-semibold text-slate-900 dark:text-white">Package not found</h1>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
        This page doesn&apos;t exist. Work package details live at{" "}
        <span className="font-mono text-xs">/forge/work/&lt;id&gt;</span>.
      </p>
      <Link
        href="/forge/work"
        className="mt-6 inline-block rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 dark:bg-white dark:text-slate-900"
      >
        Back to Work Packages
      </Link>
    </main>
  );
}
