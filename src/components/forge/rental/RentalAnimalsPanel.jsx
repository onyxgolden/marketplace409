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
  const [error, setError] = useState("");
  // Controls-sweep follow-up G22 (O-12): landlord-side recording for a
  // phone/paper case, plus re-review and revoke on decided animals.
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ leaseId: "", name: "", breedDescription: "", requestType: "pet" });
  const [leases, setLeases] = useState(null);

  async function openCreate() {
    if (showCreate) { setShowCreate(false); return; }
    setShowCreate(true);
    if (leases) return;
    try {
      const response = await fetch("/api/rental");
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to load leases.");
      setLeases((body.leases || []).filter((lease) => lease.status === "active").map((lease) => ({
        id: lease.id,
        label: (body.units || []).find((unit) => unit.id === lease.unit_id)?.label || lease.id,
      })));
    } catch (reason) { setError(reason.message); }
  }

  async function createAnimalRecord(event) {
    event.preventDefault();
    const response = await fetch("/api/rental", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operation: "create-animal",
        animal: { leaseId: createForm.leaseId, name: createForm.name, breedDescription: createForm.breedDescription, requestType: createForm.requestType },
      }),
    });
    const body = await response.json();
    if (response.ok) {
      setMessage("✓ Animal recorded — it is requested and ready for review.");
      setError("");
      setShowCreate(false);
      setCreateForm({ leaseId: "", name: "", breedDescription: "", requestType: "pet" });
      await refresh();
    } else { setError(body.error); setMessage(""); }
  }

  async function revoke(id) {
    const response = await fetch("/api/rental", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ operation: "revoke-animal", animalId: id }),
    });
    const body = await response.json();
    if (response.ok) { setMessage("✓ Approval revoked — the animal is denied and any active pet fee is ended."); setError(""); await refresh(); }
    else { setError(body.error); setMessage(""); }
  }

  async function review(event, id, kind) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const assistance = kind === "assistance_review_requested";
    const decision = form.get("decision");
    // Controls-sweep follow-up G22 (adjacent fix): a blank fee field used
    // to send 0 cents, which the review RPC rejects — so approving without
    // a fee errored despite the "optional" placeholder. Blank now sends
    // null (no fee); a filled fee still needs its start date per the RPC.
    const feeValue = form.get("monthlyFee");
    const response = await fetch("/api/rental", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operation: "review-animal",
        animalId: id,
        decision,
        classification: assistance ? (decision === "approved" ? "assistance_animal_approved" : "assistance_request_denied") : "pet",
        approvalEvidenceId: form.get("approvalEvidenceId"),
        monthlyFeeCents: !assistance && decision === "approved" && feeValue !== "" && feeValue !== null ? Math.round(Number(feeValue) * 100) : null,
        effectiveStartDate: !assistance ? form.get("effectiveStartDate") || null : null,
      }),
    });
    const body = await response.json();
    if (response.ok) {
      setMessage("✓ Animal review saved.");
      setError(body.feeEndError ? "The review saved, but the pet fee could not be ended — check the fee record." : "");
    } else { setError(body.error); setMessage(""); }
    if (response.ok) await refresh();
  }

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <p className="text-xs font-black uppercase tracking-[0.2em] text-sky-700 dark:text-sky-400">Animals</p>
      <h2 className="mt-1 text-3xl font-black tracking-tight text-slate-950 dark:text-white">Pet approvals and assistance review</h2>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">Pet fees are available only after explicit pet approval. Assistance requests require a human decision and can never receive a pet fee through this workflow.</p>

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={openCreate} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">{showCreate ? "Cancel recording" : "Record an animal"}</button>
      </div>

      {showCreate ? (
        <form onSubmit={createAnimalRecord} className="mt-4 grid gap-2 rounded-xl border border-slate-200 p-4 dark:border-slate-700 md:grid-cols-2">
          <p className="text-sm text-slate-600 dark:text-slate-400 md:col-span-2">For a phone/paper case — the animal lands as requested and ready for review. Dogs only: the animal record accepts dogs.</p>
          <select required value={createForm.leaseId} onChange={(event) => setCreateForm({ ...createForm, leaseId: event.target.value })} className="rounded-lg border border-slate-300 bg-white p-2 dark:border-slate-600 dark:bg-slate-900 dark:text-white">
            <option value="">Select an active lease</option>
            {(leases || []).map((lease) => <option key={lease.id} value={lease.id}>{lease.label}</option>)}
          </select>
          <select value={createForm.requestType} onChange={(event) => setCreateForm({ ...createForm, requestType: event.target.value })} className="rounded-lg border border-slate-300 bg-white p-2 dark:border-slate-600 dark:bg-slate-900 dark:text-white">
            <option value="pet">Pet</option>
            <option value="assistance_review_requested">Assistance review requested</option>
          </select>
          <input required value={createForm.name} onChange={(event) => setCreateForm({ ...createForm, name: event.target.value })} placeholder="Animal name" className="rounded-lg border border-slate-300 bg-white p-2 dark:border-slate-600 dark:bg-slate-900 dark:text-white" />
          <input required value={createForm.breedDescription} onChange={(event) => setCreateForm({ ...createForm, breedDescription: event.target.value })} placeholder="Breed description" className="rounded-lg border border-slate-300 bg-white p-2 dark:border-slate-600 dark:bg-slate-900 dark:text-white" />
          <button className={`rounded-lg p-2 text-sm font-bold transition md:col-span-2 ${goldControlClassName}`}>Record animal</button>
        </form>
      ) : null}

      {error ? (
        <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-800 dark:bg-red-950/40 dark:text-red-300">{error}</p>
      ) : null}

      {message ? <p role="status" className="mt-4 rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm font-bold text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">{message}</p> : null}

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
          {animal.approval_status !== "requested" ? (
            <div className="mt-3">
              <p className="text-sm text-slate-600 dark:text-slate-400">
                Decided — this decision is not final: use the form below to re-review (a new decision replaces this one;
                approving with a fee updates the monthly fee).
              </p>
              {animal.approval_status === "approved" ? (
                <button type="button" onClick={() => revoke(animal.id)} className="mt-2 rounded-lg border border-red-300 px-3 py-2 text-sm font-bold text-red-600 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-950">Revoke approval</button>
              ) : null}
            </div>
          ) : null}
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

    </section>
  );
}
