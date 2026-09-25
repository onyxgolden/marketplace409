"use client";
import { useCallback } from "react";
import { useStaleWhileRevalidate } from "@/hooks/useStaleWhileRevalidate";
import { ForgeErrorState, ForgeLoadingState } from "@/components/forge/ForgeStates";

export default function RentalAutopayPanel() {
  // Autopay authorizations: stale-while-revalidate. The cached list renders
  // instantly on return visits and refreshes in the background — the last
  // good list never blanks out.
  const fetchAutopay = useCallback(async () => {
    const response = await fetch("/api/rental");
    const body = await response.json();
    if (!response.ok) throw new Error(body.error);
    return body.autopayEnrollments || [];
  }, []);
  const { data, error: loadError, isLoading, isRefreshing, refresh } = useStaleWhileRevalidate(
    "rental:autopay",
    fetchAutopay,
    { ttlMs: 60_000 },
  );
  const items = data || null;

  if (!items && isLoading) return <ForgeLoadingState label="Loading autopay authorizations…" />;
  if (!items && loadError) {
    return <ForgeErrorState
      title="Unable to load autopay authorizations"
      detail={loadError}
      onRetry={() => refresh()}
    />;
  }

  return <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
    <p className="text-xs font-black uppercase tracking-[0.2em] text-sky-700 dark:text-sky-400">Autopay</p>
    <h2 className="mt-1 text-3xl font-black tracking-tight text-slate-950 dark:text-white">Tenant authorizations</h2>
    <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">Consent alone never activates a debit. “Setup required” means Stripe has not yet supplied both a reusable payment method and mandate.</p>
    {items && loadError ? <p role="status" className="mt-3 text-xs font-bold text-slate-400 dark:text-slate-500">Could not refresh — showing the last saved authorizations.</p> : null}
    {items && isRefreshing ? <p className="mt-3 text-xs font-bold text-slate-400 dark:text-slate-500">Updating…</p> : null}
    <div className="mt-5 space-y-3">{items.length ? items.map((item) => <article key={item.id} className="rounded-xl border border-slate-200 p-4 dark:border-slate-700"><strong className="text-slate-950 dark:text-white">{item.status.replaceAll("_", " ")}</strong><p className="text-sm text-slate-600 dark:text-slate-400">Lease {item.lease_id} · {item.payment_method_type.replaceAll("_", " ")} · day {item.charge_day}</p><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Consented {new Date(item.consented_at).toLocaleString()}{item.cancelled_at ? ` · Cancelled ${new Date(item.cancelled_at).toLocaleString()}` : ""}</p></article>) : <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600 dark:bg-slate-950/40 dark:text-slate-400">No tenant autopay authorizations recorded.</p>}</div>
  </section>;
}
