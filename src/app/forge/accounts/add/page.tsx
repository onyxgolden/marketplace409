"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Header from "@/components/Header";
import { Button, Card, Input, Select } from "@/components/ui";
import { InstitutionService } from "@/domains/institution";

// Matches POST /api/financial/accounts: only these three types can be created
// by hand; investments/assets keep their own tabs' dedicated create forms.
const MANUAL_ACCOUNT_TYPE_OPTIONS = [
  { label: "Checking / savings", value: "depository" },
  { label: "Credit card", value: "credit" },
  { label: "Loan", value: "loan" },
];

function selectInstitutionByKey(event, institutionName, onSelect) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    onSelect(institutionName);
  }
}

function ManualAccountDetailsForm({ institutionName, onBack, onSaved }) {
  const [name, setName] = useState("");
  const [type, setType] = useState(MANUAL_ACCOUNT_TYPE_OPTIONS[0].value);
  const [dollars, setDollars] = useState("");
  const [asOf, setAsOf] = useState(() => new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const cents = Math.round(Number(dollars) * 100);
      if (!name.trim()) throw new Error("Give the account a name.");
      if (!Number.isFinite(cents) || cents < 0) {
        throw new Error("Enter a valid, non-negative balance.");
      }
      const response = await fetch("/api/financial/accounts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          type,
          currentBalanceCents: cents,
          asOf,
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error || `Unable to save (${response.status}).`);
      }
      onSaved(name.trim());
    } catch (thrown) {
      setError(thrown.message || "Unable to save the account.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-6 space-y-5">
      <p className="text-gray-600">
        Add a manual account held at <span className="font-bold text-gray-900">{institutionName}</span>.
        Enter its current balance — you can update it any time from the balances panel.
      </p>

      <Input
        label="Account name"
        name="account-name"
        value={name}
        placeholder="e.g. Emergency fund"
        required
        onChange={(event) => setName(event.target.value)}
      />

      <Select
        label="Account type"
        name="account-type"
        value={type}
        options={MANUAL_ACCOUNT_TYPE_OPTIONS}
        onChange={(event) => setType(event.target.value)}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <Input
          label="Current balance"
          name="account-balance"
          type="number"
          step="0.01"
          min="0"
          value={dollars}
          placeholder="0.00"
          required
          onChange={(event) => setDollars(event.target.value)}
        />
        <Input
          label="As of"
          name="account-as-of"
          type="date"
          value={asOf}
          required
          onChange={(event) => setAsOf(event.target.value)}
        />
      </div>

      {error && (
        <p role="alert" className="text-sm font-bold text-red-700">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save account"}
        </Button>
        <Button type="button" variant="secondary" onClick={onBack}>
          Back
        </Button>
      </div>
    </form>
  );
}

export default function AddAccountPage() {
  const router = useRouter();
  const institutions = InstitutionService.getDefaults();
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState("");
  const [step, setStep] = useState("institution");
  const [savedAccountName, setSavedAccountName] = useState(null);

  const filteredInstitutions = institutions.filter((institution) =>
    institution.name.toLowerCase().includes(search.toLowerCase())
  );

  const selectedInstitution =
    institutions.find((institution) => institution.name === selected) ?? null;
  const isManualInstitution = selectedInstitution?.type === "manual";

  // Single next-step handler for both Continue buttons: advance to the
  // account-details step carrying the selected institution.
  function handleContinue() {
    if (!selected) return;
    setSavedAccountName(null);
    setStep("details");
  }

  function handleBack() {
    setStep("institution");
  }

  return (
    <main className="min-h-screen bg-gray-100 text-gray-900">
      <Header />

      <section className="max-w-5xl mx-auto py-12 px-6">
        <h1 className="text-4xl font-extrabold mb-3">Add Financial Account</h1>

        <p className="text-gray-600 text-lg mb-8">
          {step === "details"
            ? `Account details for ${selected}.`
            : "Choose where this account is held."}
        </p>

        {step === "institution" && (
          <>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search institutions..."
              aria-label="Search institutions"
              className="w-full rounded-xl border border-gray-300 px-4 py-3 mb-6 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
              {filteredInstitutions.map((institution) => (
                <Card
                  key={institution.name}
                  onClick={() => setSelected(institution.name)}
                  className={`cursor-pointer transition border-2 ${
                    selected === institution.name
                      ? "border-blue-600 bg-blue-50"
                      : "border-transparent hover:border-gray-300"
                  }`}
                >
                  <div
                    role="button"
                    tabIndex={0}
                    aria-pressed={selected === institution.name}
                    aria-label={`Select ${institution.name}`}
                    onKeyDown={(event) =>
                      selectInstitutionByKey(event, institution.name, setSelected)
                    }
                  >
                    <h2 className="text-xl font-bold">{institution.name}</h2>
                    <p className="text-sm text-gray-500 capitalize">
                      {institution.type.replace("_", " ")}
                    </p>
                  </div>
                </Card>
              ))}
            </div>

            {selected && (
              <Card className="mt-8">
                <h2 className="text-xl font-bold mb-2">Selected Institution</h2>

                <p className="text-lg">{selected}</p>

                <Button className="mt-6" onClick={handleContinue} disabled={!selected}>
                  Continue to Account Details →
                </Button>
              </Card>
            )}

            <Button
              className={!selected ? "opacity-50 cursor-not-allowed" : ""}
              onClick={handleContinue}
              disabled={!selected}
            >
              Continue
            </Button>
          </>
        )}

        {step === "details" && savedAccountName && (
          <Card className="mt-8">
            <h2 className="text-xl font-bold mb-2">Account added</h2>
            <p className="text-gray-600">
              <span className="font-bold text-gray-900">{savedAccountName}</span> is
              now tracked. Balances update from the financial accounts panel.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button onClick={() => router.push("/forge/financial")}>
                View accounts
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setSelected(null);
                  setStep("institution");
                }}
              >
                Add another
              </Button>
            </div>
          </Card>
        )}

        {step === "details" && !savedAccountName && (
          <Card className="mt-8">
            <h2 className="text-xl font-bold mb-2">Account Details</h2>
            <p className="text-sm text-gray-500">
              Institution: <span className="font-bold text-gray-900">{selected}</span>
            </p>

            {isManualInstitution ? (
              <ManualAccountDetailsForm
                institutionName={selected}
                onBack={handleBack}
                onSaved={(accountName) => setSavedAccountName(accountName)}
              />
            ) : (
              <>
                <p className="mt-6 text-gray-600">
                  Secure connection for {selected} isn&apos;t available in this
                  flow yet. You can still track the account manually.
                </p>
                <div className="mt-6 flex flex-wrap gap-3">
                  <Button variant="secondary" onClick={handleBack}>
                    Choose a different institution
                  </Button>
                </div>
              </>
            )}
          </Card>
        )}
      </section>
    </main>
  );
}
