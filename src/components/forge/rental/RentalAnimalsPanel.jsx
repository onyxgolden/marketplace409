"use client";
import { useState } from "react";
import { goldControlClassName } from "@/components/forge/forgeMetallicTheme";
import { useStaleWhileRevalidate } from "@/hooks/useStaleWhileRevalidate";
import { ForgeEmptyState, ForgeErrorState, ForgeLoadingState } from "@/components/forge/ForgeStates";

async function fetchAnimals() {
  const response = await fetch("/api/rental");
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Unable to load animal requests.");
  return body.animals || [];
}

export default function RentalAnimalsPanel() {
  // Stale-while-revalidate: the last loaded animal list stays on screen while a
  // refresh (review save, retry) runs in the background -- the list never
  // blanks out from under the reviewer.
  const { data: animals, error: loadError, isLoading, isRefreshing, refresh } = useStaleWhileRevalidate(
    "rental:animals",
    fetchAnimals,
    { ttlMs: 60_000 },
  );
  const [message, setMessage] = useState("");

  async function review(event, id, kind) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const assistance = kind === "assistance_review_requested";
    const decision = form.get("decision");
    const response = await fetch("/api/rental", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operation: "review-animal",
        animalId: id,
        decision,
        classification: assistance ? (decision === "approved" ? "assistance_animal_approved" : "assistance_request_denied") : "pet",
        approvalEvidenceId: form.get("approvalEvidenceId"),
        monthlyFeeCents: !assistance && decision === "approved" ? Math.round(Number(form.get("monthlyFee")) * 100) : null,
        effectiveStartDate: !assistance ? form.get("effectiveStartDate") || null : null,
      }),
    });
    const body = await response.json();
    setMessage(response.ok ? "Animal review saved." : body.error);
    if (response.ok) await refresh();
  }

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <p className="text-xs font-black uppercase tracking-[0.2em] text-sky-700 dark:text-sky-400">Animals</p>
      <h2 className="mt-1 text-3xl font-black tracking-tight text-slate-950 dark:text-white">Pet approvals and assistance review</h2>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">Pet fees are available only after explicit pet approval. Assistance requests require a human decision and can never receive a pet fee through this workflow.</p>

      {!animals && isLoading ? <div className="mt-4"><ForgeLoadingState label="Loading animal requests…" /></div> : null}

      {!animals && loadError ? (
        <div className="mt-4">
          <ForgeErrorState
            title="Unable to load animal requests."
            detail={loadError}
            onRetry={() => refresh()}
          />
        </div>
      ) : null}

      {animals ? animals.map((animal) => (
        <article key={animal.id} className="mt-4 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
          <strong className="text-slate-950 dark:text-white">{animal.name} · {animal.breed_description}</strong>
          <p className="text-sm text-slate-600 dark:text-slate-400">{animal.classification.replaceAll("_", " ")} · {animal.approval_status}</p>
          {animal.approval_status === "requested" ? (
            <form onSubmit={(event) => review(event, animal.id, animal.classification)} className="mt-3 grid gap-2 md:grid-cols-2">
              <select name="decision" className="rounded-lg border border-slate-300 bg-white p-2 dark:border-slate-600 dark:bg-slate-900 dark:text-white">
                <option value="approved">Approve</option>
                <option value="denied">Deny</option>
              </select>
              <input name="approvalEvidenceId" required placeholder="Approval/review evidence reference" className="rounded-lg border border-slate-300 bg-white p-2 dark:border-slate-600 dark:bg-slate-900 dark:text-white" />
              {animal.classification === "pet" ? (
                <>
                  <input name="monthlyFee" type="number" min="0.01" step="0.01" placeholder="Monthly fee (optional)" className="rounded-lg border border-slate-300 bg-white p-2 dark:border-slate-600 dark:bg-slate-900 dark:text-white" />
                  <input name="effectiveStartDate" type="date" className="rounded-lg border border-slate-300 bg-white p-2 dark:border-slate-600 dark:bg-slate-900 dark:text-white" />
                </>
              ) : (
                <p className="rounded-lg bg-violet-50 p-2 text-sm text-violet-900 dark:bg-violet-950/30 dark:text-violet-200">Human assistance-animal review; no pet fee.</p>
              )}
              <button className={`rounded-lg p-2 text-sm font-bold transition md:col-span-2 ${goldControlClassName}`}>Save review</button>
            </form>
          ) : null}
        </article>
      )) : null}

      {animals && animals.length === 0 ? (
        <div className="mt-4">
          <ForgeEmptyState headline="No animal requests." />
        </div>
      ) : null}

      {animals && isRefreshing ? (
        <p role="status" className="mt-3 text-xs font-bold text-slate-400 dark:text-slate-500">Updating…</p>
      ) : null}
      {animals && loadError ? (
        <p role="status" className="mt-3 text-xs font-bold text-slate-400 dark:text-slate-500">
          Could not refresh — showing the last saved animal requests.
        </p>
      ) : null}

      {message ? <p role="status" className="mt-3 text-sm font-bold text-slate-700 dark:text-slate-300">{message}</p> : null}
    </section>
  );
}
