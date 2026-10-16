"use client";

import { useState } from "react";
import { validateNmlsFormat } from "@/lib/dscr/listings";

const inputClass =
  "w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-green-600";
const labelClass = "block text-sm font-semibold";

const PROPERTY_TYPES = ["SFR", "2-4 unit", "5+ unit"];
const TRANSACTION_TYPES = ["purchase", "rate-term refinance", "cash-out refinance"];
const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY","DC",
];

function MultiCheck({ options, values, onChange, label }) {
  return (
    <fieldset>
      <legend className={labelClass}>{label}</legend>
      <div className="mt-1 flex flex-wrap gap-2">
        {options.map((o) => (
          <label
            key={o}
            className="inline-flex items-center gap-1 text-sm border rounded-lg px-2 py-1 cursor-pointer"
          >
            <input
              type="checkbox"
              checked={values.includes(o)}
              onChange={() =>
                onChange(
                  values.includes(o)
                    ? values.filter((v) => v !== o)
                    : [...values, o]
                )
              }
            />
            {o}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export default function DscrSubmitForm() {
  const [form, setForm] = useState({
    company_name: "",
    nmls_number: "",
    states_served: [],
    min_loan_amount: "",
    max_loan_amount: "",
    property_types: [],
    transaction_types: [],
    occupancy_entity_restrictions: "",
    max_ltv: "",
    min_credit_score_claim: "",
    prepayment_penalty_availability: "",
    min_dscr_accepted: "",
    contact_name: "",
    contact_phone: "",
    contact_email: "",
    application_url: "",
  });
  const [nmlsError, setNmlsError] = useState(null);
  const [submitError, setSubmitError] = useState(null);
  const [submitted, setSubmitted] = useState(false);

  const set = (k) => (e) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function onSubmit(e) {
    e.preventDefault();
    setSubmitError(null);

    const nmls = validateNmlsFormat(form.nmls_number);
    if (!nmls.valid) {
      setNmlsError(nmls.error);
      return;
    }
    setNmlsError(null);

    const payload = {
      ...form,
      nmls_number: nmls.normalized,
      min_loan_amount: form.min_loan_amount ? Number(form.min_loan_amount) : null,
      max_loan_amount: form.max_loan_amount ? Number(form.max_loan_amount) : null,
      max_ltv: form.max_ltv ? Number(form.max_ltv) : null,
      min_credit_score_claim: form.min_credit_score_claim
        ? Number(form.min_credit_score_claim)
        : null,
      min_dscr_accepted: form.min_dscr_accepted
        ? Number(form.min_dscr_accepted)
        : null,
    };

    const res = await fetch("/api/dscr-lenders/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setSubmitError(body.error || "Submission failed. Please try again.");
      return;
    }
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <div className="bg-green-50 border border-green-300 rounded-2xl p-8 text-center">
        <h2 className="text-2xl font-extrabold text-green-900">
          Submitted for review
        </h2>
        <p className="text-green-900 mt-2">
          Your listing is queued for directory review. It will not appear
          publicly until an administrator approves it. We will contact you at
          the details you provided.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="bg-white rounded-2xl shadow p-6 md:p-8 space-y-5">
      <div className="bg-amber-50 border border-amber-300 rounded-xl p-4 text-sm text-amber-900">
        A syntactically valid NMLS number does not verify your company or your
        terms. Approval requires directory review — submissions never go live
        automatically.
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <label className={labelClass}>
          Company name *
          <input required value={form.company_name} onChange={set("company_name")} className={inputClass + " mt-1 font-normal"} />
        </label>
        <label className={labelClass}>
          NMLS company number *
          <input
            required
            value={form.nmls_number}
            onChange={(e) => {
              set("nmls_number")(e);
              setNmlsError(null);
            }}
            className={inputClass + " mt-1 font-normal"}
            placeholder="e.g. 1660690"
            inputMode="numeric"
          />
          {nmlsError && <span className="text-red-700 text-xs font-normal">{nmlsError}</span>}
        </label>
      </div>

      <MultiCheck
        label="States served *"
        options={US_STATES}
        values={form.states_served}
        onChange={(v) => setForm((f) => ({ ...f, states_served: v }))}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <label className={labelClass}>
          Minimum loan amount ($)
          <input type="number" min="0" value={form.min_loan_amount} onChange={set("min_loan_amount")} className={inputClass + " mt-1 font-normal"} />
        </label>
        <label className={labelClass}>
          Maximum loan amount ($)
          <input type="number" min="0" value={form.max_loan_amount} onChange={set("max_loan_amount")} className={inputClass + " mt-1 font-normal"} />
        </label>
      </div>

      <MultiCheck
        label="Property types"
        options={PROPERTY_TYPES}
        values={form.property_types}
        onChange={(v) => setForm((f) => ({ ...f, property_types: v }))}
      />

      <MultiCheck
        label="Transaction types"
        options={TRANSACTION_TYPES}
        values={form.transaction_types}
        onChange={(v) => setForm((f) => ({ ...f, transaction_types: v }))}
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <label className={labelClass}>
          Minimum DSCR accepted (e.g. 1.20)
          <input type="number" min="0" step="0.01" value={form.min_dscr_accepted} onChange={set("min_dscr_accepted")} className={inputClass + " mt-1 font-normal"} />
        </label>
        <label className={labelClass}>
          Maximum LTV (%)
          <input type="number" min="0" max="100" value={form.max_ltv} onChange={set("max_ltv")} className={inputClass + " mt-1 font-normal"} />
        </label>
        <label className={labelClass}>
          Minimum credit score claimed
          <input type="number" min="300" max="850" value={form.min_credit_score_claim} onChange={set("min_credit_score_claim")} className={inputClass + " mt-1 font-normal"} />
        </label>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <label className={labelClass}>
          Occupancy / entity restrictions
          <input value={form.occupancy_entity_restrictions} onChange={set("occupancy_entity_restrictions")} className={inputClass + " mt-1 font-normal"} placeholder="e.g. Investment-only, LLC borrowers OK" />
        </label>
        <label className={labelClass}>
          Prepayment penalty
          <input value={form.prepayment_penalty_availability} onChange={set("prepayment_penalty_availability")} className={inputClass + " mt-1 font-normal"} placeholder="e.g. 3-2-1 stepdown available" />
        </label>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <label className={labelClass}>
          Contact name
          <input value={form.contact_name} onChange={set("contact_name")} className={inputClass + " mt-1 font-normal"} />
        </label>
        <label className={labelClass}>
          Contact phone
          <input value={form.contact_phone} onChange={set("contact_phone")} className={inputClass + " mt-1 font-normal"} />
        </label>
        <label className={labelClass}>
          Contact email
          <input type="email" value={form.contact_email} onChange={set("contact_email")} className={inputClass + " mt-1 font-normal"} />
        </label>
        <label className={labelClass}>
          Application URL
          <input type="url" value={form.application_url} onChange={set("application_url")} className={inputClass + " mt-1 font-normal"} placeholder="https://" />
        </label>
      </div>

      {submitError && (
        <p className="text-red-700 text-sm" role="alert">{submitError}</p>
      )}

      <button
        type="submit"
        className="bg-green-700 text-white px-6 py-3 rounded-xl font-bold hover:bg-green-600"
      >
        Submit for directory review
      </button>
      <p className="text-xs text-gray-500">
        By submitting, you confirm you are authorized to list this company. All
        terms will be labeled provider-claimed until directory review.
      </p>
    </form>
  );
}
