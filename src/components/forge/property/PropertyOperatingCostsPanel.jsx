"use client";

import { useEffect, useState } from "react";

import PropertyOperatingCostsWorkflowChooser, {
  PropertyOperatingCostsWorkflowHeader,
} from "./PropertyOperatingCostsWorkflowChooser";

function formatCurrency(cents) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(cents || 0) / 100);
}

export function displayObligationValue(value) {
  const labels = {
    property_tax: "Property tax",
    fire_insurance: "Fire insurance",
    windstorm_insurance: "Windstorm insurance",
    flood_insurance: "Flood insurance",
    bundled_fire_windstorm_insurance: "Fire and windstorm insurance",
    business_liability_insurance: "Business liability insurance",
    other_insurance: "Other insurance",
    accrual_ready: "Accrual ready",
    pending: "Dates needed",
    cash_only: "Cash only",
  };

  return labels[value] || String(value || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function summarizeObligations(obligations = []) {
  return Object.freeze({
    total: obligations.length,
    accrualReady: obligations.filter(
      ({ recognitionStatus }) => recognitionStatus === "accrual_ready",
    ).length,
    pending: obligations.filter(
      ({ recognitionStatus }) => recognitionStatus === "pending",
    ).length,
    reconciled: obligations.filter(
      ({ reconciledFinancialEventId }) => Boolean(reconciledFinancialEventId),
    ).length,
  });
}

async function readJson(response) {
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || "Unable to complete the operating-cost request.");
  }

  return payload;
}

function mergeObligations(current, incoming) {
  const byId = new Map(current.map((item) => [item.id, item]));

  for (const item of incoming) {
    byId.set(item.id, item);
  }

  return [...byId.values()].sort(
    (left, right) =>
      (left.propertyId || left.subjectLabel).localeCompare(
        right.propertyId || right.subjectLabel,
      ) || left.obligationType.localeCompare(right.obligationType),
  );
}

export function buildOperatingCostPropertyChoices(
  obligations = [],
) {
  const choices =
    new Map();

  for (
    const obligation of obligations
  ) {
    if (
      !obligation?.propertyId
    ) {
      continue;
    }

    const taxLabel =
      obligation.obligationType ===
        "property_tax"
        ? String(
            obligation.subjectLabel ||
              "",
          ).replace(
            /\s+\d{4}\s+property taxes$/i,
            "",
          ).trim()
        : "";

    const current =
      choices.get(
        obligation.propertyId,
      );

    choices.set(
      obligation.propertyId,
      {
        propertyId:
          obligation.propertyId,
        label:
          taxLabel ||
          current?.label ||
          obligation.propertyId,
      },
    );
  }

  return Object.freeze(
    [...choices.values()]
      .sort(
        (left, right) =>
          left.label.localeCompare(
            right.label,
          ),
      )
      .map(
        (choice) =>
          Object.freeze(
            choice,
          ),
      ),
  );
}

export function applyOperatingDocumentProposal(
  result,
) {
  const proposal =
    result?.proposal?.proposal ||
    {};
  const annualAmountCents =
    proposal.annualAmountCents;

  return Object.freeze({
    obligationType:
      proposal.obligationType ||
      "other_insurance",
    annualPremium:
      Number.isFinite(
        annualAmountCents,
      )
        ? (
            annualAmountCents /
            100
          ).toFixed(2)
        : "",
    servicePeriodStart:
      proposal.servicePeriodStart ||
      "",
    servicePeriodEnd:
      proposal.servicePeriodEnd ||
      "",
    providerName:
      proposal.providerName ||
      "",
    providerReference:
      proposal.providerReference ||
      "",
    notes:
      proposal.notes || "",
    detectedAddress:
      proposal.detectedAddress ||
      "",
    documentType:
      result?.proposal
        ?.documentType ||
      "unknown",
    confidence:
      result?.proposal
        ?.confidence ||
      "low",
    warnings:
      Object.freeze([
        ...(
          result?.proposal
            ?.warnings ||
          []
        ),
      ]),
    evidenceId:
      result?.evidence?.id ||
      null,
    evidenceFilename:
      result?.evidence
        ?.originalFilename ||
      "",
    extractionMethod:
      result?.extraction?.method ||
      "unknown",
  });
}

export function buildVerifiedPolicyPayload({
  propertyId,
  propertyLabel,
  obligationType,
  annualPremium,
  servicePeriodStart,
  servicePeriodEnd,
  providerName,
  providerReference,
  evidenceId = null,
  notes,
}) {
  const amount =
    Number(annualPremium);

  if (!propertyId) {
    throw new Error(
      obligationType ===
        "property_tax"
        ? "Select the taxed property."
        : "Select the insured property.",
    );
  }

  if (
    !Number.isFinite(amount) ||
    amount <= 0
  ) {
    throw new Error(
      obligationType ===
        "property_tax"
        ? "Enter the verified annual property tax."
        : "Enter the verified annual policy premium.",
    );
  }

  const subjectLabel =
    obligationType ===
      "property_tax"
      ? `${propertyLabel} annual property taxes`
      : `${propertyLabel} annual insurance`;

  return Object.freeze({
    operation:
      "create-verified-policy",
    propertyId,
    subjectLabel,
    obligationType,
    annualAmountCents:
      Math.round(
        amount * 100,
      ),
    servicePeriodStart,
    servicePeriodEnd,
    providerName,
    providerReference,
    ...(
      evidenceId
        ? {
            evidenceId,
          }
        : {}
    ),
    notes,
  });
}

function VerifiedPolicyForm({
  propertyChoices,
  initialObligationType =
    "fire_insurance",
  onCreated,
}) {
  const [
    propertyId,
    setPropertyId,
  ] = useState("");
  const [
    obligationType,
    setObligationType,
  ] = useState(
    initialObligationType,
  );
  const [
    annualPremium,
    setAnnualPremium,
  ] = useState("");
  const [
    servicePeriodStart,
    setServicePeriodStart,
  ] = useState("");
  const [
    servicePeriodEnd,
    setServicePeriodEnd,
  ] = useState("");
  const [
    providerName,
    setProviderName,
  ] = useState("");
  const [
    providerReference,
    setProviderReference,
  ] = useState("");
  const [
    notes,
    setNotes,
  ] = useState("");
  const [
    documentReview,
    setDocumentReview,
  ] = useState(null);
  const [
    extracting,
    setExtracting,
  ] = useState(false);
  const [
    extractingFilename,
    setExtractingFilename,
  ] = useState("");
  const [
    working,
    setWorking,
  ] = useState(false);
  const [
    error,
    setError,
  ] = useState("");

  async function handleDocumentChange(
    event,
  ) {
    const document =
      event.target.files?.[0];

    setError("");

    if (!document) {
      return;
    }

    if (!propertyId) {
      event.target.value = "";
      setError(
        "Select the property before uploading its document.",
      );
      return;
    }

    setExtractingFilename(
      document.name ||
        "property document",
    );
    setExtracting(true);

    try {
      const formData =
        new FormData();

      formData.append(
        "propertyId",
        propertyId,
      );
      formData.append(
        "document",
        document,
      );

      const response =
        await fetch(
          "/api/property-operating-obligations/document-proposal",
          {
            method: "POST",
            body: formData,
          },
        );
      const result =
        await readJson(
          response,
        );
      const review =
        applyOperatingDocumentProposal(
          result,
        );

      setObligationType(
        review.obligationType,
      );
      setAnnualPremium(
        review.annualPremium,
      );
      setServicePeriodStart(
        review.servicePeriodStart,
      );
      setServicePeriodEnd(
        review.servicePeriodEnd,
      );
      setProviderName(
        review.providerName,
      );
      setProviderReference(
        review.providerReference,
      );
      setNotes(
        review.notes,
      );
      setDocumentReview(
        review,
      );
    } catch (caught) {
      setDocumentReview(null);
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to read the property document.",
      );
    } finally {
      setExtracting(false);
      setExtractingFilename("");
    }
  }

  async function handleSubmit(
    event,
  ) {
    event.preventDefault();
    setWorking(true);
    setError("");

    try {
      const property =
        propertyChoices.find(
          (choice) =>
            choice.propertyId ===
              propertyId,
        );
      const payload =
        buildVerifiedPolicyPayload({
          propertyId,
          propertyLabel:
            property?.label ||
            propertyId,
          obligationType,
          annualPremium,
          servicePeriodStart,
          servicePeriodEnd,
          providerName,
          providerReference,
          evidenceId:
            documentReview
              ?.evidenceId ||
            null,
          notes,
        });
      const response =
        await fetch(
          "/api/property-operating-obligations",
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            body:
              JSON.stringify(
                payload,
              ),
          },
        );
      const result =
        await readJson(
          response,
        );

      onCreated(
        result.policy,
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to create the verified operating obligation.",
      );
    } finally {
      setWorking(false);
    }
  }

  const isTax =
    obligationType ===
      "property_tax";

  const taxWorkflow =
    initialObligationType ===
      "property_tax";

  return (
    <section
      className="rounded-2xl border border-sky-200 bg-white shadow-sm dark:bg-slate-900"
    >
      <div className="px-5 py-4">
        <div className="text-xs font-black uppercase tracking-wide text-sky-700 dark:text-sky-400">
          {taxWorkflow
            ? "Property Tax Document"
            : "Insurance Policy Document"}
        </div>
        <div className="mt-1 text-lg font-black text-slate-950 dark:text-slate-50">
          {taxWorkflow
            ? "Add verified property tax"
            : "Add verified insurance policy"}
        </div>
        <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          {taxWorkflow
            ? "Upload a tax statement to fill the fields, then review every fact before approval."
            : "Upload a policy declaration to fill the fields, then review every fact before approval."}
        </div>
      </div>

      <form
        onSubmit={handleSubmit}
        className="grid gap-4 border-t border-sky-100 px-5 py-5"
      >
        {extracting && (
          <div
            role="status"
            aria-live="polite"
            aria-label="Document verification in progress"
            className="fixed inset-0 z-[100] grid place-items-center bg-slate-950 px-6 text-white"
          >
            <div className="w-full max-w-xl text-center">
              <div className="mx-auto h-16 w-16 animate-spin rounded-full border-4 border-blue-300 border-t-transparent" />
              <div className="mt-8 text-xs font-black uppercase tracking-[0.3em] text-blue-300">
                Property Document Verification
              </div>
              <h2 className="mt-3 text-3xl font-black">
                Reading your document
              </h2>
              <p className="mt-3 text-base leading-7 text-slate-300">
                FORGE is preserving the original evidence, extracting readable text, and preparing editable tax or insurance fields.
              </p>
              <div className="mt-6 truncate rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm font-bold text-slate-200">
                {extractingFilename}
              </div>
              <div className="mt-5 text-sm font-bold text-blue-200">
                No accounting records will change during this step.
              </div>
            </div>
          </div>
        )}

        <div className="grid gap-5 rounded-xl border border-blue-300 bg-blue-50 p-5 dark:bg-blue-950/30">
          <label className="block max-w-3xl">
            <span className="block text-sm font-black uppercase tracking-wide text-blue-900 dark:text-blue-300">
              1. Choose property
            </span>
            <span className="mt-1 block text-sm text-slate-700 dark:text-slate-300">
              {taxWorkflow
                ? "Select the property whose tax statement you are adding."
                : "Select the property whose insurance policy you are adding."}
            </span>
            <select
              required
              value={propertyId}
              onChange={(event) => {
                setPropertyId(
                  event.target.value,
                );
                setDocumentReview(
                  null,
                );
              }}
              className="mt-3 block w-full rounded-xl border-2 border-blue-400 bg-white px-4 py-3 text-base font-black text-slate-950 shadow-sm focus:border-blue-700 focus:outline-none dark:bg-slate-900 dark:text-slate-50 dark:border-blue-600"
            >
              <option value="">
                Select property first
              </option>
              {propertyChoices.map(
                (choice) => (
                  <option
                    key={
                      choice.propertyId
                    }
                    value={
                      choice.propertyId
                    }
                  >
                    {choice.label}
                  </option>
                ),
              )}
            </select>
          </label>

          <label
            className={`block max-w-3xl ${
              !propertyId
                ? "cursor-not-allowed opacity-50"
                : "cursor-pointer"
            }`}
          >
            <span className="block text-sm font-black uppercase tracking-wide text-blue-900 dark:text-blue-300">
              {taxWorkflow
                ? "2. Add property tax document"
                : "2. Add insurance policy document"}
            </span>
            <span className="mt-1 block text-sm text-slate-700 dark:text-slate-300">
              PDF, JPEG, or PNG. FORGE will preserve the evidence and prepare editable fields.
            </span>
            <input
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
              onChange={
                handleDocumentChange
              }
              disabled={
                extracting ||
                !propertyId
              }
              className="sr-only"
            />
            <span className="mt-3 flex min-h-14 w-full items-center justify-center rounded-xl border-2 border-blue-700 bg-blue-700 px-5 py-3 text-base font-black text-white shadow-sm transition hover:bg-blue-800">
              {documentReview
                ?.evidenceFilename
                ? `Replace document: ${documentReview.evidenceFilename}`
                : "Choose document"}
            </span>
          </label>

          {extracting && (
            <div
              role="status"
              className="text-sm font-bold text-blue-800 sm:col-span-2"
            >
              Reading the document and preparing editable fields…
            </div>
          )}

          {documentReview && (
            <div className="grid gap-2 rounded-lg border border-emerald-200 bg-white p-3 text-xs text-slate-700 sm:col-span-2 dark:bg-slate-900 dark:text-slate-300">
              <div className="font-black text-emerald-800">
                Document read successfully — review the populated fields below.
              </div>
              <div>
                <b>File:</b>{" "}
                {documentReview.evidenceFilename}
              </div>
              <div>
                <b>Detected:</b>{" "}
                {displayObligationValue(
                  documentReview.documentType,
                )} ·{" "}
                {documentReview.confidence} confidence ·{" "}
                {displayObligationValue(
                  documentReview.extractionMethod,
                )}
              </div>
              {documentReview.detectedAddress && (
                <div>
                  <b>Detected address:</b>{" "}
                  {documentReview.detectedAddress}
                </div>
              )}
              {documentReview.warnings.map(
                (warning) => (
                  <div
                    key={warning}
                    className="rounded-md bg-amber-50 px-2 py-1 font-bold text-amber-800 dark:text-amber-300 dark:bg-amber-950/30"
                  >
                    Review required: {warning}
                  </div>
                ),
              )}
            </div>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
            Operating-cost type
            <select
              required
              value={obligationType}
              onChange={(event) =>
                setObligationType(
                  event.target.value,
                )
              }
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-700"
            >
              {taxWorkflow ? (
                <option value="property_tax">
                  Property tax
                </option>
              ) : (
                <>
                  <option value="fire_insurance">
                    Fire insurance
                  </option>
                  <option value="windstorm_insurance">
                    Windstorm insurance
                  </option>
                  <option value="flood_insurance">
                    Flood insurance
                  </option>
                  <option value="bundled_fire_windstorm_insurance">
                    Fire and windstorm insurance
                  </option>
                  <option value="business_liability_insurance">
                    Business liability insurance
                  </option>
                  <option value="other_insurance">
                    Other insurance
                  </option>
                </>
              )}
            </select>
          </label>

          <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
            {isTax
              ? "Annual property tax"
              : "Annual policy premium"}
            <input
              type="number"
              min="0.01"
              step="0.01"
              required
              value={annualPremium}
              onChange={(event) =>
                setAnnualPremium(
                  event.target.value,
                )
              }
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-700"
            />
          </label>

          <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
            Provider or tax authority
            <input
              type="text"
              value={providerName}
              onChange={(event) =>
                setProviderName(
                  event.target.value,
                )
              }
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-700"
            />
          </label>

          <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
            {isTax
              ? "Account or parcel number"
              : "Policy reference"}
            <input
              type="text"
              value={providerReference}
              onChange={(event) =>
                setProviderReference(
                  event.target.value,
                )
              }
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-700"
            />
          </label>

          <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
            {isTax
              ? "Tax period starts"
              : "Coverage starts"}
            <input
              type="date"
              required
              value={servicePeriodStart}
              onChange={(event) =>
                setServicePeriodStart(
                  event.target.value,
                )
              }
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-700"
            />
          </label>

          <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
            {isTax
              ? "Tax period ends"
              : "Coverage ends"}
            <input
              type="date"
              required
              value={servicePeriodEnd}
              onChange={(event) =>
                setServicePeriodEnd(
                  event.target.value,
                )
              }
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-700"
            />
          </label>

          <label className="text-xs font-bold text-slate-700 sm:col-span-2 dark:text-slate-300">
            Verification notes
            <input
              type="text"
              value={notes}
              onChange={(event) =>
                setNotes(
                  event.target.value,
                )
              }
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-700"
            />
          </label>
        </div>

        <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-bold leading-5 text-amber-900 dark:bg-amber-950/30">
          Uploading only creates a review proposal. Taxes, insurance accruals, and NOI change only after you approve the populated fields below.
        </div>

        {error && (
          <div
            role="alert"
            className="text-sm font-bold text-rose-700 dark:text-rose-400"
          >
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={
            working ||
            extracting
          }
          className="w-full rounded-lg bg-slate-950 px-4 py-3 text-sm font-black text-white disabled:opacity-40 sm:w-auto"
        >
          {working
            ? "Creating verified cost…"
            : isTax
              ? "Approve property tax"
              : "Approve verified policy"}
        </button>
      </form>
    </section>
  );
}

export function canVerifyCoverage(
  obligation,
) {
  return (
    obligation
      ?.recognitionStatus ===
        "pending" &&
    obligation?.scope !==
      "personal_home_office" &&
    String(
      obligation?.obligationType ||
        "",
    ).includes(
      "insurance",
    )
  );
}

export function buildCoverageVerificationPayload({
  obligation,
  annualPremium,
  obligationType,
  servicePeriodStart,
  servicePeriodEnd,
  providerName,
  providerReference,
  notes,
}) {
  const amount =
    Number(annualPremium);

  if (
    !Number.isFinite(amount) ||
    amount <= 0
  ) {
    throw new Error(
      "Enter the verified annual policy premium.",
    );
  }

  return Object.freeze({
    operation:
      "verify-coverage",
    obligationId:
      obligation.id,
    annualAmountCents:
      Math.round(
        amount * 100,
      ),
    obligationType,
    servicePeriodStart,
    servicePeriodEnd,
    providerName,
    providerReference,
    notes,
  });
}

function CoverageVerificationForm({
  obligation,
  onVerified,
}) {
  const [
    obligationType,
    setObligationType,
  ] = useState(
    obligation.obligationType,
  );
  const [
    annualPremium,
    setAnnualPremium,
  ] = useState(
    (
      Number(
        obligation
          .annualAmountCents ||
          0,
      ) / 100
    ).toFixed(2),
  );
  const [
    servicePeriodStart,
    setServicePeriodStart,
  ] = useState(
    obligation
      .servicePeriodStart ||
      "",
  );
  const [
    servicePeriodEnd,
    setServicePeriodEnd,
  ] = useState(
    obligation
      .servicePeriodEnd ||
      "",
  );
  const [
    providerName,
    setProviderName,
  ] = useState(
    obligation.providerName ||
      "",
  );
  const [
    providerReference,
    setProviderReference,
  ] = useState(
    obligation
      .providerReference ||
      "",
  );
  const [
    notes,
    setNotes,
  ] = useState(
    obligation.notes || "",
  );
  const [
    working,
    setWorking,
  ] = useState(false);
  const [
    error,
    setError,
  ] = useState("");

  async function handleSubmit(
    event,
  ) {
    event.preventDefault();
    setWorking(true);
    setError("");

    try {
      const response =
        await fetch(
          "/api/property-operating-obligations",
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            body:
              JSON.stringify(
                buildCoverageVerificationPayload({
                  obligation,
                  annualPremium,
                  obligationType,
                  servicePeriodStart,
                  servicePeriodEnd,
                  providerName,
                  providerReference,
                  notes,
                }),
              ),
          },
        );
      const payload =
        await readJson(
          response,
        );

      onVerified(
        payload.obligation,
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to verify policy coverage.",
      );
    } finally {
      setWorking(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-2 grid gap-3 rounded-xl border border-amber-200 bg-white p-4 sm:col-span-2 lg:col-span-4 dark:bg-slate-900"
    >
      <div className="text-sm font-black text-slate-950 dark:text-slate-50">
        Verify policy coverage
      </div>
      <div className="text-xs leading-5 text-slate-600 dark:text-slate-300">
        Enter facts from the policy declaration. The premium accrues into NOI; the imported payment remains unchanged in cash flow.
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
          Verified policy type
          <select
            required
            value={obligationType}
            onChange={(event) =>
              setObligationType(
                event.target.value,
              )
            }
            className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-700"
          >
            <option value="fire_insurance">
              Fire insurance
            </option>
            <option value="windstorm_insurance">
              Windstorm insurance
            </option>
            <option value="flood_insurance">
              Flood insurance
            </option>
            <option value="bundled_fire_windstorm_insurance">
              Fire and windstorm insurance
            </option>
            <option value="business_liability_insurance">
              Business liability insurance
            </option>
            <option value="other_insurance">
              Other insurance
            </option>
          </select>
        </label>
        <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
          Annual policy premium
          <input
            type="number"
            min="0.01"
            step="0.01"
            required
            value={annualPremium}
            onChange={(event) =>
              setAnnualPremium(
                event.target.value,
              )
            }
            className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-700"
          />
        </label>
        <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
          Coverage starts
          <input
            type="date"
            required
            value={servicePeriodStart}
            onChange={(event) =>
              setServicePeriodStart(
                event.target.value,
              )
            }
            className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-700"
          />
        </label>
        <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
          Coverage ends
          <input
            type="date"
            required
            value={servicePeriodEnd}
            onChange={(event) =>
              setServicePeriodEnd(
                event.target.value,
              )
            }
            className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-700"
          />
        </label>
        <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
          Provider
          <input
            type="text"
            value={providerName}
            onChange={(event) =>
              setProviderName(
                event.target.value,
              )
            }
            className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-700"
          />
        </label>
        <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
          Policy reference
          <input
            type="text"
            value={providerReference}
            onChange={(event) =>
              setProviderReference(
                event.target.value,
              )
            }
            className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-700"
          />
        </label>
        <label className="text-xs font-bold text-slate-700 sm:col-span-2 lg:col-span-1 dark:text-slate-300">
          Verification notes
          <input
            type="text"
            value={notes}
            onChange={(event) =>
              setNotes(
                event.target.value,
              )
            }
            className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-700"
          />
        </label>
      </div>
      {error && (
        <div
          role="alert"
          className="text-xs font-bold text-rose-700 dark:text-rose-400"
        >
          {error}
        </div>
      )}
      <button
        type="submit"
        disabled={working}
        className="w-full rounded-lg bg-slate-950 px-4 py-2 text-xs font-black text-white disabled:opacity-40 sm:w-auto"
      >
        {working
          ? "Verifying…"
          : "Verify coverage and accrue"}
      </button>
    </form>
  );
}

function ObligationRow({ obligation, onVerified }) {
  const ready = obligation.recognitionStatus === "accrual_ready";

  return (
    <details className="group border-b border-slate-200 last:border-b-0 dark:border-slate-800">
      <summary className="grid cursor-pointer list-none items-center gap-2 px-4 py-3 hover:bg-slate-50 sm:grid-cols-[minmax(180px,1.4fr)_minmax(130px,1fr)_110px_125px_20px]">
        <div className="min-w-0">
          <div className="truncate text-sm font-black text-slate-950 dark:text-slate-50">
            {obligation.subjectLabel}
          </div>
          <div className="truncate text-xs text-slate-500 dark:text-slate-400">
            {obligation.propertyId || "Portfolio"}
          </div>
        </div>
        <div className="text-xs font-bold text-slate-700 dark:text-slate-300">
          {displayObligationValue(obligation.obligationType)}
        </div>
        <div className="text-sm font-black text-slate-950 dark:text-slate-50">
          {formatCurrency(obligation.annualAmountCents)}
        </div>
        <div className={`rounded-full border px-2 py-1 text-center text-[10px] font-black uppercase ${ready ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30" : "border-amber-200 bg-amber-50 text-amber-800 dark:text-amber-300 dark:bg-amber-950/30"}`}>
          {displayObligationValue(obligation.recognitionStatus)}
        </div>
        <div className="text-slate-400 transition group-open:rotate-180">▾</div>
      </summary>
      <div className="grid gap-3 bg-slate-50 px-4 py-4 text-xs text-slate-700 sm:grid-cols-2 lg:grid-cols-4 dark:bg-slate-800/60 dark:text-slate-300">
        <div><b>Coverage:</b><br />{obligation.servicePeriodStart && obligation.servicePeriodEnd ? `${obligation.servicePeriodStart} to ${obligation.servicePeriodEnd}` : "Policy dates needed"}</div>
        <div><b>Payment:</b><br />{obligation.paymentDate || "Not recorded"} · {formatCurrency(obligation.paidAmountCents)}</div>
        <div><b>Verification:</b><br />{displayObligationValue(obligation.verificationStatus)}</div>
        <div><b>Financial payment:</b><br />{obligation.reconciledFinancialEventId ? "Reconciled" : "Needs matching"}</div>
        {obligation.notes && <div className="sm:col-span-2 lg:col-span-4"><b>Notes:</b> {obligation.notes}</div>}
        {canVerifyCoverage(obligation) && (
          <CoverageVerificationForm
            obligation={obligation}
            onVerified={onVerified}
          />
        )}
      </div>
    </details>
  );
}

export default function PropertyOperatingCostsPanel() {
  const [obligations, setObligations] = useState([]);
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [workflow, setWorkflow] = useState(null);
  const [
    showGuidance,
    setShowGuidance,
  ] = useState(true);

  useEffect(() => {
    const savedPreference =
      window.localStorage.getItem(
        "forge.display.guidance",
      );

    if (savedPreference === "off") {
      setShowGuidance(false);
    }
  }, []);

  function toggleGuidance() {
    setShowGuidance((current) => {
      const next = !current;

      window.localStorage.setItem(
        "forge.display.guidance",
        next ? "on" : "off",
      );

      return next;
    });
  }

  useEffect(() => {
    async function initialize() {
      try {
        const response = await fetch("/api/property-operating-obligations");
        const payload = await readJson(response);
        setObligations(payload.obligations || []);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Unable to load operating costs.");
      } finally {
        setLoading(false);
      }
    }

    initialize();
  }, []);

  const summary = summarizeObligations(obligations);
  const propertyChoices =
    buildOperatingCostPropertyChoices(
      obligations,
    );

  async function handleFileChange(event) {
    const file = event.target.files?.[0];
    setError("");
    setMessage("");
    setPreview(null);

    if (!file) {
      setCsv("");
      setFileName("");
      return;
    }

    setWorking(true);
    setFileName(file.name);

    try {
      const contents = await file.text();
      setCsv(contents);
      const response = await fetch("/api/property-operating-obligations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation: "preview-spreadsheet",
          csv: contents,
          taxServiceYear: 2025,
        }),
      });
      const payload = await readJson(response);
      setPreview(payload.preview);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to preview operating costs.");
    } finally {
      setWorking(false);
    }
  }

  async function handleImport() {
    if (!csv || !preview?.valid) return;
    setWorking(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch("/api/property-operating-obligations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation: "import-spreadsheet",
          csv,
          taxServiceYear: 2025,
        }),
      });
      const payload = await readJson(response);

      if (!payload.result.valid) {
        setPreview(payload.result);
        setError("Resolve invalid rows before importing.");
        return;
      }

      setObligations((current) => mergeObligations(current, payload.result.persistedObligations || []));
      setPreview(payload.result);
      setMessage(`${payload.result.importedCount} operating obligations imported.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to import operating costs.");
    } finally {
      setWorking(false);
    }
  }

  const pendingCoverage =
    obligations.filter(
      canVerifyCoverage,
    );

  function mergeCreatedPolicy(
    policy,
  ) {
    setObligations(
      (current) =>
        mergeObligations(
          current,
          [policy],
        ),
    );

    setMessage(
      `${policy.subjectLabel} created from verified policy evidence.`,
    );
    setWorkflow(null);
  }

  function mergeVerifiedCoverage(
    verified,
  ) {
    setObligations((current) =>
      mergeObligations(
        current,
        [verified],
      ),
    );

    setMessage(
      `${verified.subjectLabel} coverage verified and ready for accrual.`,
    );
  }

  const obligationTable = (
    items,
    emptyMessage,
  ) => (
    <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white dark:bg-slate-900 dark:border-slate-800">
      <div className="grid gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2 text-[10px] font-black uppercase text-slate-500 sm:grid-cols-[minmax(180px,1.4fr)_minmax(130px,1fr)_110px_125px_20px] dark:bg-slate-800/60 dark:text-slate-400 dark:border-slate-800">
        <div>Property</div>
        <div>Category</div>
        <div>Annual</div>
        <div>Status</div>
        <div />
      </div>

      {loading && (
        <div className="p-5 text-sm font-bold text-slate-600 dark:text-slate-300">
          Loading operating costs…
        </div>
      )}

      {!loading &&
        items.length === 0 && (
          <div className="p-5 text-sm text-slate-600 dark:text-slate-300">
            {emptyMessage}
          </div>
        )}

      {items.map((item) => (
        <ObligationRow
          key={item.id}
          obligation={item}
          onVerified={
            mergeVerifiedCoverage
          }
        />
      ))}
    </div>
  );

  return (
    <section
      data-property-operating-costs-panel
      className={
        workflow === null
          ? "max-w-5xl"
          : ""
      }
    >
      {workflow === null ? (
        <>
          <header className="rounded-2xl border border-blue-200 bg-gradient-to-br from-slate-950 to-blue-950 p-5 text-white">
            <div className="text-xs font-black uppercase tracking-[0.2em] text-blue-300">
              Property Operations
            </div>

            <h3 className="mt-2 text-2xl font-black">
              Taxes &amp; Insurance
            </h3>

            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
              Maintain annual obligations once, reconcile cash payments, and accrue verified coverage into the correct property NOI.
            </p>
          </header>

          <div className="mt-5 grid max-w-3xl gap-3 sm:grid-cols-4">
            {[
              [
                "Obligations",
                summary.total,
              ],
              [
                "Accrual ready",
                summary.accrualReady,
              ],
              [
                "Dates needed",
                summary.pending,
              ],
              [
                "Reconciled",
                summary.reconciled,
              ],
            ].map(
              ([label, value]) => (
                <div
                  key={label}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-3 dark:bg-slate-900 dark:border-slate-800"
                >
                  <div className="text-[11px] font-black uppercase text-slate-500 dark:text-slate-400">
                    {label}
                  </div>

                  <div className="mt-1 text-xl font-black text-slate-950 dark:text-slate-50">
                    {value}
                  </div>
                </div>
              ),
            )}
          </div>

          <PropertyOperatingCostsWorkflowChooser
            showGuidance={
              showGuidance
            }
            onToggleGuidance={
              toggleGuidance
            }
            onChoose={setWorkflow}
          />
        </>
      ) : (
        <>
          <PropertyOperatingCostsWorkflowHeader
            workflowId={workflow}
            showGuidance={
              showGuidance
            }
            onBack={() =>
              setWorkflow(null)
            }
          />

          {error && (
            <div
              role="alert"
              className="mt-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-800 dark:bg-rose-950/30"
            >
              {error}
            </div>
          )}

          {message && (
            <div
              role="status"
              className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800 dark:bg-emerald-950/30"
            >
              {message}
            </div>
          )}

          {[
            "property-tax",
            "insurance-policy",
          ].includes(workflow) && (
            <div className="mt-6">
              <VerifiedPolicyForm
                key={workflow}
                propertyChoices={
                  propertyChoices
                }
                initialObligationType={
                  workflow ===
                    "property-tax"
                    ? "property_tax"
                    : "fire_insurance"
                }
                onCreated={
                  mergeCreatedPolicy
                }
              />
            </div>
          )}

          {workflow ===
            "verify-coverage" &&
            obligationTable(
              pendingCoverage,
              "No incomplete insurance coverage requires verification.",
            )}

          {workflow === "review" &&
            obligationTable(
              obligations,
              "No verified taxes or insurance obligations are recorded.",
            )}

          {workflow === "import" && (
            <div className="mt-6 max-w-4xl rounded-2xl border border-slate-200 bg-white p-5 dark:bg-slate-900 dark:border-slate-800">
              <div className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Ledger Import
              </div>

              <h4 className="mt-2 text-lg font-black text-slate-950 dark:text-slate-50">
                Preview taxes and insurance
              </h4>

              <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                Taxes use the confirmed tax year. Insurance stays outside accrued NOI until policy dates are verified.
              </p>

              <label className="mt-4 block">
                <span className="text-sm font-bold text-slate-700 dark:text-slate-300">
                  Category ledger CSV
                </span>

                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={
                    handleFileChange
                  }
                  disabled={working}
                  className="mt-2 block w-full rounded-xl border border-slate-300 px-3 py-2 text-sm dark:border-slate-700"
                />
              </label>

              {fileName && (
                <div className="mt-2 text-xs font-bold text-slate-500 dark:text-slate-400">
                  {fileName}
                </div>
              )}

              {working && (
                <div className="mt-4 text-sm font-bold text-blue-700">
                  Validating owner-scoped records…
                </div>
              )}

              {preview && (
                <div className="mt-5 space-y-3">
                  <div className="text-sm font-black">
                    {preview.validRowCount} valid ·{" "}
                    {preview.invalidRowCount} invalid ·{" "}
                    {preview.warnings?.length ||
                      0} warnings
                  </div>

                  {preview.errors?.map(
                    (item) => (
                      <div
                        key={`e-${item.rowNumber}`}
                        className="rounded-lg bg-rose-50 p-3 text-xs font-bold text-rose-800 dark:bg-rose-950/30"
                      >
                        Row {item.rowNumber}:{" "}
                        {item.message}
                      </div>
                    ),
                  )}

                  {preview.warnings?.map(
                    (item) => (
                      <div
                        key={`w-${item.rowNumber}-${item.code}`}
                        className="rounded-lg bg-amber-50 p-3 text-xs font-bold text-amber-800 dark:text-amber-300 dark:bg-amber-950/30"
                      >
                        Row {item.rowNumber}:{" "}
                        {item.message}
                      </div>
                    ),
                  )}

                  <button
                    type="button"
                    onClick={handleImport}
                    disabled={
                      working ||
                      !preview.valid
                    }
                    className="w-full rounded-xl bg-slate-950 px-4 py-3 text-sm font-black text-white disabled:opacity-40"
                  >
                    Import verified preview
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
