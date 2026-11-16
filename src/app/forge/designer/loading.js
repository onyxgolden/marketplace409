// S1 (load-times slice 1): Designer list skeleton — the designs list
// renders as placeholders while the designer payload loads, instead of
// an empty shell that pops in later.
import { ForgeLoadingState } from "@/components/forge/ForgeStates";

export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-6">
      <div aria-hidden="true" className="animate-pulse space-y-4">
        <div className="flex items-center justify-between">
          <div className="h-8 w-56 rounded bg-slate-200 dark:bg-slate-700" />
          <div className="h-9 w-32 rounded-xl bg-slate-200 dark:bg-slate-700" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="h-44 rounded-2xl bg-slate-200 dark:bg-slate-700" />
          <div className="h-44 rounded-2xl bg-slate-200 dark:bg-slate-700" />
          <div className="h-44 rounded-2xl bg-slate-200 dark:bg-slate-700" />
        </div>
      </div>
      <ForgeLoadingState label="Loading designs…" />
    </main>
  );
}
