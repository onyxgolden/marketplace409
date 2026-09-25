"use client";

import {
  useState,
} from "react";

import {
  useStaleWhileRevalidate,
} from "@/hooks/useStaleWhileRevalidate";

import {
  ForgeEmptyState,
  ForgeErrorState,
  ForgeLoadingState,
} from "@/components/forge/ForgeStates";

import {
  HVAC_CONDITIONS,
  HVAC_ENERGY_SOURCES,
  HVAC_SYSTEM_STATUSES,
  HVAC_SYSTEM_TYPES,
} from "@/domains/property-hvac/property-hvac.types";

import PropertyHVACComponentPanel from "./PropertyHVACComponentPanel";
import PropertyEvidenceHistoryPanel from "./PropertyEvidenceHistoryPanel";
import PropertyHVACSystemReplacementPanel from "./PropertyHVACSystemReplacementPanel";

import PropertyHVACWorkflowChooser, {
  PropertyHVACWorkflowHeader,
} from "./PropertyHVACWorkflowChooser";

import {
  buildPropertyPortfolioProperties,
} from "./buildPropertyPortfolioProperties";

const INITIAL_SYSTEM = Object.freeze({
  name: "Main HVAC",
  systemType: "unknown",
  energySource: "unknown",
  refrigerantType: "",
  tonnage: "",
  efficiencyRating: "",
  manufacturer: "",
  modelNumber: "",
  serialNumber: "",
  installedAt: "",
  estimatedAgeYears: "",
  location: "",
  thermostatType: "",
  warrantyExpiration: "",
  status: "active",
  condition: "unknown",
  notes: "",
});

function displayValue(value) {
  return String(value || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) =>
      character.toUpperCase(),
    );
}

function optionalText(value) {
  return String(value || "").trim() || null;
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

export function buildHVACSystemPayload({
  propertyId,
  values,
}) {
  return {
    propertyId,
    name:
      values.name.trim() ||
      "Main HVAC",
    systemType: values.systemType,
    energySource:
      values.energySource,
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
    manufacturer:
      optionalText(
        values.manufacturer,
      ),
    modelNumber:
      optionalText(values.modelNumber),
    serialNumber:
      optionalText(values.serialNumber),
    installedAt:
      optionalDate(values.installedAt),
    estimatedAgeYears:
      optionalNumber(
        values.estimatedAgeYears,
      ),
    location:
      optionalText(values.location),
    thermostatType:
      optionalText(
        values.thermostatType,
      ),
    warrantyExpiration:
      optionalDate(
        values.warrantyExpiration,
      ),
    status: values.status,
    condition: values.condition,
    notes:
      optionalText(values.notes),
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

const INPUT_CLASS =
  "mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm font-bold normal-case text-slate-950 dark:bg-slate-800 dark:text-slate-50 dark:border-slate-700";

// Stale-while-revalidate fetchers: previously loaded properties and systems
// stay on screen while a refresh is in flight; only the first paint (nothing
// cached) shows a loading state.
async function fetchPortfolioProperties() {
  const response = await fetch(
    "/api/financial/read-models?financial=true&business=true",
  );

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(
      payload?.error ||
        "Property records could not be loaded.",
    );
  }

  return buildPropertyPortfolioProperties(payload);
}

async function fetchHVACSystems(propertyId) {
  const response = await fetch(
    `/api/property-hvac?propertyId=${encodeURIComponent(
      propertyId,
    )}`,
  );

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(
      payload?.error ||
        "HVAC systems could not be loaded.",
    );
  }

  return Array.isArray(payload?.systems)
    ? payload.systems
    : [];
}

export default function PropertyHVACPanel() {
  const [
    propertyId,
    setPropertyId,
  ] = useState("");
  const [
    propertyChosen,
    setPropertyChosen,
  ] = useState(false);

  // Properties: stale-while-revalidate under one global key. The cached
  // portfolio renders instantly on return visits and refreshes in the
  // background -- never a blank property dropdown.
  const {
    data: cachedProperties,
    error: propertiesError,
    isLoading: propertiesLoading,
    refresh: refreshProperties,
  } = useStaleWhileRevalidate(
    "property:portfolio-properties",
    fetchPortfolioProperties,
    { ttlMs: 60_000 },
  );

  // The selected property defaults to the first loaded property at render
  // time -- no synchronization effect, so a background refresh that
  // reorders the portfolio can never stomp the user's own selection.
  const properties = cachedProperties || [];
  const effectivePropertyId =
    propertyChosen
      ? propertyId
      : properties[0]?.id || "";

  // Systems: keyed per property. Switching properties serves the newly
  // selected property's cached systems instantly; a background refresh keeps
  // the stale list on screen with a subtle indicator.
  const {
    data: cachedSystems,
    error: systemsError,
    isLoading: systemsLoading,
    isRefreshing: systemsRefreshing,
    refresh: refreshSystems,
  } = useStaleWhileRevalidate(
    effectivePropertyId
      ? `property-hvac-systems:${effectivePropertyId}`
      : null,
    () => fetchHVACSystems(effectivePropertyId),
    { ttlMs: 60_000 },
  );

  const systems = cachedSystems || [];

  const [
    values,
    setValues,
  ] = useState({
    ...INITIAL_SYSTEM,
  });

  const [
    saving,
    setSaving,
  ] = useState(false);

  const [
    message,
    setMessage,
  ] = useState("");

  const [
    workflow,
    setWorkflow,
  ] = useState(null);

  const [
    showGuidance,
    setShowGuidance,
  ] = useState(() =>
    typeof window === "undefined"
      ? true
      : window.localStorage.getItem(
          "forge.display.guidance",
        ) !== "off",
  );

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

  function finishReplacement() {
    // The replacement transition arrives with the server's revalidated
    // system list, so the cache never drifts from what was just written.
    refreshSystems();

    setMessage(
      "HVAC replacement recorded.",
    );
    setWorkflow(null);
  }


  function updateValue(
    name,
    value,
  ) {
    setValues((current) => ({
      ...current,
      [name]: value,
    }));
  }

  async function saveSystem() {
    if (!effectivePropertyId) {
      setMessage("Choose a property.");
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
            operation: "save-system",
            system:
              buildHVACSystemPayload({
                propertyId: effectivePropertyId,
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
            "Unable to save the HVAC system.",
        );
      }

      if (payload?.system) {
        // Revalidate the system list -- the saved system arrives with the
        // server's list, so the cache never drifts from what was written.
        refreshSystems();
      }

      setValues({
        ...INITIAL_SYSTEM,
      });

      setMessage(
        "HVAC system saved.",
      );

      setWorkflow(null);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to save the HVAC system.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (!cachedProperties && propertiesLoading) {
    return (
      <ForgeLoadingState label="Loading HVAC systems…" />
    );
  }

  if (!cachedProperties && propertiesError) {
    return (
      <ForgeErrorState
        title="Property records could not be loaded."
        detail={propertiesError}
        onRetry={refreshProperties}
      />
    );
  }

  return (
    <section
      data-property-hvac-panel
      className={
        workflow === null
          ? "max-w-5xl rounded-2xl border border-slate-200 bg-white p-6 dark:bg-slate-900 dark:border-slate-800"
          : "rounded-2xl border border-slate-200 bg-white p-6 dark:bg-slate-900 dark:border-slate-800"
      }
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-xs font-black uppercase tracking-wide text-sky-700 dark:text-sky-400">
            Major Systems
          </div>

          <h4 className="mt-2 text-xl font-black text-slate-950 dark:text-slate-50">
            HVAC systems, components, and service history
          </h4>

          <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-slate-600 dark:text-slate-300">
            Record each system separately so service, components, failures, and replacements remain easy to follow.
          </p>
        </div>

      </div>

      {workflow === "add-system" && (
      <div className="mt-6 rounded-2xl border border-sky-200 bg-sky-50 p-5 dark:bg-sky-950/30">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs font-black uppercase tracking-wide text-sky-700 dark:text-sky-400">
              System Setup
            </div>
            <h5 className="mt-1 text-lg font-black text-slate-950 dark:text-slate-50">
              {systems.length === 0
                ? "Add this property’s first HVAC system"
                : "Add another HVAC system"}
            </h5>
          </div>

          <button
            type="button"
            onClick={() =>
              setWorkflow(null)
            }
            className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-black text-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700"
          >
            Back
          </button>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <Field label="System name">
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
              value={values.energySource}
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
              placeholder="Carrier"
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

          <Field label="Installation date">
            <input
              type="date"
              value={values.installedAt}
              onChange={(event) =>
                updateValue(
                  "installedAt",
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
                values.estimatedAgeYears
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

          <Field label="System status">
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
              {HVAC_SYSTEM_STATUSES.map(
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
              value={values.condition}
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

          <Field label="Notes">
            <input
              value={values.notes}
              onChange={(event) =>
                updateValue(
                  "notes",
                  event.target.value,
                )
              }
              placeholder="Observed equipment details"
              className={INPUT_CLASS}
            />
          </Field>
        </div>

        <button
          type="button"
          disabled={saving}
          onClick={saveSystem}
          className="mt-5 rounded-xl bg-sky-700 px-5 py-3 text-sm font-black text-white disabled:opacity-60"
        >
          {saving
            ? "Saving system..."
            : "Save HVAC system"}
        </button>

        {message && (
          <p
            role="status"
            className="mt-3 text-sm font-bold text-slate-600 dark:text-slate-300"
          >
            {message}
          </p>
        )}
      </div>
      )}

      {workflow === null && (
      <>
      <div className="mt-6 max-w-2xl">
        <Field label="Property">
          <select
            value={effectivePropertyId}
            onChange={(event) => {
              setPropertyId(
                event.target.value,
              );
              setPropertyChosen(true);
              setWorkflow(null);
            }}
            className={INPUT_CLASS}
          >
            <option value="">
              Choose a property
            </option>

            {properties.map((property) => (
              <option
                key={property.id}
                value={property.id}
              >
                {property.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="mt-7 max-w-3xl border-t border-slate-200 pt-6 dark:border-slate-800">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h5 className="text-sm font-black text-slate-950 dark:text-slate-50">
            HVAC systems
          </h5>

          {systems.length > 0 && (
            <button
              type="button"
              onClick={() =>
                setWorkflow("add-system")
              }
              className="rounded-xl border border-sky-300 bg-sky-50 px-4 py-2 text-sm font-black text-sky-800 dark:bg-sky-950/30"
            >
              Add another HVAC system
            </button>
          )}
        </div>

        {effectivePropertyId && !cachedSystems && systemsLoading ? (
          <ForgeLoadingState label="Loading HVAC systems…" />
        ) : effectivePropertyId && !cachedSystems && systemsError ? (
          <ForgeErrorState
            title="HVAC systems could not be loaded."
            detail={systemsError}
            onRetry={refreshSystems}
          />
        ) : systems.length === 0 ? (
          <div className="mt-4 max-w-xl">
            <ForgeEmptyState
              headline="No HVAC system is recorded for this property."
              guidance="Add the property's first HVAC system to start tracking components and service history."
              actionLabel="Add this property’s first HVAC system"
              onAction={() =>
                setWorkflow("add-system")
              }
            />
          </div>
        ) : (
          <>
            {systemsRefreshing || systemsLoading ? (
              <p className="mt-2 text-xs font-bold text-slate-400 dark:text-slate-500">
                Updating…
              </p>
            ) : null}

            {systemsError ? (
              <p role="status" className="mt-2 text-xs font-bold text-slate-400 dark:text-slate-500">
                Could not refresh — showing the last saved systems.
              </p>
            ) : null}

          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {systems.map((system) => (
              <article
                key={system.id}
                className="rounded-xl border border-slate-200 p-4 dark:border-slate-800"
              >
                <div className="text-sm font-black text-slate-950 dark:text-slate-50">
                  {system.name}
                </div>

                <div className="mt-1 text-xs font-bold text-slate-500 dark:text-slate-400">
                  {displayValue(
                    system.systemType,
                  )}
                  {" · "}
                  {displayValue(
                    system.condition,
                  )}
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
                  <span>
                    {system.manufacturer ||
                      "Manufacturer unknown"}
                  </span>

                  <span>
                    {system.estimatedAgeYears ??
                      "Age unknown"}
                    {system.estimatedAgeYears !=
                    null
                      ? " years"
                      : ""}
                  </span>

                  <span>
                    {system.refrigerantType ||
                      "Refrigerant unknown"}
                  </span>

                  <span>
                    {system.tonnage != null
                      ? `${system.tonnage} tons`
                      : "Tonnage unknown"}
                  </span>
                </div>
              </article>
            ))}
          </div>
          </>
        )}
      </div>

      {systems.length > 0 && (
        <PropertyHVACWorkflowChooser
          showGuidance={showGuidance}
          onToggleGuidance={
            toggleGuidance
          }
          onChoose={setWorkflow}
        />
      )}
      </>
      )}

      {[
        "service",
        "component",
        "failure",
      ].includes(workflow) && (
        <div className="mt-6">
          <PropertyHVACWorkflowHeader
            workflowId={workflow}
            showGuidance={
              showGuidance
            }
            onBack={() =>
              setWorkflow(null)
            }
          />

          <PropertyHVACComponentPanel
            systems={systems}
            mode={workflow}
            focused
          />
        </div>
      )}

      {workflow === "replacement" && (
        <div className="mt-6">
          <PropertyHVACWorkflowHeader
            workflowId="replacement"
            showGuidance={
              showGuidance
            }
            onBack={() =>
              setWorkflow(null)
            }
          />

          <PropertyHVACSystemReplacementPanel
            systems={systems}
            onSaved={
              finishReplacement
            }
          />
        </div>
      )}

      {workflow === "evidence" && (
        <div className="mt-6">
          <PropertyHVACWorkflowHeader
            workflowId="evidence"
            showGuidance={
              showGuidance
            }
            onBack={() =>
              setWorkflow(null)
            }
          />

          <PropertyEvidenceHistoryPanel
            propertyId={effectivePropertyId}
            systems={systems}
          />
        </div>
      )}
    </section>
  );
}
