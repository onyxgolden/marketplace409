// S1 (load-times slice 1): instant feedback while the /forge dashboard
// loads. Before this file existed a click showed the old page with zero
// feedback until the whole server chain finished; Next.js now renders
// this skeleton immediately on navigation. Reuses the shared
// ForgeLoadingState visual language (skeleton + role="status" label).
import { ForgeLoadingState } from "@/components/forge/ForgeStates";

export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-6">
      <div aria-hidden="true" className="animate-pulse space-y-6">
        <div className="h-8 w-64 rounded bg-slate-200 dark:bg-slate-700" />
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="h-24 rounded-2xl bg-slate-200 dark:bg-slate-700" />
          <div className="h-24 rounded-2xl bg-slate-200 dark:bg-slate-700" />
          <div className="h-24 rounded-2xl bg-slate-200 dark:bg-slate-700" />
          <div className="h-24 rounded-2xl bg-slate-200 dark:bg-slate-700" />
        </div>
        <div className="h-64 rounded-2xl bg-slate-200 dark:bg-slate-700" />
      </div>
      <ForgeLoadingState label="Loading dashboard…" />
    </main>
  );
}
