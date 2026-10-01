"use client";
import { useEffect, useState } from "react";

// Rentec parity R21 — the public listing page (/rentals/<slug>). No login.
// Shows the listing (photos, description, rent, beds/baths, pet policy) and
// the "Apply now" form driven by the owner's application-form config.
// Spam guards: honeypot + server-side per-IP rate limit. The application fee
// is record-only — this page never collects money.

const inputClass = "rounded-xl border border-slate-300 bg-white p-2.5 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-white";
const goldControlClass = "bg-amber-400 text-slate-950 hover:bg-amber-300";

const emptyPersonal = { firstName: "", lastName: "", email: "", phone: "", dateOfBirth: "" };
const emptyResidence = { address: "", city: "", state: "", zip: "", landlordName: "", landlordPhone: "", monthlyRent: "", fromDate: "" };
const emptyJob = { employerName: "", jobTitle: "", monthlyIncome: "", supervisorName: "", phone: "", startDate: "" };

function money(cents) {
  if (cents === null || cents === undefined) return "";
  return `$${(Number(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
}

export default function RentalListingPublic({ slug, initialTab = "listing" }) {
  const [tab, setTab] = useState(initialTab);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [personal, setPersonal] = useState(emptyPersonal);
  const [residence, setResidence] = useState(emptyResidence);
  const [job, setJob] = useState(emptyJob);
  const [references, setReferences] = useState([{ name: "", relationship: "", phone: "" }]);
  const [custom, setCustom] = useState({});
  const [consent, setConsent] = useState(false);
  const [honeypot, setHoneypot] = useState("");

  useEffect(() => {
    async function load() {
      setLoading(true); setError("");
      try {
        const response = await fetch(`/api/public/rental-listings/${encodeURIComponent(slug)}`);
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Listing was not found.");
        setData(body);
      } catch (reason) { setError(reason.message); }
      finally { setLoading(false); }
    }
    load();
  }, [slug]);

  async function submit(event) {
    event.preventDefault();
    setSubmitting(true); setError("");
    try {
      const answers = {
        personal,
        residence: { current: residence },
        employment: { current: job },
        references: references.filter((ref) => ref.name.trim() || ref.phone.trim()),
        custom, consent,
      };
      const response = await fetch(`/api/public/rental-listings/${encodeURIComponent(slug)}/apply`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ answers, company: honeypot }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to submit the application.");
      setSubmitted(true);
    } catch (reason) { setError(reason.message); }
    finally { setSubmitting(false); }
  }

  if (loading) return <main className="mx-auto max-w-3xl p-6"><p className="text-sm text-slate-500">Loading the listing…</p></main>;
  if (error && !data) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <h1 className="text-2xl font-black text-slate-950 dark:text-white">Listing not available</h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{error}</p>
      </main>
    );
  }

  const { listing, form } = data;
  const sections = form?.sections || { personal_info: true, residence_history: true, employment: true, references: true };
  const customQuestions = form?.customQuestions || [];

  function field(label, value, onChange, props = {}) {
    return (
      <label className="text-sm font-bold text-slate-900 dark:text-white">{label}
        <input value={value} onChange={(e) => onChange(e.target.value)} className={`${inputClass} mt-1 w-full`} {...props} />
      </label>
    );
  }

  return (
    <main className="mx-auto max-w-3xl p-6">
      <p className="text-xs font-black uppercase tracking-[0.2em] text-sky-700 dark:text-sky-400">For rent</p>
      <h1 className="mt-1 text-3xl font-black tracking-tight text-slate-950 dark:text-white">{listing.title}</h1>
      <p className="mt-2 text-lg font-bold text-slate-700 dark:text-slate-300">
        {money(listing.rentCents)}{listing.rentCents ? "/mo" : ""}
        {listing.bedsDisplay ? ` · ${listing.bedsDisplay} bed` : ""}
        {listing.bathsDisplay ? ` · ${listing.bathsDisplay} bath` : ""}
        {listing.squareFeet ? ` · ${listing.squareFeet} sqft` : ""}
      </p>

      <div className="mt-4 flex gap-2" role="tablist" aria-label="Listing or application">
        <button type="button" role="tab" aria-selected={tab === "listing"} onClick={() => setTab("listing")}
          className={`rounded-xl px-4 py-2 text-sm font-bold ${tab === "listing" ? goldControlClass : "border border-slate-300 dark:border-slate-600"}`}>Listing</button>
        <button type="button" role="tab" aria-selected={tab === "apply"} onClick={() => setTab("apply")}
          className={`rounded-xl px-4 py-2 text-sm font-bold ${tab === "apply" ? goldControlClass : "border border-slate-300 dark:border-slate-600"}`}>Apply now</button>
      </div>

      {tab === "listing" ? (
        <div className="mt-4">
          {listing.photos?.length ? (
            <div className="grid gap-2 md:grid-cols-2">
              {listing.photos.map((photo) => (
                <img key={photo.index} src={photo.url} alt={`${listing.title} photo ${photo.index + 1}`} className="w-full rounded-2xl object-cover" />
              ))}
            </div>
          ) : null}
          {listing.description ? <p className="mt-4 whitespace-pre-wrap text-slate-700 dark:text-slate-300">{listing.description}</p> : null}
          <dl className="mt-4 grid gap-2 rounded-2xl border border-slate-200 p-4 text-sm dark:border-slate-700">
            {listing.petPolicy ? <div className="flex gap-2"><dt className="w-28 shrink-0 font-bold text-slate-500">Pet policy</dt><dd>{listing.petPolicy}</dd></div> : null}
            {listing.availableAt ? <div className="flex gap-2"><dt className="w-28 shrink-0 font-bold text-slate-500">Available</dt><dd>{new Date(listing.availableAt).toLocaleDateString()}</dd></div> : null}
            {listing.contactEmail ? <div className="flex gap-2"><dt className="w-28 shrink-0 font-bold text-slate-500">Contact</dt><dd><a className="text-sky-700 underline dark:text-sky-400" href={`mailto:${listing.contactEmail}`}>{listing.contactEmail}</a></dd></div> : null}
            {listing.contactPhone ? <div className="flex gap-2"><dt className="w-28 shrink-0 font-bold text-slate-500">Phone</dt><dd>{listing.contactPhone}</dd></div> : null}
          </dl>
          <button type="button" onClick={() => setTab("apply")} className={`mt-4 rounded-xl px-6 py-3 text-base font-bold transition ${goldControlClass}`}>Apply now</button>
        </div>
      ) : submitted ? (
        <div className="mt-4 rounded-2xl border border-emerald-300 bg-emerald-50 p-6 dark:border-emerald-700 dark:bg-emerald-950/40">
          <h2 className="text-xl font-black text-emerald-900 dark:text-emerald-200">Application received</h2>
          <p className="mt-2 text-sm text-emerald-800 dark:text-emerald-300">Thanks — the property owner will review it and be in touch. No payment was collected.</p>
        </div>
      ) : (
        <form onSubmit={submit} className="mt-4 grid gap-4" aria-label="Rental application">
          {error ? <p role="alert" className="text-sm font-bold text-red-600 dark:text-red-400">{error}</p> : null}
          {sections.personal_info !== false ? (
            <fieldset className="rounded-2xl border border-slate-200 p-4 dark:border-slate-700">
              <legend className="px-2 text-sm font-black text-slate-900 dark:text-white">Personal info</legend>
              <div className="grid gap-3 md:grid-cols-2">
                {field("First name", personal.firstName, (v) => setPersonal({ ...personal, firstName: v }), { required: true })}
                {field("Last name", personal.lastName, (v) => setPersonal({ ...personal, lastName: v }), { required: true })}
                {field("Email", personal.email, (v) => setPersonal({ ...personal, email: v }), { required: true, type: "email" })}
                {field("Phone", personal.phone, (v) => setPersonal({ ...personal, phone: v }), { required: true, type: "tel" })}
                {field("Date of birth", personal.dateOfBirth, (v) => setPersonal({ ...personal, dateOfBirth: v }), { type: "date" })}
              </div>
            </fieldset>
          ) : null}
          {sections.residence_history !== false ? (
            <fieldset className="rounded-2xl border border-slate-200 p-4 dark:border-slate-700">
              <legend className="px-2 text-sm font-black text-slate-900 dark:text-white">Current residence</legend>
              <div className="grid gap-3 md:grid-cols-2">
                {field("Street address", residence.address, (v) => setResidence({ ...residence, address: v }), { required: true })}
                {field("City", residence.city, (v) => setResidence({ ...residence, city: v }), { required: true })}
                {field("State", residence.state, (v) => setResidence({ ...residence, state: v }), { required: true })}
                {field("ZIP", residence.zip, (v) => setResidence({ ...residence, zip: v }))}
                {field("Landlord / manager", residence.landlordName, (v) => setResidence({ ...residence, landlordName: v }), { required: true })}
                {field("Landlord phone", residence.landlordPhone, (v) => setResidence({ ...residence, landlordPhone: v }), { type: "tel" })}
                {field("Monthly rent", residence.monthlyRent, (v) => setResidence({ ...residence, monthlyRent: v }), { type: "number", min: "0" })}
                {field("Living here since", residence.fromDate, (v) => setResidence({ ...residence, fromDate: v }), { type: "date" })}
              </div>
            </fieldset>
          ) : null}
          {sections.employment !== false ? (
            <fieldset className="rounded-2xl border border-slate-200 p-4 dark:border-slate-700">
              <legend className="px-2 text-sm font-black text-slate-900 dark:text-white">Current employment</legend>
              <div className="grid gap-3 md:grid-cols-2">
                {field("Employer", job.employerName, (v) => setJob({ ...job, employerName: v }), { required: true })}
                {field("Job title", job.jobTitle, (v) => setJob({ ...job, jobTitle: v }), { required: true })}
                {field("Monthly income", job.monthlyIncome, (v) => setJob({ ...job, monthlyIncome: v }), { type: "number", min: "0" })}
                {field("Supervisor", job.supervisorName, (v) => setJob({ ...job, supervisorName: v }))}
                {field("Work phone", job.phone, (v) => setJob({ ...job, phone: v }), { type: "tel" })}
                {field("Started", job.startDate, (v) => setJob({ ...job, startDate: v }), { type: "date" })}
              </div>
            </fieldset>
          ) : null}
          {sections.references !== false ? (
            <fieldset className="rounded-2xl border border-slate-200 p-4 dark:border-slate-700">
              <legend className="px-2 text-sm font-black text-slate-900 dark:text-white">References</legend>
              <div className="grid gap-3">
                {references.map((ref, index) => (
                  <div key={index} className="grid gap-3 rounded-xl border border-dashed border-slate-300 p-3 dark:border-slate-600 md:grid-cols-3">
                    {field("Name", ref.name, (v) => setReferences(references.map((r, i) => (i === index ? { ...r, name: v } : r))), { required: index === 0 })}
                    {field("Relationship", ref.relationship, (v) => setReferences(references.map((r, i) => (i === index ? { ...r, relationship: v } : r))))}
                    {field("Phone", ref.phone, (v) => setReferences(references.map((r, i) => (i === index ? { ...r, phone: v } : r))), { required: index === 0, type: "tel" })}
                  </div>
                ))}
                <button type="button" onClick={() => setReferences([...references, { name: "", relationship: "", phone: "" }])} className="justify-self-start rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-bold dark:border-slate-600">Add another reference</button>
              </div>
            </fieldset>
          ) : null}
          {customQuestions.length ? (
            <fieldset className="rounded-2xl border border-slate-200 p-4 dark:border-slate-700">
              <legend className="px-2 text-sm font-black text-slate-900 dark:text-white">Additional questions</legend>
              <div className="grid gap-3">
                {customQuestions.map((question) => (
                  <label key={question.key} className="text-sm font-bold text-slate-900 dark:text-white">{question.label}{question.required ? " *" : ""}
                    {question.type === "textarea" ? (
                      <textarea value={custom[question.key] || ""} onChange={(e) => setCustom({ ...custom, [question.key]: e.target.value })} required={question.required} rows={3} className={`${inputClass} mt-1 w-full`} />
                    ) : question.type === "select" ? (
                      <select value={custom[question.key] || ""} onChange={(e) => setCustom({ ...custom, [question.key]: e.target.value })} required={question.required} className={`${inputClass} mt-1 w-full`}>
                        <option value="">Select…</option>
                        {(question.options || []).map((option) => <option key={option} value={option}>{option}</option>)}
                      </select>
                    ) : question.type === "checkbox" ? (
                      <input type="checkbox" checked={!!custom[question.key]} onChange={(e) => setCustom({ ...custom, [question.key]: e.target.checked })} className="ml-2 h-5 w-5" />
                    ) : (
                      <input value={custom[question.key] || ""} onChange={(e) => setCustom({ ...custom, [question.key]: e.target.value })} required={question.required} className={`${inputClass} mt-1 w-full`} />
                    )}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}
          <fieldset className="rounded-2xl border border-slate-200 p-4 dark:border-slate-700">
            <legend className="px-2 text-sm font-black text-slate-900 dark:text-white">Consent</legend>
            <label className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} required className="mt-1 h-5 w-5" />
              <span>{form?.consentText || "I authorize the property owner to run tenant screening as part of this application."}</span>
            </label>
            {form?.feeAmountCents > 0 ? <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">Application fee: {money(form.feeAmountCents)} — recorded with your application and collected offline. Nothing is charged here.</p> : null}
          </fieldset>
          <input type="text" name="company" value={honeypot} onChange={(e) => setHoneypot(e.target.value)} tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />
          <button type="submit" disabled={submitting} className={`rounded-xl px-6 py-3 text-base font-bold transition ${goldControlClass}`}>{submitting ? "Submitting…" : "Submit application"}</button>
        </form>
      )}
    </main>
  );
}
