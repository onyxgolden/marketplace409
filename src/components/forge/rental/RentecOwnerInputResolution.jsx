"use client";
import { useState } from "react";

export default function RentecOwnerInputResolution({ resolution, busy = false, onResolve }) {
  const [values, setValues] = useState({});
  if (!resolution) return null;
  const requirements = resolution.requirements || [];

  if (!requirements.length) return <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-4">
    <h4 className="font-black text-emerald-900">Owner inputs resolved</h4>
    <p className="mt-2 text-sm text-emerald-800">The preview checksum now covers the validated inputs and exclusions. No records were saved or imported.</p>
  </div>;

  function submit(event) {
    event.preventDefault();
    const tenantEmails = {};
    const tenantExclusions = {};
    const leaseRentDueDays = {};
    for (const requirement of requirements) {
      if (requirement.type === "tenant_email") {
        if (values[`exclude:${requirement.sourceId}`]) tenantExclusions[requirement.sourceId] = true;
        else tenantEmails[requirement.sourceId] = values[`tenant_email:${requirement.sourceId}`] || "";
      }
      if (requirement.type === "rent_due_day") leaseRentDueDays[requirement.sourceId] = Number(values[`rent_due_day:${requirement.sourceId}`] || 0);
    }
    onResolve?.({ tenantEmails, tenantExclusions, leaseRentDueDays });
  }

  return <form onSubmit={submit} className="rounded-xl border border-amber-300 bg-amber-50 p-4">
    <h4 className="font-black text-amber-950">Resolve owner inputs</h4>
    <p className="mt-2 text-sm text-amber-900">Complete these fields to regenerate the private manifest and approval checksum. Inputs are validated in memory and are not saved.</p>
    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      {requirements.map((requirement) => {
        const id = `${requirement.type}:${requirement.sourceId}`;
        const excludeId = `exclude:${requirement.sourceId}`;
        const email = requirement.type === "tenant_email";
        const excluded = Boolean(values[excludeId]);
        return <div key={id} className="rounded-lg border bg-white p-3 text-sm font-bold">
          <label htmlFor={id} className="block">{requirement.label}</label>
          <span className="mt-1 block text-xs font-medium text-slate-500">{requirement.prompt}</span>
          <input
            id={id}
            required={!email || !excluded}
            disabled={email && excluded}
            type={email ? "email" : "number"}
            min={email ? undefined : 1}
            max={email ? undefined : 28}
            value={values[id] || ""}
            onChange={(event) => setValues((current) => ({ ...current, [id]: event.target.value }))}
            className="mt-2 w-full rounded-lg border px-3 py-2 font-medium disabled:bg-slate-100"
          />
          {email ? <label className="mt-3 flex items-start gap-2 font-medium">
            <input
              type="checkbox"
              checked={excluded}
              onChange={(event) => setValues((current) => ({ ...current, [excludeId]: event.target.checked }))}
            />
            <span>Exclude this record because it is not an actual renter</span>
          </label> : null}
        </div>;
      })}
    </div>
    <button type="submit" disabled={busy} className="mt-4 rounded-xl bg-slate-950 px-5 py-3 font-black text-white disabled:opacity-50">
      {busy ? "Regenerating…" : "Validate inputs and regenerate preview"}
    </button>
    <p className="mt-3 text-sm font-bold text-amber-900">Preview only: this does not import, activate billing, delete source data, or save the entered values.</p>
  </form>;
}
