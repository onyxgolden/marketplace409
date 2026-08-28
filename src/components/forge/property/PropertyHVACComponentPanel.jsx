"use client";

import {
  useEffect,
  useState,
} from "react";

import {
  HVAC_COMPONENT_STATUSES,
  HVAC_COMPONENT_TYPES,
  HVAC_CONDITIONS,
} from "@/domains/property-hvac/property-hvac.types";

import PropertyHVACEventPanel from "./PropertyHVACEventPanel";

const INITIAL_COMPONENT =
Object.freeze({
  componentType: "compressor",
  name: "Compressor",
  manufacturer: "",
  modelNumber: "",
  partNumber: "",
  serialNumber: "",
  installedAt: "",
  removedAt: "",
  estimatedAgeYears: "",
  condition: "unknown",
  status: "installed",
  estimatedReplacementCostDollars:
    "",
  vendorName: "",
  invoiceReference: "",
  warrantyExpiration: "",
  notes: "",
});

const INPUT_CLASS =
  "mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm font-bold normal-case text-slate-950 dark:bg-slate-800 dark:text-slate-50 dark:border-slate-700";

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

function optionalNumber(value) {
  if (value === "") {
    return null;
  }

  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : null;
}

function optionalDate(value) {
  return value
    ? new Date(
        `${value}T00:00:00.000Z`,
      ).toISOString()
    : null;
}

export function buildHVACComponentPayload({
  systemId,
  values,
}) {
  const replacementDollars =
    values
      .estimatedReplacementCostDollars;

  return {
    systemId,
    componentType:
      values.componentType,
    name:
      values.name.trim() ||
      displayValue(
        values.componentType,
      ),
    manufacturer:
      optionalText(
        values.manufacturer,
      ),
    modelNumber:
      optionalText(
        values.modelNumber,
      ),
    partNumber:
      optionalText(values.partNumber),
    serialNumber:
      optionalText(
        values.serialNumber,
      ),
    installedAt:
      optionalDate(values.installedAt),
    removedAt:
      optionalDate(values.removedAt),
    estimatedAgeYears:
      optionalNumber(
        values.estimatedAgeYears,
      ),
    condition: values.condition,
    status: values.status,
    estimatedReplacementCostCents:
      replacementDollars === ""
        ? null
        : Math.round(
            Number(
              replacementDollars,
            ) * 100,
          ),
    vendorName:
      optionalText(values.vendorName),
    invoiceReference:
      optionalText(
        values.invoiceReference,
      ),
    warrantyExpiration:
      optionalDate(
        values.warrantyExpiration,
      ),
    notes: optionalText(values.notes),
  };
}

function Field({
  label,
  children,
}) {
  return (
    <label className="text-xs font-black uppercase tracking-wide text-slate-600 dark:text-slate-400">
      {label}
      {children}
    </label>
  );
}

export default function PropertyHVACComponentPanel({
  systems = [],
  mode = "all",
  focused = false,
}) {
  const [
    systemId,
    setSystemId,
  ] = useState(
    () =>
      systems[0]?.id || "",
  );

  const [
    history,
    setHistory,
  ] = useState(null);

  const [
    values,
    setValues,
  ] = useState({
    ...INITIAL_COMPONENT,
  });

  const [
    loading,
    setLoading,
  ] = useState(false);

  const [
    saving,
    setSaving,
  ] = useState(false);

  const [
    message,
    setMessage,
  ] = useState("");

  useEffect(() => {
    if (
      !systemId &&
      systems[0]?.id
    ) {
      setSystemId(systems[0].id);
    }

    if (
      systemId &&
      !systems.some(
        (system) =>
          system.id === systemId,
      )
    ) {
      setSystemId(
        systems[0]?.id || "",
      );
    }
  }, [
    systemId,
    systems,
  ]);

  useEffect(() => {
    if (!systemId) {
      setHistory(null);
      return;
    }

    let active = true;

    async function loadHistory() {
      setLoading(true);

      try {
        const response = await fetch(
          `/api/property-hvac?systemId=${encodeURIComponent(
            systemId,
          )}`,
        );

        const payload =
          await response.json();

        if (!response.ok) {
          throw new Error(
            payload?.error ||
              "Unable to load HVAC history.",
          );
        }

        if (active) {
          setHistory(
            payload?.history || null,
          );
        }
      } catch (error) {
        if (active) {
          setHistory(null);
          setMessage(
            error instanceof Error
              ? error.message
              : "Unable to load HVAC history.",
          );
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadHistory();

    return () => {
      active = false;
    };
  }, [systemId]);

  function updateValue(
    name,
    value,
  ) {
    setValues((current) => ({
      ...current,
      [name]: value,
    }));
  }

  function changeComponentType(
    componentType,
  ) {
    setValues((current) => ({
      ...current,
      componentType,
      name:
        current.name ===
          displayValue(
            current.componentType,
          ) ||
        current.name ===
          "Compressor"
          ? displayValue(
              componentType,
            )
          : current.name,
    }));
  }

  async function saveComponent() {
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
              "save-component",
            component:
              buildHVACComponentPayload({
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
            "Unable to save the HVAC component.",
        );
      }

      if (payload?.component) {
        setHistory((current) => ({
          system:
            current?.system ||
            systems.find(
              (system) =>
                system.id === systemId,
            ) ||
            null,
          components: [
            payload.component,
            ...(
              current?.components || []
            ).filter(
              (component) =>
                component.id !==
                payload.component.id,
            ),
          ],
          events:
            current?.events || [],
        }));
      }

      setValues({
        ...INITIAL_COMPONENT,
      });

      setMessage(
        "HVAC component saved.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to save the HVAC component.",
      );
    } finally {
      setSaving(false);
    }
  }

  const components =
    history?.components || [];

  const showComponentEditor =
    mode === "all" ||
    mode === "component";

  const showEventEditor =
    mode === "all" ||
    mode === "service" ||
    mode === "component" ||
    mode === "failure";

  const initialEventType =
    mode === "failure"
      ? "failed"
      : mode === "component"
        ? "repaired"
        : "inspected";

  return (
    <section
      data-property-hvac-component-panel
      data-property-hvac-mode={mode}
      className={
        focused
          ? "mt-6"
          : "mt-7 rounded-2xl border border-sky-200 bg-sky-50 p-5 dark:bg-sky-950/30"
      }
    >
      {!focused && (
      <div>
        <div className="text-xs font-black uppercase tracking-wide text-sky-700 dark:text-sky-400">
          Replaceable Components
        </div>

        <h5 className="mt-2 text-lg font-black text-slate-950 dark:text-slate-50">
          Component identity and replacement history
        </h5>

        <p className="mt-2 text-sm font-semibold leading-6 text-slate-600 dark:text-slate-300">
          Track component age independently from the overall system so compressor, motor, coil, control, and warranty history is preserved.
        </p>
      </div>
      )}

      <div className="mt-5 max-w-2xl">
        <Field label="HVAC system">
          <select
            value={systemId}
            onChange={(event) =>
              setSystemId(
                event.target.value,
              )
            }
            className={INPUT_CLASS}
          >
            <option value="">
              Choose a system
            </option>

            {systems.map((system) => (
              <option
                key={system.id}
                value={system.id}
              >
                {system.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {showComponentEditor && (
      systems.length === 0 ? (
        <p className="mt-4 text-sm font-bold text-slate-600 dark:text-slate-300">
          Save an HVAC system before adding its components.
        </p>
      ) : (
        <div className="mt-5 rounded-2xl border border-sky-200 bg-white p-5 dark:bg-slate-900">
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Component type">
              <select
                value={
                  values.componentType
                }
                onChange={(event) =>
                  changeComponentType(
                    event.target.value,
                  )
                }
                className={INPUT_CLASS}
              >
                {HVAC_COMPONENT_TYPES.map(
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

            <Field label="Component name">
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

            <Field label="Component status">
              <select
                value={values.status}
                onChange={(event) =>
                  updateValue(
                    "status",
                    event.target.value,
                  )
                }
                className={INPUT_CLASS}
              >
                {HVAC_COMPONENT_STATUSES.map(
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

            <Field label="Condition">
              <select
                value={
                  values.condition
                }
                onChange={(event) =>
                  updateValue(
                    "condition",
                    event.target.value,
                  )
                }
                className={INPUT_CLASS}
              >
                {HVAC_CONDITIONS.map(
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
                value={
                  values.manufacturer
                }
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
                value={
                  values.modelNumber
                }
                onChange={(event) =>
                  updateValue(
                    "modelNumber",
                    event.target.value,
                  )
                }
                className={INPUT_CLASS}
              />
            </Field>

            <Field label="Part number">
              <input
                value={
                  values.partNumber
                }
                onChange={(event) =>
                  updateValue(
                    "partNumber",
                    event.target.value,
                  )
                }
                className={INPUT_CLASS}
              />
            </Field>

            <Field label="Serial number">
              <input
                value={
                  values.serialNumber
                }
                onChange={(event) =>
                  updateValue(
                    "serialNumber",
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
                  values.installedAt
                }
                onChange={(event) =>
                  updateValue(
                    "installedAt",
                    event.target.value,
                  )
                }
                className={INPUT_CLASS}
              />
            </Field>

            <Field label="Removal date">
              <input
                type="date"
                value={values.removedAt}
                onChange={(event) =>
                  updateValue(
                    "removedAt",
                    event.target.value,
                  )
                }
                className={INPUT_CLASS}
              />
            </Field>

            <Field label="Estimated age">
              <input
                type="number"
                min="0"
                step="0.5"
                value={
                  values
                    .estimatedAgeYears
                }
                onChange={(event) =>
                  updateValue(
                    "estimatedAgeYears",
                    event.target.value,
                  )
                }
                className={INPUT_CLASS}
              />
            </Field>

            <Field label="Replacement cost">
              <input
                type="number"
                min="0"
                step="0.01"
                value={
                  values
                    .estimatedReplacementCostDollars
                }
                onChange={(event) =>
                  updateValue(
                    "estimatedReplacementCostDollars",
                    event.target.value,
                  )
                }
                placeholder="0.00"
                className={INPUT_CLASS}
              />
            </Field>

            <Field label="Vendor">
              <input
                value={
                  values.vendorName
                }
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

            <Field label="Warranty expiration">
              <input
                type="date"
                value={
                  values
                    .warrantyExpiration
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
            onClick={saveComponent}
            className="mt-5 rounded-xl bg-sky-700 px-5 py-3 text-sm font-black text-white disabled:opacity-60"
          >
            {saving
              ? "Saving component..."
              : "Save HVAC component"}
          </button>
        </div>
      )
      )}

      {message && (
        <p
          role="status"
          className="mt-3 text-sm font-bold text-slate-600 dark:text-slate-300"
        >
          {message}
        </p>
      )}

      {showComponentEditor && (
      <div className="mt-6">
        <h6 className="text-sm font-black text-slate-950 dark:text-slate-50">
          Recorded components
        </h6>

        {loading ? (
          <p className="mt-3 text-sm font-semibold text-slate-500 dark:text-slate-400">
            Loading component history...
          </p>
        ) : components.length === 0 ? (
          <p className="mt-3 text-sm font-semibold text-slate-500 dark:text-slate-400">
            No components recorded for this system.
          </p>
        ) : (
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {components.map(
              (component) => (
                <article
                  key={component.id}
                  className="rounded-xl border border-sky-200 bg-white p-4 dark:bg-slate-900"
                >
                  <div className="text-sm font-black text-slate-950 dark:text-slate-50">
                    {component.name}
                  </div>

                  <div className="mt-1 text-xs font-bold text-slate-500 dark:text-slate-400">
                    {displayValue(
                      component.componentType,
                    )}
                    {" · "}
                    {displayValue(
                      component.status,
                    )}
                    {" · "}
                    {displayValue(
                      component.condition,
                    )}
                  </div>

                  <div className="mt-3 text-xs font-semibold text-slate-600 dark:text-slate-300">
                    {component.manufacturer ||
                      "Manufacturer unknown"}
                    {" · "}
                    {component.estimatedAgeYears !=
                    null
                      ? `${component.estimatedAgeYears} years`
                      : "Age unknown"}
                  </div>
                </article>
              ),
            )}
          </div>
        )}
      </div>
      )}

      {showEventEditor && (
      <PropertyHVACEventPanel
        propertyId={
          history?.system
            ?.propertyId ||
          systems.find(
            (system) =>
              system.id ===
              systemId,
          )?.propertyId ||
          ""
        }
        systemId={systemId}
        components={components}
        events={history?.events || []}
        initialEventType={
          initialEventType
        }
        onEventSaved={(savedEvent) =>
          setHistory((current) => ({
            system:
              current?.system ||
              systems.find(
                (system) =>
                  system.id === systemId,
              ) ||
              null,
            components:
              current?.components || [],
            events: [
              savedEvent,
              ...(
                current?.events || []
              ).filter(
                (event) =>
                  event.id !==
                  savedEvent.id,
              ),
            ],
          }))
        }
      />
      )}

    </section>
  );
}
