// S1 (load-times slice 1): work-package detail skeleton — Overview,
// Scope baseline, and Readiness sections render as placeholders while
// the detail query chain runs.
import { ForgeLoadingState } from "@/components/forge/ForgeStates";

export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-6">
      <div aria-hidden="true" className="animate-pulse space-y-6">
        <div className="h-8 w-80 rounded bg-slate-200 dark:bg-slate-700" />
        <div className="h-6 w-48 rounded bg-slate-200 dark:bg-slate-700" />
        <div className="grid gap-4 md:grid-cols-2">
          <div className="h-48 rounded-2xl bg-slate-200 dark:bg-slate-700" />
          <div className="h-48 rounded-2xl bg-slate-200 dark:bg-slate-700" />
        </div>
        <div className="h-56 rounded-2xl bg-slate-200 dark:bg-slate-700" />
      </div>
      <ForgeLoadingState label="Loading work package…" />
    </main>
  );
}
