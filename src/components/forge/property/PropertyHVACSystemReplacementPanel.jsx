"use client";

import {
  useState,
} from "react";

import {
  HVAC_ENERGY_SOURCES,
  HVAC_SYSTEM_TYPES,
} from "@/domains/property-hvac/property-hvac.types";

const INPUT_CLASS =
  "mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm font-bold normal-case text-slate-950";

function today() {
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

function timestamp(value) {
  return value
    ? new Date(
        `${value}T00:00:00.000Z`,
      ).toISOString()
    : null;
}

function optionalText(value) {
  return String(value || "").trim() ||
    null;
}

function optionalNumber(value) {
  if (value === "") {
    return null;
  }

  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : null;
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

export function buildHVACReplacementPayload({
  predecessorSystemId,
  values,
}) {
  return {
    predecessorSystemId,
    evidenceId:
      optionalText(values.evidenceId),
    occurredAt:
      timestamp(values.installationDate),
    replacementSystem: {
      name:
        values.name.trim() ||
        "Replacement HVAC",
      systemType: values.systemType,
      energySource:
        values.energySource,
      manufacturer:
        optionalText(
          values.manufacturer,
        ),
      modelNumber:
        optionalText(
          values.modelNumber,
        ),
      serialNumber:
        optionalText(
          values.serialNumber,
        ),
      refrigerantType:
        optionalText(
          values.refrigerantType,
        ),
      tonnage:
        optionalNumber(values.tonnage),
      efficiencyRating:
        optionalText(
          values.efficiencyRating,
        ),
      location:
        optionalText(values.location),
      thermostatType:
        optionalText(
          values.thermostatType,
        ),
      warrantyExpiration:
        timestamp(
          values.warrantyExpiration,
        ),
      installedAt:
        timestamp(
          values.installationDate,
        ),
      condition: "good",
    },
    failureEvent: {
      occurredAt:
        timestamp(values.failureDate),
      failureSymptoms:
        optionalText(
          values.failureSymptoms,
        ),
      notes:
        optionalText(
          values.failureNotes,
        ),
    },
    installationEvent: {
      occurredAt:
        timestamp(
          values.installationDate,
        ),
      workPerformed:
        optionalText(
          values.workPerformed,
        ) ||
        "Installed replacement HVAC system.",
      cost:
        values.cost === ""
          ? null
          : Number(values.cost),
      vendorName:
        optionalText(values.vendorName),
      invoiceReference:
        optionalText(
          values.invoiceReference,
        ),
      notes:
        optionalText(
          values.installationNotes,
        ),
    },
    initialComponents: [],
  };
}

export default function PropertyHVACSystemReplacementPanel({
  systems = [],
  onSaved = () => {},
}) {
  const currentSystems =
    systems.filter(
      (system) =>
        system.status !== "replaced" &&
        system.status !== "removed",
    );

  const [
    predecessorSystemId,
    setPredecessorSystemId,
  ] = useState(
    () =>
      currentSystems[0]?.id || "",
  );

  const [
    values,
    setValues,
  ] = useState(() => ({
    name: "Replacement HVAC",
    systemType: "unknown",
    energySource: "unknown",
    manufacturer: "",
    modelNumber: "",
    serialNumber: "",
    refrigerantType: "",
    tonnage: "",
    efficiencyRating: "",
    location: "",
    thermostatType: "",
    warrantyExpiration: "",
    failureDate: today(),
    failureSymptoms: "",
    failureNotes: "",
    installationDate: today(),
    workPerformed:
      "Installed replacement HVAC system.",
    cost: "",
    vendorName: "",
    invoiceReference: "",
    evidenceId: "",
    installationNotes: "",
  }));

  const [
    approved,
    setApproved,
  ] = useState(false);

  const [
    saving,
    setSaving,
  ] = useState(false);

  const [
    message,
    setMessage,
  ] = useState("");

  function updateValue(name, value) {
    setValues((current) => ({
      ...current,
      [name]: value,
    }));
  }

  async function saveReplacement() {
    if (!predecessorSystemId) {
      setMessage(
        "Choose the HVAC system being replaced.",
      );
      return;
    }

    if (!approved) {
      setMessage(
        "Confirm the permanent replacement transition before continuing.",
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
              "replace-system",
            replacement:
              buildHVACReplacementPayload({
                predecessorSystemId,
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
            "Unable to replace the HVAC system.",
        );
      }

      setMessage(
        "HVAC replacement recorded.",
      );

      onSaved(payload.replacement);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to replace the HVAC system.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      data-property-hvac-system-replacement-panel
      className="mt-6"
    >
      <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-5">
        <div className="text-xs font-black uppercase tracking-wide text-amber-800">
          Permanent lifecycle transition
        </div>

        <p className="mt-2 max-w-4xl text-sm font-bold leading-6 text-amber-950">
          Approval permanently marks the former system as replaced, records its failure, creates the new active system, and links both records. Existing history is preserved and is not overwritten.
        </p>
      </div>

      {currentSystems.length === 0 ? (
        <p className="mt-5 text-sm font-bold text-slate-600">
          No current HVAC system is available to replace.
        </p>
      ) : (
        <>
          <div className="mt-5 grid gap-4 md:grid-cols-3">
            <Field label="System being replaced">
              <select
                value={predecessorSystemId}
                onChange={(event) =>
                  setPredecessorSystemId(
                    event.target.value,
                  )
                }
                className={INPUT_CLASS}
              >
                {currentSystems.map(
                  (system) => (
                    <option
                      key={system.id}
                      value={system.id}
                    >
                      {system.name}
                    </option>
                  ),
                )}
              </select>
            </Field>

            <Field label="Failure date">
              <input
                type="date"
                value={values.failureDate}
                onChange={(event) =>
                  updateValue(
                    "failureDate",
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
                placeholder="Compressor failed"
                className={INPUT_CLASS}
              />
            </Field>

            <Field label="Replacement system name">
              <input
                value={values.name}
                onChange={(event) =>
                  updateValue(
                    "name",
                    event.target.value,
                  )
                }
                className={INPUT_CLASS}
              />
            </Field>

            <Field label="System type">
              <select
                value={values.systemType}
                onChange={(event) =>
                  updateValue(
                    "systemType",
                    event.target.value,
                  )
                }
                className={INPUT_CLASS}
              >
                {HVAC_SYSTEM_TYPES.map(
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

            <Field label="Energy source">
              <select
                value={
                  values.energySource
                }
                onChange={(event) =>
                  updateValue(
                    "energySource",
                    event.target.value,
                  )
                }
                className={INPUT_CLASS}
              >
                {HVAC_ENERGY_SOURCES.map(
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

            <Field label="Manufacturer">
              <input
                value={values.manufacturer}
                onChange={(event) =>
                  updateValue(
                    "manufacturer",
                    event.target.value,
                  )
                }
                className={INPUT_CLASS}
              />
            </Field>

            <Field label="Model number">
              <input
                value={values.modelNumber}
                onChange={(event) =>
                  updateValue(
                    "modelNumber",
                    event.target.value,
                  )
                }
                className={INPUT_CLASS}
              />
            </Field>

            <Field label="Serial number">
              <input
                value={values.serialNumber}
                onChange={(event) =>
                  updateValue(
                    "serialNumber",
                    event.target.value,
                  )
                }
                className={INPUT_CLASS}
              />
            </Field>

            <Field label="Refrigerant type">
              <input
                value={
                  values.refrigerantType
                }
                onChange={(event) =>
                  updateValue(
                    "refrigerantType",
                    event.target.value,
                  )
                }
                placeholder="R-410A"
                className={INPUT_CLASS}
              />
            </Field>

            <Field label="Tonnage">
              <input
                type="number"
                min="0"
                step="0.5"
                value={values.tonnage}
                onChange={(event) =>
                  updateValue(
                    "tonnage",
                    event.target.value,
                  )
                }
                className={INPUT_CLASS}
              />
            </Field>

            <Field label="Efficiency rating">
              <input
                value={
                  values.efficiencyRating
                }
                onChange={(event) =>
                  updateValue(
                    "efficiencyRating",
                    event.target.value,
                  )
                }
                placeholder="16 SEER"
                className={INPUT_CLASS}
              />
            </Field>

            <Field label="Location">
              <input
                value={values.location}
                onChange={(event) =>
                  updateValue(
                    "location",
                    event.target.value,
                  )
                }
                placeholder="Attic and exterior"
                className={INPUT_CLASS}
              />
            </Field>

            <Field label="Thermostat type">
              <input
                value={
                  values.thermostatType
                }
                onChange={(event) =>
                  updateValue(
                    "thermostatType",
                    event.target.value,
                  )
                }
                placeholder="Smart thermostat"
                className={INPUT_CLASS}
              />
            </Field>

            <Field label="Warranty expiration">
              <input
                type="date"
                value={
                  values.warrantyExpiration
                }
                onChange={(event) =>
                  updateValue(
                    "warrantyExpiration",
                    event.target.value,
                  )
                }
                className={INPUT_CLASS}
              />
            </Field>

            <Field label="Installation date">
              <input
                type="date"
                value={
                  values.installationDate
                }
                onChange={(event) =>
                  updateValue(
                    "installationDate",
                    event.target.value,
                  )
                }
                className={INPUT_CLASS}
              />
            </Field>

            <Field label="Installer or vendor">
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

            <Field label="Installed cost">
              <input
                type="number"
                min="0"
                step="0.01"
                value={values.cost}
                onChange={(event) =>
                  updateValue(
                    "cost",
                    event.target.value,
                  )
                }
                placeholder="0.00"
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

            <Field label="Evidence ID">
              <input
                value={values.evidenceId}
                onChange={(event) =>
                  updateValue(
                    "evidenceId",
                    event.target.value,
                  )
                }
                placeholder="Optional"
                className={INPUT_CLASS}
              />
            </Field>

            <Field label="Installation notes">
              <input
                value={
                  values.installationNotes
                }
                onChange={(event) =>
                  updateValue(
                    "installationNotes",
                    event.target.value,
                  )
                }
                className={INPUT_CLASS}
              />
            </Field>
          </div>

          <label className="mt-6 flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm font-bold leading-6 text-amber-950">
            <input
              type="checkbox"
              checked={approved}
              onChange={(event) =>
                setApproved(
                  event.target.checked,
                )
              }
              className="mt-1"
            />

            <span>
              I reviewed this transition and approve permanently linking the former and replacement HVAC systems.
            </span>
          </label>

          <button
            type="button"
            disabled={
              saving ||
              !approved
            }
            onClick={saveReplacement}
            className="mt-5 w-full rounded-xl bg-slate-950 px-5 py-4 text-base font-black text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving
              ? "Recording replacement..."
              : "Approve and record complete replacement"}
          </button>
        </>
      )}

      {message && (
        <p
          role="status"
          className="mt-4 text-sm font-bold text-slate-700"
        >
          {message}
        </p>
      )}
    </section>
  );
}
