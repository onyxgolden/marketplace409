// S1 (load-times slice 1): Rental Manager skeleton — summary cards and
// the record list render as placeholders while the rental payload loads.
import { ForgeLoadingState } from "@/components/forge/ForgeStates";

export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-6">
      <div aria-hidden="true" className="animate-pulse space-y-6">
        <div className="h-8 w-64 rounded bg-slate-200 dark:bg-slate-700" />
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="h-20 rounded-2xl bg-slate-200 dark:bg-slate-700" />
          <div className="h-20 rounded-2xl bg-slate-200 dark:bg-slate-700" />
          <div className="h-20 rounded-2xl bg-slate-200 dark:bg-slate-700" />
          <div className="h-20 rounded-2xl bg-slate-200 dark:bg-slate-700" />
        </div>
        <div className="space-y-2">
          <div className="h-12 rounded-xl bg-slate-200 dark:bg-slate-700" />
          <div className="h-12 rounded-xl bg-slate-200 dark:bg-slate-700" />
          <div className="h-12 rounded-xl bg-slate-200 dark:bg-slate-700" />
        </div>
      </div>
      <ForgeLoadingState label="Loading rental summary…" />
    </main>
  );
}
