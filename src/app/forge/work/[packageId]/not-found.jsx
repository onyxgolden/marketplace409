import Link from "next/link";

// D8(b) fix: a package that doesn't exist (or isn't the signed-in owner's —
// RLS returns the same "not found" for both, so existence is never leaked
// to an unauthorized viewer) used to silently redirect to /forge/work with
// no explanation. notFound() renders this inside the Planner's own
// layout.jsx (WorkspaceShell + PlannerNavBar), so the nav bar stays visible
// instead of landing on a bare page.
export default function WorkPackageNotFound() {
  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-16 text-center">
      <h1 className="text-xl font-semibold text-slate-900 dark:text-white">Package not found</h1>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
        This work package doesn&apos;t exist, or isn&apos;t available in your current workspace.
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
