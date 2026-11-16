// S1 (load-times slice 1): Planner list skeleton — the work-packages
// grid header, filters, and rows render as placeholders the moment the
// navigation starts, instead of a dead click until the list query chain
// finishes.
import { ForgeLoadingState } from "@/components/forge/ForgeStates";

export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-6">
      <div aria-hidden="true" className="animate-pulse space-y-4">
        <div className="h-8 w-72 rounded bg-slate-200 dark:bg-slate-700" />
        <div className="flex gap-2">
          <div className="h-9 w-32 rounded-xl bg-slate-200 dark:bg-slate-700" />
          <div className="h-9 w-32 rounded-xl bg-slate-200 dark:bg-slate-700" />
          <div className="h-9 w-40 rounded-xl bg-slate-200 dark:bg-slate-700" />
        </div>
        <div className="space-y-2">
          <div className="h-12 rounded-xl bg-slate-200 dark:bg-slate-700" />
          <div className="h-12 rounded-xl bg-slate-200 dark:bg-slate-700" />
          <div className="h-12 rounded-xl bg-slate-200 dark:bg-slate-700" />
          <div className="h-12 rounded-xl bg-slate-200 dark:bg-slate-700" />
        </div>
      </div>
      <ForgeLoadingState label="Loading work packages…" />
    </main>
  );
}
