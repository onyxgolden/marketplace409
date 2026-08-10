"use client";

import {
  useState,
} from "react";

import {
  HVAC_COMPONENT_EVENT_TYPES,
} from "@/domains/property-hvac/property-hvac.types";

import PropertyHVACEventActionEditor from "./PropertyHVACEventActionEditor";

const INPUT_CLASS =
  "mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm font-bold normal-case text-slate-950";

function todayValue() {
  return new Date()
    .toISOString()
    .slice(0, 10);
}

function displayValue(value) {
  return String(value || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) =>
      character.toUpperCase(),
    );
}

function optionalText(value) {
  return String(value || "").trim() ||
    null;
}

function eventTimestamp(value) {
  return new Date(
    `${value}T00:00:00.000Z`,
  ).toISOString();
}

export function buildHVACEventPayload({
  systemId,
  values,
}) {
  return {
    systemId,
    componentId:
      optionalText(values.componentId),
    eventType: values.eventType,
    occurredAt:
      eventTimestamp(
        values.occurredAt,
      ),
    failureSymptoms:
      optionalText(
        values.failureSymptoms,
      ),
    workPerformed:
      optionalText(
        values.workPerformed,
      ),
    costCents:
      values.costDollars === ""
        ? null
        : Math.round(
            Number(
              values.costDollars,
            ) * 100,
          ),
    vendorName:
      optionalText(values.vendorName),
    invoiceReference:
      optionalText(
        values.invoiceReference,
      ),
    photoReferences: [],
    componentActions:
      values.componentActions ?? [],
    notes: optionalText(values.notes),
  };
}

export function buildHVACEventOperation({
  systemId,
  values,
  evidenceId = null,
}) {
  return {
    operation:
      "record-component-event",
    event:
      buildHVACEventPayload({
        systemId,
        values,
      }),
    evidenceId:
      optionalText(
        evidenceId,
      ),
  };
}

export function buildHVACInvoiceFormData({
  file,
  propertyId,
  systemId,
}) {
  const formData =
    new FormData();

  formData.append(
    "invoice",
    file,
  );

  formData.append(
    "propertyId",
    propertyId,
  );

  formData.append(
    "systemId",
    systemId,
  );

  return formData;
}

export function applyHVACInvoiceProposal(
  current,
  proposal,
) {
  const event =
    proposal?.event ?? {};

  return {
    ...current,
    eventType:
      event.eventType ||
      current.eventType,
    occurredAt:
      event.occurredAt
        ? String(
            event.occurredAt,
          ).slice(0, 10)
        : current.occurredAt,
    failureSymptoms:
      event.failureSymptoms || "",
    workPerformed:
      event.workPerformed || "",
    costDollars:
      event.costCents == null
        ? ""
        : String(
            event.costCents / 100,
          ),
    vendorName:
      event.vendorName || "",
    invoiceReference:
      event.invoiceReference || "",
    componentActions:
      Array.isArray(
        event.componentActions,
      )
        ? [
            ...event
              .componentActions,
          ]
        : [],
    notes:
      event.notes || "",
  };
}

function Field({
  label,
  children,
}) {
  return (
    <label className="text-xs font-black uppercase tracking-wide text-slate-600">
      {label}
      {children}
    </label>
  );
}

export default function PropertyHVACEventPanel({
  propertyId = "",
  systemId = "",
  components = [],
  events = [],
  initialEventType = "inspected",
  onEventSaved = () => {},
}) {
  const [
    values,
    setValues,
  ] = useState({
    componentId: "",
    eventType:
      initialEventType,
    occurredAt: todayValue(),
    failureSymptoms: "",
    workPerformed: "",
    costDollars: "",
    vendorName: "",
    invoiceReference: "",
    componentActions: [],
    notes: "",
  });

  const [
    saving,
    setSaving,
  ] = useState(false);

  const [
    importingInvoice,
    setImportingInvoice,
  ] = useState(false);

  const [
    importingFilename,
    setImportingFilename,
  ] = useState("");

  const [
    message,
    setMessage,
  ] = useState("");

  const [
    evidenceReference,
    setEvidenceReference,
  ] = useState(null);

  function updateValue(
    name,
    value,
  ) {
    setValues((current) => ({
      ...current,
      [name]: value,
    }));
  }

  async function importInvoice(
    file,
  ) {
    if (!file) {
      return;
    }

    if (!propertyId || !systemId) {
      setMessage(
        "Choose an HVAC system before adding an invoice.",
      );
      return;
    }

    setImportingFilename(
      file.name ||
        "HVAC invoice",
    );
    setImportingInvoice(true);
    setMessage("");

    try {
      const formData =
        buildHVACInvoiceFormData({
          file,
          propertyId,
          systemId,
        });

      const response =
        await fetch(
          "/api/property-hvac/invoice-proposal",
          {
            method: "POST",
            body: formData,
          },
        );

      const payload =
        await response.json();

      if (!response.ok) {
        throw new Error(
          payload?.ocrRequired
            ? "This invoice requires OCR. Google Cloud Vision support is the next fallback."
            : payload?.error ||
              "Unable to read the HVAC invoice.",
        );
      }

      if (!payload?.proposal) {
        throw new Error(
          "The HVAC invoice or photo did not return a proposal.",
        );
      }

      setValues(
        (current) =>
          applyHVACInvoiceProposal(
            current,
            payload.proposal,
          ),
      );

      setEvidenceReference(
        payload.evidence ?? null,
      );

      const actionCount =
        payload.proposal
          ?.event
          ?.componentActions
          ?.length ?? 0;

      setMessage(
        `Invoice preserved privately and proposal loaded with ${actionCount} component actions. Review the fields, then record the event once.`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to read the HVAC invoice.",
      );
    } finally {
      setImportingInvoice(false);
      setImportingFilename("");
    }
  }

  async function recordEvent() {
    if (!systemId) {
      setMessage(
        "Choose an HVAC system.",
      );
      return;
    }

    setSaving(true);
    setMessage("");

    try {
      const response = await fetch(
        "/api/property-hvac",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify(
            buildHVACEventOperation({
              systemId,
              values,
              evidenceId:
                evidenceReference?.id,
            }),
          ),
        },
      );

      const payload =
        await response.json();

      if (!response.ok) {
        throw new Error(
          payload?.error ||
            "Unable to record the HVAC event.",
        );
      }

      if (payload?.event) {
        onEventSaved(payload.event);
      }

      setEvidenceReference(
        null,
      );

      setValues((current) => ({
        componentId:
          current.componentId,
        eventType: "inspected",
        occurredAt: todayValue(),
        failureSymptoms: "",
        workPerformed: "",
        costDollars: "",
        vendorName: "",
        invoiceReference: "",
        componentActions: [],
        notes: "",
      }));

      setMessage(
        evidenceReference?.id
          ? "HVAC service event and private invoice evidence recorded."
          : "HVAC service event recorded.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to record the HVAC event.",
      );
    } finally {
      setSaving(false);
    }
  }

  function componentName(
    componentId,
  ) {
    return (
      components.find(
        (component) =>
          component.id ===
          componentId,
      )?.name ||
      "System-level event"
    );
  }

  return (
    <section
      data-property-hvac-event-panel
      className="mt-7 rounded-2xl border border-amber-200 bg-amber-50 p-5"
    >
      {importingInvoice && (
        <div
          role="status"
          aria-live="polite"
          aria-label="HVAC invoice verification in progress"
          className="fixed inset-0 z-[100] grid place-items-center bg-slate-950 px-6 text-white"
        >
          <div className="w-full max-w-xl text-center">
            <div className="mx-auto h-16 w-16 animate-spin rounded-full border-4 border-blue-300 border-t-transparent" />
            <div className="mt-8 text-xs font-black uppercase tracking-[0.3em] text-blue-300">
              HVAC Document Verification
            </div>
            <h2 className="mt-3 text-3xl font-black">
              Reading your invoice
            </h2>
            <p className="mt-3 text-base leading-7 text-slate-300">
              FORGE is preserving the original evidence, extracting service details, and preparing editable component actions.
            </p>
            <div className="mt-6 truncate rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm font-bold text-slate-200">
              {importingFilename}
            </div>
            <div className="mt-5 text-sm font-bold text-blue-200">
              No HVAC history will change until you approve the review.
            </div>
          </div>
        </div>
      )}

      <div>
        <div className="text-xs font-black uppercase tracking-wide text-amber-800">
          Append-Only History
        </div>

        <h5 className="mt-2 text-lg font-black text-slate-950">
          {initialEventType === "failed"
            ? "Complete system failure"
            : initialEventType === "repaired"
              ? "Component work and service history"
              : "Inspection and service history"}
        </h5>

        <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-slate-600">
          Preserve what happened, when it happened, which component was involved, who performed the work, and what it cost.
        </p>
      </div>

      <div className="mt-5 grid gap-4 rounded-xl border border-blue-300 bg-blue-50 p-5">
        <div className="max-w-3xl">
          <div className="text-sm font-black uppercase tracking-wide text-blue-900">
            1. Add invoice or service photo
          </div>
          <div className="mt-1 text-sm text-slate-700">
            Select a PDF, JPEG, or PNG. FORGE will preserve the evidence and prepare editable service and component details.
          </div>
        </div>

        <label
          className={`block max-w-3xl ${
            !systemId
              ? "cursor-not-allowed opacity-50"
              : importingInvoice
                ? "cursor-wait opacity-70"
                : "cursor-pointer"
          }`}
        >
          <input
            type="file"
            accept="application/pdf,.pdf,image/jpeg,.jpg,.jpeg,image/png,.png"
            disabled={
              importingInvoice ||
              !systemId
            }
            onChange={(event) => {
              const file =
                event.target
                  .files?.[0];

              importInvoice(file);

              event.target.value = "";
            }}
            className="sr-only"
          />
          <span className="flex min-h-14 w-full items-center justify-center rounded-xl border-2 border-blue-700 bg-blue-700 px-5 py-3 text-base font-black text-white shadow-sm transition hover:bg-blue-800">
            {evidenceReference
              ?.originalFilename
              ? `Replace document: ${evidenceReference.originalFilename}`
              : "Choose invoice or photo"}
          </span>
        </label>

        {evidenceReference && (
          <div className="grid max-w-3xl gap-2 rounded-lg border border-emerald-200 bg-white p-4 text-xs text-slate-700">
            <div className="font-black text-emerald-800">
              Document read successfully — review the populated HVAC fields below.
            </div>
            <div>
              <b>File:</b>{" "}
              {evidenceReference.originalFilename ||
                "HVAC evidence"}
            </div>
            <div>
              <b>Evidence status:</b>{" "}
              {displayValue(
                evidenceReference.reviewStatus ||
                  "pending_review",
              )}
            </div>
          </div>
        )}
      </div>

      {!systemId ? (
        <p className="mt-4 text-sm font-bold text-slate-600">
          Choose an HVAC system before recording events.
        </p>
      ) : (
        <div className="mt-5 rounded-2xl border-2 border-blue-200 bg-white p-5 shadow-sm">
          <div className="mb-5">
            <div className="text-sm font-black uppercase tracking-wide text-blue-900">
              2. Review service and component details
            </div>
            <div className="mt-1 text-sm text-slate-600">
              Confirm or correct every extracted field before recording the append-only event.
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Related component">
              <select
                value={
                  values.componentId
                }
                onChange={(event) =>
                  updateValue(
                    "componentId",
                    event.target.value,
                  )
                }
                className={INPUT_CLASS}
              >
                <option value="">
                  System-level event
                </option>

                {components.map(
                  (component) => (
                    <option
                      key={component.id}
                      value={component.id}
                    >
                      {component.name}
                    </option>
                  ),
                )}
              </select>
            </Field>

            <Field label="Event type">
              <select
                value={values.eventType}
                onChange={(event) =>
                  updateValue(
                    "eventType",
                    event.target.value,
                  )
                }
                className={INPUT_CLASS}
              >
                {HVAC_COMPONENT_EVENT_TYPES.map(
                  (value) => (
                    <option
                      key={value}
                      value={value}
                    >
                      {displayValue(value)}
                    </option>
                  ),
                )}
              </select>
            </Field>

            <Field label="Event date">
              <input
                type="date"
                value={values.occurredAt}
                onChange={(event) =>
                  updateValue(
                    "occurredAt",
                    event.target.value,
                  )
                }
                className={INPUT_CLASS}
              />
            </Field>

            <Field label="Failure symptoms">
              <input
                value={
                  values.failureSymptoms
                }
                onChange={(event) =>
                  updateValue(
                    "failureSymptoms",
                    event.target.value,
                  )
                }
                placeholder="No cooling, noise, leak"
                className={INPUT_CLASS}
              />
            </Field>

            <Field label="Work performed">
              <input
                value={
                  values.workPerformed
                }
                onChange={(event) =>
                  updateValue(
                    "workPerformed",
                    event.target.value,
                  )
                }
                placeholder="Inspection or repair"
                className={INPUT_CLASS}
              />
            </Field>

            <Field label="Event cost">
              <input
                type="number"
                min="0"
                step="0.01"
                value={
                  values.costDollars
                }
                onChange={(event) =>
                  updateValue(
                    "costDollars",
                    event.target.value,
                  )
                }
                placeholder="0.00"
                className={INPUT_CLASS}
              />
            </Field>

            <Field label="Vendor">
              <input
                value={values.vendorName}
                onChange={(event) =>
                  updateValue(
                    "vendorName",
                    event.target.value,
                  )
                }
                className={INPUT_CLASS}
              />
            </Field>

            <Field label="Invoice reference">
              <input
                value={
                  values.invoiceReference
                }
                onChange={(event) =>
                  updateValue(
                    "invoiceReference",
                    event.target.value,
                  )
                }
                className={INPUT_CLASS}
              />
            </Field>

            <Field label="Notes">
              <input
                value={values.notes}
                onChange={(event) =>
                  updateValue(
                    "notes",
                    event.target.value,
                  )
                }
                className={INPUT_CLASS}
              />
            </Field>
          </div>

          <PropertyHVACEventActionEditor
            components={components}
            actions={
              values.componentActions
            }
            onChange={(
              componentActions,
            ) =>
              updateValue(
                "componentActions",
                componentActions,
              )
            }
          />

          <div className="mt-5 rounded-lg bg-amber-50 px-3 py-2 text-xs font-bold leading-5 text-amber-900">
            Invoice upload creates only a review proposal. HVAC history changes only after this approval.
          </div>

          <button
            type="button"
            disabled={saving}
            onClick={recordEvent}
            className="mt-4 w-full rounded-xl bg-slate-950 px-5 py-4 text-base font-black text-white shadow-sm disabled:opacity-60"
          >
            {saving
              ? "Recording approved HVAC event..."
              : "3. Approve and record HVAC event"}
          </button>
        </div>
      )}

      {message && (
        <p
          role="status"
          className="mt-3 text-sm font-bold text-slate-600"
        >
          {message}
        </p>
      )}

      <div className="mt-6">
        <h6 className="text-sm font-black text-slate-950">
          Service history
        </h6>

        {events.length === 0 ? (
          <p className="mt-3 text-sm font-semibold text-slate-500">
            No service events recorded for this system.
          </p>
        ) : (
          <div className="mt-3 space-y-3">
            {events.map((event) => (
              <article
                key={event.id}
                className="rounded-xl border border-amber-200 bg-white p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-black text-slate-950">
                      {displayValue(
                        event.eventType,
                      )}
                    </div>

                    <div className="mt-1 text-xs font-bold text-slate-500">
                      {componentName(
                        event.componentId,
                      )}
                      {" · "}
                      {event.occurredAt
                        ? new Date(
                            event.occurredAt,
                          ).toLocaleDateString(
                            "en-US",
                            {
                              timeZone:
                                "UTC",
                            },
                          )
                        : "Date unavailable"}
                    </div>
                  </div>

                  <div className="text-sm font-black text-amber-800">
                    {event.costCents != null
                      ? new Intl.NumberFormat(
                          "en-US",
                          {
                            style: "currency",
                            currency: "USD",
                          },
                        ).format(
                          event.costCents /
                            100,
                        )
                      : "Cost not recorded"}
                  </div>
                </div>

                {(event.failureSymptoms ||
                  event.workPerformed) && (
                  <div className="mt-3 text-sm font-semibold leading-6 text-slate-600">
                    {event.failureSymptoms && (
                      <p>
                        Symptoms:{" "}
                        {event.failureSymptoms}
                      </p>
                    )}

                    {event.workPerformed && (
                      <p>
                        Work:{" "}
                        {event.workPerformed}
                      </p>
                    )}
                  </div>
                )}

                {event.componentActions?.length >
                  0 && (
                  <div className="mt-4 border-t border-amber-100 pt-3">
                    <div className="text-xs font-black uppercase tracking-wide text-amber-800">
                      Component actions
                    </div>

                    <div className="mt-2 space-y-2">
                      {event.componentActions.map(
                        (
                          action,
                          index,
                        ) => (
                          <div
                            key={`${action.actionType}-${action.description}-${index}`}
                            className="rounded-lg bg-amber-50 px-3 py-2"
                          >
                            <div className="text-xs font-black text-slate-950">
                              {displayValue(
                                action.actionType,
                              )}
                              {" · "}
                              {action.componentId
                                ? componentName(
                                    action.componentId,
                                  )
                                : action.componentType
                                  ? displayValue(
                                      action.componentType,
                                    )
                                  : "System action"}
                            </div>

                            <div className="mt-1 text-sm font-semibold text-slate-600">
                              {action.description}
                            </div>

                            {action.quantity !=
                              null && (
                              <div className="mt-1 text-xs font-bold text-slate-500">
                                {action.quantity}
                                {action.unit
                                  ? ` ${action.unit}`
                                  : ""}
                              </div>
                            )}
                          </div>
                        ),
                      )}
                    </div>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
