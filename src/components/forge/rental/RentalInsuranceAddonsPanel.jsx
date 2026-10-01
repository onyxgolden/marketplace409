"use client";
import { useCallback, useState } from "react";
import { useStaleWhileRevalidate } from "@/hooks/useStaleWhileRevalidate";
import { ForgeErrorState, ForgeLoadingState } from "@/components/forge/ForgeStates";
import { INSURANCE_PARTNER_APPROVAL_CHECKLIST } from "@/application/rental/insurancePartnerProducts";

const label = (value) => value?.replaceAll("_", " ") || "—";

function Card({ eyebrow, title, blurb, children }) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <p className="text-xs font-black uppercase tracking-[0.2em] text-sky-700 dark:text-sky-400">{eyebrow}</p>
      <h2 className="mt-1 text-2xl font-black tracking-tight text-slate-950 dark:text-white">{title}</h2>
      {blurb ? <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{blurb}</p> : null}
      <div className="mt-5">{children}</div>
    </section>
  );
}

function FlagPill({ flag }) {
  const tone =
    flag.includes("expired") || flag.includes("missing")
      ? "bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300"
      : "bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-300";
  return <span className={`mr-1 inline-block rounded-full px-2 py-0.5 text-xs font-bold ${tone}`}>{label(flag)}</span>;
}

export default function RentalInsuranceAddonsPanel() {
  const fetchDashboard = useCallback(async () => {
    const response = await fetch("/api/rental/insurance/dashboard");
    const body = await response.json();
    if (!response.ok) throw new Error(body.error);
    return body.dashboard;
  }, []);
  const { data: dashboard, error: loadError, isLoading, refresh } = useStaleWhileRevalidate("rental:insurance-addons", fetchDashboard, { ttlMs: 60_000 });

  const [formError, setFormError] = useState("");
  const [formMessage, setFormMessage] = useState("");

  async function postJson(url, body) {
    setFormError("");
    setFormMessage("");
    const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) {
      setFormError(result.error);
      return null;
    }
    setFormMessage("Saved.");
    await refresh();
    return result;
  }

  return (
    <div className="space-y-6">
      {formError ? <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-bold text-red-800 dark:bg-red-950/40 dark:text-red-300">{formError}</p> : null}
      {formMessage ? <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm font-bold text-emerold-800 dark:bg-emerald-950/30 dark:text-emerald-300">{formMessage}</p> : null}

      <ComplianceCard dashboard={dashboard} isLoading={isLoading} loadError={loadError} refresh={refresh} />
      <RequirementForm onSaved={refresh} onError={setFormError} onMessage={setFormMessage} />
      <DepositChoiceForm leases={dashboard?.rows || []} onSave={postJson} />
      <PetRecordsSection pets={dashboard?.pets || []} onSave={postJson} />
      <PartnerGateCard />
    </div>
  );
}

function ComplianceCard({ dashboard, isLoading, loadError, refresh }) {
  if (!dashboard && isLoading)
    return <Card eyebrow="Compliance" title="Insurance & pets compliance" blurb="Per-lease flags from your property requirements. Reminders are in-app only — FORGE never emails tenants about insurance."><ForgeLoadingState label="Loading compliance…" /></Card>;
  if (!dashboard && loadError)
    return <Card eyebrow="Compliance" title="Insurance & pets compliance" blurb="Per-lease flags from your property requirements. Reminders are in-app only — FORGE never emails tenants about insurance."><ForgeErrorState title="Unable to load compliance" detail={loadError} onRetry={() => refresh()} /></Card>;
  const summary = dashboard?.summary || {};
  const rows = dashboard?.rows || [];
  const reminders = dashboard?.reminders || [];
  return (
    <Card eyebrow="Compliance" title="Insurance & pets compliance" blurb="Per-lease flags from your property requirements. Reminders are in-app only — FORGE never emails tenants about insurance.">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[["Active leases", summary.activeLeaseCount ?? 0], ["Insurance missing", summary.insuranceMissing ?? 0], ["Insurance expired / expiring", (summary.insuranceExpired ?? 0) + (summary.insuranceExpiringSoon ?? 0)], ["Pet records missing", summary.petRecordsMissing ?? 0]].map(([term, value]) => (
            <div key={term} className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-800">
              <p className="text-2xl font-black text-slate-950 dark:text-white">{value}</p>
              <p className="mt-1 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{term}</p>
            </div>
          ))}
        </div>
        {reminders.length ? (
          <div className="mt-5">
            <h3 className="text-sm font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">Reminders (in-app only)</h3>
            <ul className="mt-2 space-y-2">
              {reminders.map((reminder, index) => (
                <li key={index} className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
                  {reminder.detail}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {rows.length ? (
          <div className="mt-5 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-xs font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
                  <th className="py-2 pr-4">Lease</th>
                  <th className="py-2 pr-4">Insurance</th>
                  <th className="py-2 pr-4">Pet records</th>
                  <th className="py-2 pr-4">Deposit choice</th>
                  <th className="py-2">Flags</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.leaseId} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="py-2 pr-4 font-bold text-slate-900 dark:text-white">{row.unitId}</td>
                    <td className="py-2 pr-4 capitalize text-slate-700 dark:text-slate-300">{label(row.insurance)}</td>
                    <td className="py-2 pr-4 capitalize text-slate-700 dark:text-slate-300">{label(row.petRecords)}{row.petCount ? ` (${row.petCount})` : ""}</td>
                    <td className="py-2 pr-4 capitalize text-slate-700 dark:text-slate-300">{label(row.depositChoice)}</td>
                    <td className="py-2">{row.flags.length ? row.flags.map((flag) => <FlagPill key={flag} flag={flag} />) : <span className="text-slate-400">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">No active leases to review.</p>
        )}
      </Card>
  );
}

function RequirementForm({ onSaved, onError, onMessage }) {
  const [propertyId, setPropertyId] = useState("");
  const [requiresInsurance, setRequiresInsurance] = useState(false);
  const [requiresPets, setRequiresPets] = useState(false);
  const [minimumLiability, setMinimumLiability] = useState("100000");

  async function save() {
    onError("");
    const response = await fetch("/api/rental/insurance/property-requirements", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        propertyId: propertyId.trim(),
        requiresRentersInsurance: requiresInsurance,
        minimumLiabilityCents: Math.round(Number(minimumLiability || 0) * 100),
        requiresPetRecords: requiresPets,
      }),
    });
    const result = await response.json();
    if (!response.ok) {
      onError(result.error);
      return;
    }
    onMessage("Property requirements saved.");
    setPropertyId("");
    await onSaved();
  }

  return (
    <Card eyebrow="Requirements" title="Per-property requirements" blurb="Set the default once per property: require renters insurance and/or pet records. A per-lease requirement row still overrides the property default.">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm font-bold text-slate-700 dark:text-slate-300">
          Property ID
          <input value={propertyId} onChange={(e) => setPropertyId(e.target.value)} placeholder="e.g. prop_308-paula" className="mt-1 w-full rounded-xl border border-slate-300 p-2 dark:border-slate-600 dark:bg-slate-800" />
        </label>
        <label className="block text-sm font-bold text-slate-700 dark:text-slate-300">
          Minimum liability ($)
          <input value={minimumLiability} onChange={(e) => setMinimumLiability(e.target.value)} inputMode="decimal" className="mt-1 w-full rounded-xl border border-slate-300 p-2 dark:border-slate-600 dark:bg-slate-800" />
        </label>
        <label className="flex items-center gap-2 text-sm font-bold text-slate-700 dark:text-slate-300">
          <input type="checkbox" checked={requiresInsurance} onChange={(e) => setRequiresInsurance(e.target.checked)} className="h-4 w-4" />
          Require renters insurance
        </label>
        <label className="flex items-center gap-2 text-sm font-bold text-slate-700 dark:text-slate-300">
          <input type="checkbox" checked={requiresPets} onChange={(e) => setRequiresPets(e.target.checked)} className="h-4 w-4" />
          Require pet records
        </label>
      </div>
      <button onClick={save} className="mt-4 rounded-xl bg-sky-700 px-4 py-2 text-sm font-bold text-white transition hover:bg-sky-800">Save requirement</button>
    </Card>
  );
}

function DepositChoiceForm({ leases, onSave }) {
  const [leaseId, setLeaseId] = useState("");
  const [choice, setChoice] = useState("traditional_security_deposit");
  const [productReference, setProductReference] = useState("");
  const [note, setNote] = useState("");

  async function save() {
    const result = await onSave("/api/rental/insurance/deposit-choice", {
      leaseId: leaseId.trim(),
      choice,
      productReference: productReference.trim() || null,
      note: note.trim() || null,
    });
    if (result) {
      setLeaseId("");
      setProductReference("");
      setNote("");
    }
  }

  return (
    <Card eyebrow="Deposits" title="Deposit choice per lease" blurb="Record the owner's choice: traditional security deposit or a deposit-insurance product (with its reference). Record-only — the money movement stays in the existing deposit flows.">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm font-bold text-slate-700 dark:text-slate-300">
          Lease
          <select value={leaseId} onChange={(e) => setLeaseId(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 p-2 dark:border-slate-600 dark:bg-slate-800">
            <option value="">Select a lease…</option>
            {leases.map((row) => (
              <option key={row.leaseId} value={row.leaseId}>{row.unitId} — {label(row.depositChoice)}</option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-bold text-slate-700 dark:text-slate-300">
          Choice
          <select value={choice} onChange={(e) => setChoice(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 p-2 dark:border-slate-600 dark:bg-slate-800">
            <option value="traditional_security_deposit">Traditional security deposit</option>
            <option value="deposit_insurance_product">Deposit-insurance product</option>
          </select>
        </label>
        {choice === "deposit_insurance_product" ? (
          <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 sm:col-span-2">
            Product reference (required for the product choice)
            <input value={productReference} onChange={(e) => setProductReference(e.target.value)} placeholder="e.g. SuretyCo certificate reference" className="mt-1 w-full rounded-xl border border-slate-300 p-2 dark:border-slate-600 dark:bg-slate-800" />
          </label>
        ) : null}
        <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 sm:col-span-2">
          Note (optional)
          <input value={note} onChange={(e) => setNote(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 p-2 dark:border-slate-600 dark:bg-slate-800" />
        </label>
      </div>
      <button onClick={save} className="mt-4 rounded-xl bg-sky-700 px-4 py-2 text-sm font-bold text-white transition hover:bg-sky-800">Record choice</button>
    </Card>
  );
}

function PetRecordsSection({ pets, onSave }) {
  const [animalId, setAnimalId] = useState("");
  const [weightLbs, setWeightLbs] = useState("");
  const [vaccinationOnFile, setVaccinationOnFile] = useState(false);
  const [vaccinationExpires, setVaccinationExpires] = useState("");
  const [depositAmount, setDepositAmount] = useState("");

  async function savePetDetails() {
    const response = await fetch("/api/rental/insurance/pet-records", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        animalId: animalId.trim(),
        weightLbs: weightLbs === "" ? null : Number(weightLbs),
        vaccinationRecordOnFile: vaccinationOnFile,
        vaccinationExpiresOn: vaccinationExpires || null,
      }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    setAnimalId("");
    setWeightLbs("");
    setVaccinationExpires("");
    return result;
  }

  async function recordDeposit() {
    await onSave("/api/rental/insurance/pet-deposits", {
      animalId: animalId.trim(),
      amountCents: Math.round(Number(depositAmount || 0) * 100),
    });
    setDepositAmount("");
  }

  return (
    <Card eyebrow="Pets" title="Pet records" blurb="Weight and vaccination records build on the animal records from the pet-liability workflow (Animals section). Pet deposits are record-only — the money movement stays in the existing deposit flows.">
      {pets.length ? (
        <ul className="mb-5 space-y-2">
          {pets.map((pet) => (
            <li key={pet.animalId} className="flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-800">
              <span className="font-black text-slate-900 dark:text-white">{pet.name}</span>
              <span className="text-slate-500 dark:text-slate-400">{pet.weightLbs ? `${pet.weightLbs} lbs` : "weight not recorded"}</span>
              <span className="text-slate-500 dark:text-slate-400">· vaccination: {label(pet.vaccinationStatus)}</span>
              {pet.vaccinationExpiresOn ? <span className="text-slate-500 dark:text-slate-400">({pet.vaccinationExpiresOn})</span> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-5 text-sm text-slate-500 dark:text-slate-400">No pet records yet — add animals in the Animals section first.</p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm font-bold text-slate-700 dark:text-slate-300">
          Animal
          <select value={animalId} onChange={(e) => setAnimalId(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 p-2 dark:border-slate-600 dark:bg-slate-800">
            <option value="">Select a pet…</option>
            {pets.map((pet) => (
              <option key={pet.animalId} value={pet.animalId}>{pet.name}</option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-bold text-slate-700 dark:text-slate-300">
          Weight (lbs)
          <input value={weightLbs} onChange={(e) => setWeightLbs(e.target.value)} inputMode="decimal" placeholder="e.g. 62" className="mt-1 w-full rounded-xl border border-slate-300 p-2 dark:border-slate-600 dark:bg-slate-800" />
        </label>
        <label className="flex items-center gap-2 text-sm font-bold text-slate-700 dark:text-slate-300">
          <input type="checkbox" checked={vaccinationOnFile} onChange={(e) => setVaccinationOnFile(e.target.checked)} className="h-4 w-4" />
          Vaccination record on file
        </label>
        <label className="block text-sm font-bold text-slate-700 dark:text-slate-300">
          Vaccination expires
          <input type="date" value={vaccinationExpires} onChange={(e) => setVaccinationExpires(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 p-2 dark:border-slate-600 dark:bg-slate-800" />
        </label>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <PetDetailsButton onClick={savePetDetails} />
        <label className="flex items-center gap-2 text-sm font-bold text-slate-700 dark:text-slate-300">
          Pet deposit ($)
          <input value={depositAmount} onChange={(e) => setDepositAmount(e.target.value)} inputMode="decimal" placeholder="e.g. 250" className="w-28 rounded-xl border border-slate-300 p-2 dark:border-slate-600 dark:bg-slate-800" />
        </label>
        <button onClick={recordDeposit} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">Record pet deposit</button>
      </div>
    </Card>
  );
}

function PetDetailsButton({ onClick }) {
  const [error, setError] = useState("");
  async function handle() {
    setError("");
    try {
      await onClick();
    } catch (err) {
      setError(err.message);
    }
  }
  return (
    <span>
      <button onClick={handle} className="rounded-xl bg-sky-700 px-4 py-2 text-sm font-bold text-white transition hover:bg-sky-800">Save pet details</button>
      {error ? <span role="alert" className="ml-2 text-sm font-bold text-red-700 dark:text-red-300">{error}</span> : null}
    </span>
  );
}

function PartnerGateCard() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  async function check() {
    setLoading(true);
    try {
      const response = await fetch("/api/rental/insurance/partner-status");
      const body = await response.json();
      if (response.ok) setStatus(body.status);
    } finally {
      setLoading(false);
    }
  }
  return (
    <Card eyebrow="Partner products" title="Insurance partner products — not connected" blurb="Design-only layer. No partner is signed up for, contacted, or paid — tracking works fully standalone.">
      <button onClick={check} disabled={loading} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">
        {loading ? "Checking…" : "Check partner status"}
      </button>
      <h3 className="mt-4 text-sm font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">What Jason must approve before go-live</h3>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600 dark:text-slate-400">
        {INSURANCE_PARTNER_APPROVAL_CHECKLIST.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      {status ? (
        <div className="mt-4">
          <p className="text-sm font-bold text-slate-700 dark:text-slate-300">{status.message}</p>
          <h3 className="mt-4 text-sm font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">What Jason must approve before go-live</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600 dark:text-slate-400">
            {status.approvalChecklist.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}
