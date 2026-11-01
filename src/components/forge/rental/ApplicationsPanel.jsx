"use client";
import { useCallback, useEffect, useState } from "react";

// Rentec parity R21 — the application review queue. Applications submitted
// through the public form land here as pending (this queue IS the in-app
// "new application" notification). Approve creates a tenant record
// (status 'applicant') plus a draft lease on the listing's unit; deny
// requires a reason and both write append-only audit rows.

const STATUS_FILTERS = [["pending", "Pending"], ["approved", "Approved"], ["denied", "Denied"], ["withdrawn", "Withdrawn"]];
const STATUS_CLASS = {
  pending: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  approved: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200",
  denied: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  withdrawn: "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300",
};
const inputClass = "rounded-xl border border-slate-300 bg-white p-2.5 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-white";
const goldControlClass = "bg-amber-400 text-slate-950 hover:bg-amber-300";

function applicantName(answers) {
  const personal = answers?.personal || {};
  return [personal.firstName, personal.lastName].filter(Boolean).join(" ").trim() || personal.email || "Applicant";
}

export default function ApplicationsPanel() {
  const [filter, setFilter] = useState("pending");
  const [applications, setApplications] = useState([]);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [denyReason, setDenyReason] = useState("");
  const [leaseDraft, setLeaseDraft] = useState({ startDate: "", monthlyRentCents: "", rentDueDay: "1", endDate: "" });
  // Controls-sweep follow-up G21 (O-11): paper entry + finality paths.
  const [listings, setListings] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ listingId: "", firstName: "", lastName: "", email: "", phone: "" });
  const [reopenReason, setReopenReason] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const load = useCallback(async (statusFilter) => {
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/rental/applications?status=${encodeURIComponent(statusFilter)}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to load applications.");
      setApplications(body.applications || []);
    } catch (reason) { setError(reason.message); }
    finally { setLoading(false); }
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch when the queue opens or the filter changes.
  useEffect(() => { load(filter); }, [load, filter]);

  async function openDetail(id) {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/rental/applications/${encodeURIComponent(id)}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to load the application.");
      setDetail(body);
      setDenyReason("");
      setConfirmingDelete(false);
      setReopenReason("");
      setLeaseDraft({ startDate: "", monthlyRentCents: body.listing?.rentCents ?? "", rentDueDay: "1", endDate: "" });
    } catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
  }

  async function decide(action) {
    if (action === "deny" && !denyReason.trim()) { setError("A denial reason is required."); return; }
    if (action === "approve" && !leaseDraft.startDate) { setError("A lease start date is required to approve."); return; }
    setBusy(true); setError(""); setMessage("");
    try {
      const payload = action === "deny"
        ? { action, reason: denyReason.trim() }
        : {
            action,
            lease: {
              startDate: leaseDraft.startDate,
              endDate: leaseDraft.endDate || undefined,
              monthlyRentCents: leaseDraft.monthlyRentCents === "" ? undefined : Number(leaseDraft.monthlyRentCents),
              rentDueDay: Number(leaseDraft.rentDueDay) || 1,
            },
          };
      const response = await fetch(`/api/rental/applications/${encodeURIComponent(detail.application.id)}/decision`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to record the decision.");
      setDetail(null);
      setMessage(action === "approve"
        ? "Approved — tenant record and draft lease created. Finalize the lease in the normal lease flow."
        : "Denied — the reason is on the audit record.");
      await load(filter);
    } catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
  }

  async function manage(action, extra = {}) {
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/rental/applications/${encodeURIComponent(detail.application.id)}/manage`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, ...extra }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to change the application.");
      setDetail(null);
      setConfirmingDelete(false);
      setReopenReason("");
      setMessage(action === "reopen"
        ? "Application reopened — it is pending again."
        : "Application deleted.");
      await load(filter);
    } catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
  }

  async function openCreate() {
    if (showCreate) { setShowCreate(false); return; }
    setShowCreate(true);
    if (listings) return;
    try {
      const response = await fetch("/api/rental/listings");
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to load listings.");
      setListings(body.listings || []);
    } catch (reason) { setError(reason.message); }
  }

  async function createApplication(event) {
    event.preventDefault();
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/rental/applications", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          listingId: createForm.listingId,
          answers: { personal: {
            firstName: createForm.firstName.trim(), lastName: createForm.lastName.trim(),
            email: createForm.email.trim(), phone: createForm.phone.trim(),
          } },
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to create the application.");
      setShowCreate(false);
      setCreateForm({ listingId: "", firstName: "", lastName: "", email: "", phone: "" });
      setMessage("Paper application entered — it is pending in the queue.");
      setFilter("pending");
      await load("pending");
    } catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
  }

  function renderAnswers(answers) {
    const sections = [];
    if (answers?.personal) sections.push(["Personal info", [
      ["Name", [answers.personal.firstName, answers.personal.lastName].filter(Boolean).join(" ")],
      ["Email", answers.personal.email], ["Phone", answers.personal.phone], ["Date of birth", answers.personal.dateOfBirth],
    ]]);
    if (answers?.residence?.current) {
      const residence = answers.residence.current;
      sections.push(["Current residence", [
        ["Address", [residence.address, residence.city, residence.state, residence.zip].filter(Boolean).join(", ")],
        ["Landlord", residence.landlordName], ["Landlord phone", residence.landlordPhone],
        ["Monthly rent", residence.monthlyRent], ["Since", residence.fromDate],
      ]]);
    }
    if (answers?.employment?.current) {
      const job = answers.employment.current;
      sections.push(["Current employment", [
        ["Employer", job.employerName], ["Title", job.jobTitle],
        ["Monthly income", job.monthlyIncome], ["Supervisor", job.supervisorName], ["Phone", job.phone],
      ]]);
    }
    if (Array.isArray(answers?.references) && answers.references.length) {
      sections.push(["References", answers.references.map((ref, index) => [`#${index + 1}`, `${ref.name || ""} (${ref.relationship || "—"}) — ${ref.phone || ""}`])]);
    }
    const customEntries = Object.entries(answers?.custom || {});
    if (customEntries.length) sections.push(["Custom questions", customEntries.map(([key, value]) => [key, String(value)])]);
    return (
      <div className="grid gap-3">
        {sections.map(([title, rows]) => (
          <div key={title} className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
            <p className="text-xs font-black uppercase tracking-wider text-slate-500">{title}</p>
            <dl className="mt-1 grid gap-1 text-sm">
              {rows.map(([label, value]) => (
                <div key={label} className="flex gap-2"><dt className="w-32 shrink-0 font-bold text-slate-600 dark:text-slate-400">{label}</dt><dd className="text-slate-900 dark:text-slate-100">{value || "—"}</dd></div>
              ))}
            </dl>
          </div>
        ))}
        <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
          <p className="text-xs font-black uppercase tracking-wider text-slate-500">Screening consent</p>
          <p className="mt-1 text-sm text-slate-900 dark:text-slate-100">{answers?.consent === true ? "Given — screening checks are R22, not this slice." : "Missing"}</p>
          {detail?.application?.feeAmountCents > 0 ? <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Application fee recorded: ${(detail.application.feeAmountCents / 100).toFixed(2)} (collect offline — no live collection in this slice).</p> : null}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-sky-700 dark:text-sky-400">Leasing</p>
          <h2 className="mt-1 text-3xl font-black tracking-tight text-slate-950 dark:text-white">Applications</h2>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">Review queue — online applications arrive here as pending.</p>
        </div>
        <button type="button" onClick={openCreate} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">
          {showCreate ? "Cancel paper entry" : "Enter a paper application"}
        </button>
      </div>
      {showCreate && (
        <form onSubmit={createApplication} className="mt-4 grid gap-2 rounded-2xl border border-slate-200 p-4 dark:border-slate-700 md:grid-cols-2">
          <p className="text-sm text-slate-600 dark:text-slate-400 md:col-span-2">For an applicant who applied on paper instead of the online form. The entry lands in the queue as pending.</p>
          <label className="text-sm font-bold text-slate-900 dark:text-white">Listing
            <select required value={createForm.listingId} onChange={(e) => setCreateForm({ ...createForm, listingId: e.target.value })} className={`${inputClass} mt-1 w-full`}>
              <option value="">Select a listing</option>
              {(listings || []).map((listing) => <option key={listing.id} value={listing.id}>{listing.title || listing.id} ({listing.status})</option>)}
            </select>
          </label>
          <label className="text-sm font-bold text-slate-900 dark:text-white">Email
            <input type="email" value={createForm.email} onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })} className={`${inputClass} mt-1 w-full`} placeholder="applicant@example.com" />
          </label>
          <label className="text-sm font-bold text-slate-900 dark:text-white">First name
            <input value={createForm.firstName} onChange={(e) => setCreateForm({ ...createForm, firstName: e.target.value })} className={`${inputClass} mt-1 w-full`} />
          </label>
          <label className="text-sm font-bold text-slate-900 dark:text-white">Last name
            <input value={createForm.lastName} onChange={(e) => setCreateForm({ ...createForm, lastName: e.target.value })} className={`${inputClass} mt-1 w-full`} />
          </label>
          <label className="text-sm font-bold text-slate-900 dark:text-white md:col-span-2">Phone
            <input value={createForm.phone} onChange={(e) => setCreateForm({ ...createForm, phone: e.target.value })} className={`${inputClass} mt-1 w-full`} />
          </label>
          <button type="submit" disabled={busy} className={`rounded-xl px-4 py-2 text-sm font-bold transition md:col-span-2 ${goldControlClass}`}>Enter application</button>
        </form>
      )}
      <div className="mt-4 flex flex-wrap gap-2" role="tablist" aria-label="Application status">
        {STATUS_FILTERS.map(([value, label]) => (
          <button key={value} type="button" role="tab" aria-selected={filter === value} onClick={() => setFilter(value)}
            className={`rounded-xl px-4 py-2 text-sm font-bold transition ${filter === value ? goldControlClass : "border border-slate-300 text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"}`}>
            {label}
          </button>
        ))}
      </div>
      {error ? <p role="alert" className="mt-3 text-sm font-bold text-red-600 dark:text-red-400">{error}</p> : null}
      {message ? <p role="status" className="mt-3 text-sm font-bold text-emerald-700 dark:text-emerald-400">{message}</p> : null}
      {loading ? <p className="mt-4 text-sm text-slate-500">Loading…</p> : null}
      {!loading && (
        <div className="mt-4 grid gap-3">
          {applications.length === 0 ? <p className="text-sm text-slate-500">No {filter} applications.</p> : null}
          {applications.map((application) => (
            <button key={application.id} type="button" onClick={() => openDetail(application.id)}
              className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white p-4 text-left hover:border-amber-300 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-amber-600">
              <div>
                <p className="font-black text-slate-950 dark:text-white">{applicantName(application.answers)}</p>
                <p className="text-xs text-slate-500">{application.listing?.title || "Listing"} · submitted {new Date(application.submittedAt).toLocaleDateString()}</p>
              </div>
              <span className={`rounded-full px-3 py-1 text-xs font-black ${STATUS_CLASS[application.status]}`}>{application.status}</span>
            </button>
          ))}
        </div>
      )}

      {detail ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4" role="dialog" aria-label="Application review">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-2xl bg-white p-6 dark:bg-slate-900">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-xl font-black text-slate-950 dark:text-white">{applicantName(detail.application.answers)}</h3>
                <p className="text-xs text-slate-500">{detail.listing?.title} · submitted {new Date(detail.application.submittedAt).toLocaleString()}</p>
              </div>
              <span className={`rounded-full px-3 py-1 text-xs font-black ${STATUS_CLASS[detail.application.status]}`}>{detail.application.status}</span>
            </div>
            <div className="mt-4">{renderAnswers(detail.application.answers)}</div>
            {detail.decisions?.length ? (
              <div className="mt-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                <p className="text-xs font-black uppercase tracking-wider text-slate-500">Decision history</p>
                {detail.decisions.map((decision) => (
                  <p key={decision.id} className="mt-1 text-sm text-slate-700 dark:text-slate-300">
                    {decision.action} · {new Date(decision.created_at).toLocaleString()}{decision.reason ? ` — ${decision.reason}` : ""}
                  </p>
                ))}
              </div>
            ) : null}
            {detail.application.status === "pending" ? (
              <div className="mt-4 grid gap-3 rounded-2xl border border-slate-200 p-4 dark:border-slate-700">
                <p className="text-sm font-black text-slate-950 dark:text-white">Approve — draft lease terms</p>
                <div className="grid gap-2 md:grid-cols-2">
                  <label className="text-sm font-bold text-slate-900 dark:text-white">Start date
                    <input type="date" value={leaseDraft.startDate} onChange={(e) => setLeaseDraft({ ...leaseDraft, startDate: e.target.value })} className={`${inputClass} mt-1 w-full`} />
                  </label>
                  <label className="text-sm font-bold text-slate-900 dark:text-white">End date (optional)
                    <input type="date" value={leaseDraft.endDate} onChange={(e) => setLeaseDraft({ ...leaseDraft, endDate: e.target.value })} className={`${inputClass} mt-1 w-full`} />
                  </label>
                  <label className="text-sm font-bold text-slate-900 dark:text-white">Monthly rent (cents)
                    <input type="number" min="1" value={leaseDraft.monthlyRentCents} onChange={(e) => setLeaseDraft({ ...leaseDraft, monthlyRentCents: e.target.value })} className={`${inputClass} mt-1 w-full`} placeholder="Listing rent" />
                  </label>
                  <label className="text-sm font-bold text-slate-900 dark:text-white">Rent due day
                    <input type="number" min="1" max="28" value={leaseDraft.rentDueDay} onChange={(e) => setLeaseDraft({ ...leaseDraft, rentDueDay: e.target.value })} className={`${inputClass} mt-1 w-full`} />
                  </label>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => decide("approve")} disabled={busy} className={`rounded-xl px-4 py-2 text-sm font-bold transition ${goldControlClass}`}>Approve — create tenant + lease draft</button>
                </div>
                <label className="text-sm font-bold text-slate-900 dark:text-white">Deny with reason
                  <input value={denyReason} onChange={(e) => setDenyReason(e.target.value)} className={`${inputClass} mt-1 w-full`} placeholder="Reason stored on the audit record" />
                </label>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => decide("deny")} disabled={busy} className="rounded-xl border border-red-300 px-4 py-2 text-sm font-bold text-red-600 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-950">Deny application</button>
                </div>
                {!confirmingDelete ? (
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => setConfirmingDelete(true)} className="rounded-xl border border-red-300 px-4 py-2 text-sm font-bold text-red-600 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-950">Delete application</button>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-bold text-red-700 dark:text-red-300">Delete this pending application? Spam and duplicates only — this cannot be undone.</p>
                    <button type="button" onClick={() => manage("delete")} disabled={busy} className="rounded-xl bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-700">Yes, delete</button>
                    <button type="button" onClick={() => setConfirmingDelete(false)} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 dark:border-slate-600 dark:text-slate-300">Keep it</button>
                  </div>
                )}
              </div>
            ) : null}
            {detail.application.status !== "pending" ? (
              <div className="mt-4 grid gap-3 rounded-2xl border border-slate-200 p-4 dark:border-slate-700">
                {detail.application.status === "approved" ? (
                  <p className="text-sm text-slate-700 dark:text-slate-300">
                    This application was approved — the tenant record and draft lease already exist, so it cannot be
                    reopened or deleted here.
                  </p>
                ) : null}
                {(detail.application.status === "denied" || detail.application.status === "withdrawn") ? (
                  <>
                    <label className="text-sm font-bold text-slate-900 dark:text-white">Reason for reopening (optional)
                      <input value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} className={`${inputClass} mt-1 w-full`} placeholder="Stored on the audit record" />
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={() => manage("reopen", { reason: reopenReason.trim() || undefined })} disabled={busy} className={`rounded-xl px-4 py-2 text-sm font-bold transition ${goldControlClass}`}>Reopen application</button>
                    </div>
                    {detail.application.status === "denied" ? (
                      <p className="text-sm text-slate-600 dark:text-slate-400">Denied applications stay on the audit record and cannot be deleted — reopen it to review again.</p>
                    ) : null}
                  </>
                ) : null}
                {(detail.application.status === "withdrawn") ? (
                  <>
                    {!confirmingDelete ? (
                      <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={() => setConfirmingDelete(true)} className="rounded-xl border border-red-300 px-4 py-2 text-sm font-bold text-red-600 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-950">Delete application</button>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-bold text-red-700 dark:text-red-300">Delete this withdrawn application? This cannot be undone.</p>
                        <button type="button" onClick={() => manage("delete")} disabled={busy} className="rounded-xl bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-700">Yes, delete</button>
                        <button type="button" onClick={() => setConfirmingDelete(false)} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 dark:border-slate-600 dark:text-slate-300">Keep it</button>
                      </div>
                    )}
                  </>
                ) : null}
              </div>
            ) : null}
            <div className="mt-4 flex justify-end">
              <button type="button" onClick={() => setDetail(null)} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 dark:border-slate-600 dark:text-slate-300">Close</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
