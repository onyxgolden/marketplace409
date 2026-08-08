"use client";

import {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  PROPERTY_CONDITION_SECTIONS,
  PROPERTY_CONDITION_OBSERVATION_STATUSES,
} from "@/domains/property-condition-assessment/property-condition-assessment.types";

import {
  getPropertyConditionChecklistBySection,
  getPropertyConditionChecklistItem,
} from "@/domains/property-condition-assessment/property-condition-assessment.catalog";

import {
  buildPropertyPortfolioProperties,
} from "./buildPropertyPortfolioProperties";

const SECTION_LABELS = Object.freeze({
  structural_systems: "Structural systems",
  electrical_systems: "Electrical systems",
  hvac_systems: "HVAC systems",
  plumbing_systems: "Plumbing systems",
  appliances: "Appliances",
  optional_systems: "Optional systems",
});

function todayValue() {
  return new Date().toISOString().slice(0, 10);
}

function displayValue(value) {
  return String(value || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) =>
      character.toUpperCase(),
    );
}

function checklistItemKey(definition) {
  return (
    definition?.itemKey ||
    definition?.key ||
    definition?.id ||
    ""
  );
}

function checklistItemLabel(definition) {
  return (
    definition?.label ||
    definition?.name ||
    displayValue(
      checklistItemKey(definition),
    )
  );
}

function attributeDefinitions(definition) {
  const definitions =
    definition?.attributes ||
    definition?.attributeDefinitions ||
    definition?.fields ||
    [];

  return Array.isArray(definitions)
    ? definitions
    : [];
}

function attributeKey(definition) {
  return (
    definition?.key ||
    definition?.name ||
    definition?.id ||
    ""
  );
}

function attributeLabel(definition) {
  return (
    definition?.label ||
    displayValue(
      attributeKey(definition),
    )
  );
}

function attributeOptions(definition) {
  const options =
    definition?.options ||
    definition?.values ||
    [];

  return Array.isArray(options)
    ? options
    : [];
}

function normalizeAttributeValue(
  definition,
  value,
) {
  if (value === "") {
    return undefined;
  }

  const inputType =
    definition?.inputType ||
    definition?.type;

  if (
    inputType === "number" ||
    inputType === "integer"
  ) {
    const numericValue = Number(value);

    return Number.isFinite(numericValue)
      ? numericValue
      : undefined;
  }

  if (inputType === "boolean") {
    return value === "true";
  }

  return value;
}

export function buildConditionObservation({
  section,
  itemKey,
  status,
  attributes = {},
  notes = "",
  estimatedReplacementCostCents = "",
  plannedReplacementYear = "",
}) {
  const observation = {
    section,
    itemKey,
    systemKey: itemKey,
    status,
    attributes,
    notes: notes.trim() || null,
  };

  if (
    estimatedReplacementCostCents !== ""
  ) {
    observation.estimatedReplacementCostCents =
      Number(
        estimatedReplacementCostCents,
      );
  }

  if (plannedReplacementYear !== "") {
    observation.plannedReplacementYear =
      Number(plannedReplacementYear);
  }

  return observation;
}

export default function PropertyConditionAssessmentPanel() {
  const [
    properties,
    setProperties,
  ] = useState([]);

  const [
    assessments,
    setAssessments,
  ] = useState([]);

  const [
    propertyId,
    setPropertyId,
  ] = useState("");

  const [
    effectiveAt,
    setEffectiveAt,
  ] = useState(todayValue);

  const [
    summary,
    setSummary,
  ] = useState("");

  const [
    section,
    setSection,
  ] = useState(
    PROPERTY_CONDITION_SECTIONS[0],
  );

  const sectionItems = useMemo(
    () =>
      getPropertyConditionChecklistBySection(
        section,
      ),
    [section],
  );

  const [
    itemKey,
    setItemKey,
  ] = useState("");

  const selectedDefinition = useMemo(
    () =>
      itemKey
        ? getPropertyConditionChecklistItem(
            itemKey,
          )
        : null,
    [itemKey],
  );

  const [
    status,
    setStatus,
  ] = useState(
    PROPERTY_CONDITION_OBSERVATION_STATUSES[0],
  );

  const [
    attributes,
    setAttributes,
  ] = useState({});

  const [
    notes,
    setNotes,
  ] = useState("");

  const [
    replacementCostDollars,
    setReplacementCostDollars,
  ] = useState("");

  const [
    replacementYear,
    setReplacementYear,
  ] = useState("");

  const [
    observations,
    setObservations,
  ] = useState([]);

  const [
    message,
    setMessage,
  ] = useState("");

  const [
    saving,
    setSaving,
  ] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadProperties() {
      try {
        const response = await fetch(
          "/api/financial/read-models?financial=true&business=true",
        );

        const payload =
          await response.json();

        if (!active) {
          return;
        }

        const loadedProperties =
          buildPropertyPortfolioProperties(
            payload,
          );

        setProperties(loadedProperties);

        if (loadedProperties[0]) {
          setPropertyId(
            loadedProperties[0].id,
          );
        }
      } catch {
        if (active) {
          setMessage(
            "Property records could not be loaded.",
          );
        }
      }
    }

    loadProperties();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!propertyId) {
      setAssessments([]);
      return;
    }

    let active = true;

    async function loadAssessments() {
      try {
        const response = await fetch(
          `/api/property-condition-assessments?propertyId=${encodeURIComponent(
            propertyId,
          )}`,
        );

        const payload =
          await response.json();

        if (!active) {
          return;
        }

        setAssessments(
          Array.isArray(payload?.assessments)
            ? payload.assessments
            : [],
        );
      } catch {
        if (active) {
          setAssessments([]);
        }
      }
    }

    loadAssessments();

    return () => {
      active = false;
    };
  }, [propertyId]);

  function changeSection(nextSection) {
    setSection(nextSection);
    setItemKey("");
    setAttributes({});
  }

  function changeItem(nextItemKey) {
    setItemKey(nextItemKey);
    setAttributes({});
  }

  function updateAttribute(
    definition,
    value,
  ) {
    const key =
      attributeKey(definition);

    const normalizedValue =
      normalizeAttributeValue(
        definition,
        value,
      );

    setAttributes((current) => {
      const next = {
        ...current,
      };

      if (normalizedValue === undefined) {
        delete next[key];
      } else {
        next[key] = normalizedValue;
      }

      return next;
    });
  }

  function addObservation() {
    if (!itemKey) {
      setMessage(
        "Choose a checklist item first.",
      );
      return;
    }

    if (
      observations.some(
        (observation) =>
          observation.itemKey === itemKey,
      )
    ) {
      setMessage(
        "That checklist item is already included.",
      );
      return;
    }

    const cents =
      replacementCostDollars === ""
        ? ""
        : Math.round(
            Number(
              replacementCostDollars,
            ) * 100,
          );

    const observation =
      buildConditionObservation({
        section,
        itemKey,
        status,
        attributes,
        notes,
        estimatedReplacementCostCents:
          cents,
        plannedReplacementYear:
          replacementYear,
      });

    setObservations((current) => [
      ...current,
      observation,
    ]);

    setItemKey("");
    setAttributes({});
    setNotes("");
    setReplacementCostDollars("");
    setReplacementYear("");
    setMessage(
      "Observation added to the assessment.",
    );
  }

  function removeObservation(
    observationItemKey,
  ) {
    setObservations((current) =>
      current.filter(
        (observation) =>
          observation.itemKey !==
          observationItemKey,
      ),
    );
  }

  async function saveAssessment() {
    if (!propertyId) {
      setMessage("Choose a property.");
      return;
    }

    if (observations.length === 0) {
      setMessage(
        "Add at least one condition observation.",
      );
      return;
    }

    setSaving(true);
    setMessage("");

    try {
      const response = await fetch(
        "/api/property-condition-assessments",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            operation:
              "record-owner-assessment",
            assessment: {
              propertyId,
              effectiveAt,
              summary:
                summary.trim() || null,
              items: observations,
            },
          }),
        },
      );

      const payload =
        await response.json();

      if (!response.ok) {
        throw new Error(
          payload?.error ||
            "Unable to save the assessment.",
        );
      }

      const savedAssessment =
        payload?.assessment;

      if (savedAssessment) {
        setAssessments((current) => [
          savedAssessment,
          ...current.filter(
            (assessment) =>
              assessment.id !==
              savedAssessment.id,
          ),
        ]);
      }

      setObservations([]);
      setSummary("");
      setMessage(
        "Property condition assessment saved.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to save the assessment.",
      );
    } finally {
      setSaving(false);
    }
  }

  const definitions =
    attributeDefinitions(
      selectedDefinition,
    );

  return (
    <section
      data-property-condition-assessment-panel
      className="rounded-2xl border border-slate-200 bg-white p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-xs font-black uppercase tracking-wide text-emerald-700">
            Condition Assessments
          </div>

          <h4 className="mt-2 text-xl font-black text-slate-950">
            Standardized property condition history
          </h4>

          <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-slate-600">
            Record owner observations using the standardized REI 7-6-aligned checklist.
          </p>
        </div>

        <button
          type="button"
          disabled
          className="rounded-xl border border-dashed border-indigo-300 bg-indigo-50 px-4 py-2 text-xs font-black text-indigo-500 opacity-70"
        >
          Add from photo or document — planned
        </button>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <label className="text-xs font-black uppercase tracking-wide text-slate-600">
          Property
          <select
            value={propertyId}
            onChange={(event) =>
              setPropertyId(
                event.target.value,
              )
            }
            className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm font-bold normal-case text-slate-950"
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
        </label>

        <label className="text-xs font-black uppercase tracking-wide text-slate-600">
          Effective date
          <input
            type="date"
            value={effectiveAt}
            onChange={(event) =>
              setEffectiveAt(
                event.target.value,
              )
            }
            className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-3 text-sm font-bold normal-case text-slate-950"
          />
        </label>

        <label className="text-xs font-black uppercase tracking-wide text-slate-600">
          Assessment summary
          <input
            value={summary}
            onChange={(event) =>
              setSummary(
                event.target.value,
              )
            }
            placeholder="Owner walkthrough"
            className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-3 text-sm font-bold normal-case text-slate-950"
          />
        </label>
      </div>

      <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-5">
        <div className="grid gap-4 md:grid-cols-3">
          <label className="text-xs font-black uppercase tracking-wide text-slate-600">
            Checklist section
            <select
              value={section}
              onChange={(event) =>
                changeSection(
                  event.target.value,
                )
              }
              className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm font-bold normal-case text-slate-950"
            >
              {PROPERTY_CONDITION_SECTIONS.map(
                (sectionValue) => (
                  <option
                    key={sectionValue}
                    value={sectionValue}
                  >
                    {SECTION_LABELS[
                      sectionValue
                    ] ||
                      displayValue(
                        sectionValue,
                      )}
                  </option>
                ),
              )}
            </select>
          </label>

          <label className="text-xs font-black uppercase tracking-wide text-slate-600">
            Checklist item
            <select
              value={itemKey}
              onChange={(event) =>
                changeItem(
                  event.target.value,
                )
              }
              className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm font-bold normal-case text-slate-950"
            >
              <option value="">
                Choose an item
              </option>

              {sectionItems.map(
                (definition) => (
                  <option
                    key={checklistItemKey(
                      definition,
                    )}
                    value={checklistItemKey(
                      definition,
                    )}
                  >
                    {checklistItemLabel(
                      definition,
                    )}
                  </option>
                ),
              )}
            </select>
          </label>

          <label className="text-xs font-black uppercase tracking-wide text-slate-600">
            Observation status
            <select
              value={status}
              onChange={(event) =>
                setStatus(
                  event.target.value,
                )
              }
              className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm font-bold normal-case text-slate-950"
            >
              {PROPERTY_CONDITION_OBSERVATION_STATUSES.map(
                (statusValue) => (
                  <option
                    key={statusValue}
                    value={statusValue}
                  >
                    {displayValue(
                      statusValue,
                    )}
                  </option>
                ),
              )}
            </select>
          </label>
        </div>

        {definitions.length > 0 && (
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            {definitions.map(
              (definition) => {
                const key =
                  attributeKey(
                    definition,
                  );

                const options =
                  attributeOptions(
                    definition,
                  );

                if (options.length > 0) {
                  return (
                    <label
                      key={key}
                      className="text-xs font-black uppercase tracking-wide text-slate-600"
                    >
                      {attributeLabel(
                        definition,
                      )}

                      <select
                        value={
                          attributes[key] ??
                          ""
                        }
                        onChange={(event) =>
                          updateAttribute(
                            definition,
                            event.target.value,
                          )
                        }
                        className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm font-bold normal-case text-slate-950"
                      >
                        <option value="">
                          Not recorded
                        </option>

                        {options.map(
                          (option) => {
                            const value =
                              typeof option ===
                              "string"
                                ? option
                                : option.value;

                            const label =
                              typeof option ===
                              "string"
                                ? displayValue(
                                    option,
                                  )
                                : option.label ||
                                  displayValue(
                                    value,
                                  );

                            return (
                              <option
                                key={value}
                                value={value}
                              >
                                {label}
                              </option>
                            );
                          },
                        )}
                      </select>
                    </label>
                  );
                }

                return (
                  <label
                    key={key}
                    className="text-xs font-black uppercase tracking-wide text-slate-600"
                  >
                    {attributeLabel(
                      definition,
                    )}

                    <input
                      type={
                        definition?.inputType ===
                          "number" ||
                        definition?.inputType ===
                          "integer"
                          ? "number"
                          : "text"
                      }
                      value={
                        attributes[key] ??
                        ""
                      }
                      onChange={(event) =>
                        updateAttribute(
                          definition,
                          event.target.value,
                        )
                      }
                      className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm font-bold normal-case text-slate-950"
                    />
                  </label>
                );
              },
            )}
          </div>
        )}

        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <label className="text-xs font-black uppercase tracking-wide text-slate-600">
            Replacement cost
            <input
              type="number"
              min="0"
              step="0.01"
              value={
                replacementCostDollars
              }
              onChange={(event) =>
                setReplacementCostDollars(
                  event.target.value,
                )
              }
              placeholder="0.00"
              className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm font-bold normal-case text-slate-950"
            />
          </label>

          <label className="text-xs font-black uppercase tracking-wide text-slate-600">
            Planned replacement year
            <input
              type="number"
              min="1900"
              max="2200"
              value={replacementYear}
              onChange={(event) =>
                setReplacementYear(
                  event.target.value,
                )
              }
              className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm font-bold normal-case text-slate-950"
            />
          </label>

          <label className="text-xs font-black uppercase tracking-wide text-slate-600">
            Notes
            <input
              value={notes}
              onChange={(event) =>
                setNotes(
                  event.target.value,
                )
              }
              placeholder="Observed condition"
              className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm font-bold normal-case text-slate-950"
            />
          </label>
        </div>

        <button
          type="button"
          onClick={addObservation}
          className="mt-4 rounded-xl bg-slate-950 px-4 py-3 text-sm font-black text-white"
        >
          Add observation
        </button>
      </div>

      {observations.length > 0 && (
        <div className="mt-6 space-y-3">
          <h5 className="text-sm font-black text-slate-950">
            Assessment observations
          </h5>

          {observations.map(
            (observation) => (
              <div
                key={
                  observation.itemKey
                }
                className="flex items-start justify-between gap-4 rounded-xl border border-slate-200 p-4"
              >
                <div>
                  <div className="text-sm font-black text-slate-950">
                    {checklistItemLabel(
                      getPropertyConditionChecklistItem(
                        observation.itemKey,
                      ),
                    )}
                  </div>

                  <div className="mt-1 text-xs font-bold text-slate-500">
                    {displayValue(
                      observation.status,
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    removeObservation(
                      observation.itemKey,
                    )
                  }
                  className="text-xs font-black text-rose-700"
                >
                  Remove
                </button>
              </div>
            ),
          )}
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-4">
        <button
          type="button"
          disabled={saving}
          onClick={saveAssessment}
          className="rounded-xl bg-emerald-700 px-5 py-3 text-sm font-black text-white disabled:opacity-60"
        >
          {saving
            ? "Saving assessment..."
            : "Save assessment"}
        </button>

        {message && (
          <p
            role="status"
            className="text-sm font-bold text-slate-600"
          >
            {message}
          </p>
        )}
      </div>

      <div className="mt-7 border-t border-slate-200 pt-6">
        <h5 className="text-sm font-black text-slate-950">
          Condition history
        </h5>

        {assessments.length === 0 ? (
          <p className="mt-3 text-sm font-semibold text-slate-500">
            No saved assessments for this property yet.
          </p>
        ) : (
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {assessments.map(
              (assessment) => (
                <article
                  key={assessment.id}
                  className="rounded-xl border border-slate-200 p-4"
                >
                  <div className="text-sm font-black text-slate-950">
                    {assessment.summary ||
                      "Property condition assessment"}
                  </div>

                  <div className="mt-1 text-xs font-bold text-slate-500">
                    {assessment.effectiveAt
                      ? new Date(
                          assessment.effectiveAt,
                        ).toLocaleDateString()
                      : "Date unavailable"}
                    {" · "}
                    {assessment.items?.length ||
                      0}
                    {" observations"}
                  </div>
                </article>
              ),
            )}
          </div>
        )}
      </div>

      <div className="mt-6 rounded-xl border border-dashed border-indigo-300 bg-indigo-50 p-4 text-sm font-semibold leading-6 text-indigo-950">
        Future OCR imports will create reviewable field proposals. A user must approve those proposals before they update the property record.
      </div>
    </section>
  );
}
