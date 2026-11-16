// S1 (load-times slice 1): Scheduling list skeleton — the projects
// list renders as placeholders while the scheduling payload loads,
// instead of an empty shell that pops in later.
import { ForgeLoadingState } from "@/components/forge/ForgeStates";

export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-6">
      <div aria-hidden="true" className="animate-pulse space-y-4">
        <div className="flex items-center justify-between">
          <div className="h-8 w-56 rounded bg-slate-200 dark:bg-slate-700" />
          <div className="h-9 w-32 rounded-xl bg-slate-200 dark:bg-slate-700" />
        </div>
        <div className="space-y-2">
          <div className="h-16 rounded-xl bg-slate-200 dark:bg-slate-700" />
          <div className="h-16 rounded-xl bg-slate-200 dark:bg-slate-700" />
          <div className="h-16 rounded-xl bg-slate-200 dark:bg-slate-700" />
          <div className="h-16 rounded-xl bg-slate-200 dark:bg-slate-700" />
        </div>
      </div>
      <ForgeLoadingState label="Loading projects…" />
    </main>
  );
}
