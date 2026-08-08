"use client";

import {
  useState,
} from "react";

import {
  HVAC_COMPONENT_EVENT_TYPES,
} from "@/domains/property-hvac/property-hvac.types";

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
    notes: optionalText(values.notes),
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
  systemId = "",
  components = [],
  events = [],
  onEventSaved = () => {},
}) {
  const [
    values,
    setValues,
  ] = useState({
    componentId: "",
    eventType: "inspected",
    occurredAt: todayValue(),
    failureSymptoms: "",
    workPerformed: "",
    costDollars: "",
    vendorName: "",
    invoiceReference: "",
    notes: "",
  });

  const [
    saving,
    setSaving,
  ] = useState(false);

  const [
    message,
    setMessage,
  ] = useState("");

  function updateValue(
    name,
    value,
  ) {
    setValues((current) => ({
      ...current,
      [name]: value,
    }));
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
          body: JSON.stringify({
            operation:
              "record-component-event",
            event:
              buildHVACEventPayload({
                systemId,
                values,
              }),
          }),
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
        notes: "",
      }));

      setMessage(
        "HVAC service event recorded.",
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
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-xs font-black uppercase tracking-wide text-amber-800">
            Append-Only History
          </div>

          <h5 className="mt-2 text-lg font-black text-slate-950">
            Service, failure, and replacement events
          </h5>

          <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-slate-600">
            Preserve what happened, when it happened, which component was involved, who performed the work, and what it cost.
          </p>
        </div>

        <button
          type="button"
          disabled
          className="rounded-xl border border-dashed border-amber-300 bg-white px-4 py-2 text-xs font-black text-amber-700 opacity-70"
        >
          Add invoice or service photo — planned
        </button>
      </div>

      {!systemId ? (
        <p className="mt-4 text-sm font-bold text-slate-600">
          Choose an HVAC system before recording events.
        </p>
      ) : (
        <div className="mt-5 rounded-2xl border border-amber-200 bg-white p-5">
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

          <button
            type="button"
            disabled={saving}
            onClick={recordEvent}
            className="mt-5 rounded-xl bg-amber-700 px-5 py-3 text-sm font-black text-white disabled:opacity-60"
          >
            {saving
              ? "Recording event..."
              : "Record HVAC event"}
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
                          ).toLocaleDateString()
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
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
