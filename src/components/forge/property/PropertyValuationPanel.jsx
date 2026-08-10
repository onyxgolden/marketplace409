"use client";

import {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  parsePropertyValuationCsv,
} from "@/application/property-valuation/parsePropertyValuationCsv";

import {
  buildPropertyPortfolioProperties,
} from "./buildPropertyPortfolioProperties";

import PropertyValuationWorkflowChooser, {
  PropertyValuationWorkflowHeader,
} from "./PropertyValuationWorkflowChooser";

export {
  buildPropertyPortfolioProperties as buildValuationProperties,
} from "./buildPropertyPortfolioProperties";

function propertyLabel(property) {
  return (
    property.name ||
    property.address ||
    property.id
  );
}

function formatCurrency(amountCents) {
  return new Intl.NumberFormat(
    "en-US",
    {
      style:
        "currency",
      currency:
        "USD",
      maximumFractionDigits:
        2,
    },
  ).format(
    Number(amountCents || 0) / 100,
  );
}

function formatDate(value) {
  if (!value) {
    return "No effective date";
  }

  return new Intl.DateTimeFormat(
    "en-US",
    {
      year:
        "numeric",
      month:
        "short",
      day:
        "numeric",
    },
  ).format(
    new Date(value),
  );
}

async function readJson(response) {
  const payload =
    await response.json();

  if (!response.ok) {
    throw new Error(
      payload.error ||
      "Unable to complete the property valuation request.",
    );
  }

  return payload;
}

export default function PropertyValuationPanel() {
  const [properties, setProperties] =
    useState([]);
  const [valuations, setValuations] =
    useState([]);
  const [propertyId, setPropertyId] =
    useState("");
  const [amount, setAmount] =
    useState("");
  const [valuationType, setValuationType] =
    useState("owner_estimate");
  const [effectiveAt, setEffectiveAt] =
    useState("");
  const [notes, setNotes] =
    useState("");
  const [fileName, setFileName] =
    useState("");
  const [csvRows, setCsvRows] =
    useState([]);
  const [preview, setPreview] =
    useState(null);
  const [loading, setLoading] =
    useState(true);
  const [saving, setSaving] =
    useState(false);
  const [importing, setImporting] =
    useState(false);
  const [deletingId, setDeletingId] =
    useState(null);
  const [error, setError] =
    useState("");
  const [message, setMessage] =
    useState("");
  const [workflow, setWorkflow] =
    useState(null);
  const [showGuidance, setShowGuidance] =
    useState(true);

  useEffect(() => {
    const storedPreference =
      window.localStorage.getItem(
        "forge.display.guidance",
      );

    if (storedPreference !== null) {
      setShowGuidance(
        storedPreference !== "off",
      );
    }
  }, []);

  function toggleGuidance() {
    setShowGuidance(
      (current) => {
        const next = !current;

        window.localStorage.setItem(
          "forge.display.guidance",
          next
            ? "on"
            : "off",
        );

        return next;
      },
    );
  }

  useEffect(() => {
    async function initialize() {
      try {
        const [
          propertyResponse,
          valuationResponse,
        ] = await Promise.all([
          fetch(
            "/api/financial/read-models?financial=true&business=true",
          ),
          fetch(
            "/api/property-valuations",
          ),
        ]);

        const propertyPayload =
          await readJson(
            propertyResponse,
          );

        const valuationPayload =
          await readJson(
            valuationResponse,
          );

        const loadedProperties =
          buildPropertyPortfolioProperties(
            propertyPayload,
          );

        setProperties(
          loadedProperties,
        );
        setValuations(
          valuationPayload
            .valuations ?? [],
        );

        setPropertyId(
          loadedProperties[0]?.id ??
          "",
        );
      } catch (initializationError) {
        setError(
          initializationError instanceof Error
            ? initializationError.message
            : "Unable to initialize property valuations.",
        );
      } finally {
        setLoading(false);
      }
    }

    initialize();
  }, []);

  const propertiesById =
    useMemo(
      () =>
        new Map(
          properties.map(
            (property) => [
              property.id,
              property,
            ],
          ),
        ),
      [properties],
    );

  function replaceLatest(
    persistedValuations,
  ) {
    setValuations(
      (current) => {
        const replacements =
          new Map(
            persistedValuations.map(
              (valuation) => [
                valuation.propertyId,
                valuation,
              ],
            ),
          );

        const retained =
          current.filter(
            (valuation) =>
              !replacements.has(
                valuation.propertyId,
              ),
          );

        return [
          ...persistedValuations,
          ...retained,
        ];
      },
    );
  }

  async function handleManualSubmit(
    event,
  ) {
    event.preventDefault();
    setError("");
    setMessage("");
    setSaving(true);

    try {
      const response =
        await fetch(
          "/api/property-valuations",
          {
            method:
              "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            body:
              JSON.stringify({
                operation:
                  "record-manual",
                valuation: {
                  propertyId,
                  amount,
                  valuationType,
                  effectiveAt:
                    effectiveAt ||
                    undefined,
                  notes:
                    notes ||
                    undefined,
                },
              }),
          },
        );

      const payload =
        await readJson(response);

      replaceLatest([
        payload.valuation,
      ]);

      setAmount("");
      setNotes("");
      setMessage(
        "Property valuation recorded.",
      );
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Unable to record property valuation.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleFileChange(
    event,
  ) {
    const file =
      event.target.files?.[0];

    setError("");
    setMessage("");
    setPreview(null);
    setCsvRows([]);

    if (!file) {
      setFileName("");
      return;
    }

    setFileName(file.name);

    try {
      const parsed =
        parsePropertyValuationCsv(
          await file.text(),
        );

      const response =
        await fetch(
          "/api/property-valuations",
          {
            method:
              "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            body:
              JSON.stringify({
                operation:
                  "preview-spreadsheet",
                rows:
                  parsed.rows,
              }),
          },
        );

      const payload =
        await readJson(response);

      setCsvRows(
        parsed.rows,
      );
      setPreview(
        payload.preview,
      );
    } catch (previewError) {
      setError(
        previewError instanceof Error
          ? previewError.message
          : "Unable to preview the valuation CSV.",
      );
    }
  }

  async function handleImport() {
    setError("");
    setMessage("");
    setImporting(true);

    try {
      const response =
        await fetch(
          "/api/property-valuations",
          {
            method:
              "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            body:
              JSON.stringify({
                operation:
                  "import-spreadsheet",
                rows:
                  csvRows,
              }),
          },
        );

      const payload =
        await readJson(response);

      if (!payload.result.valid) {
        setPreview(
          payload.result,
        );
        setError(
          "Correct the invalid valuation rows before importing.",
        );
        return;
      }

      replaceLatest(
        payload.result
          .persistedValuations,
      );

      setPreview(
        payload.result,
      );
      setMessage(
        `${payload.result.importedCount} property valuations imported.`,
      );
    } catch (importError) {
      setError(
        importError instanceof Error
          ? importError.message
          : "Unable to import property valuations.",
      );
    } finally {
      setImporting(false);
    }
  }

  async function handleRemove(
    valuation,
  ) {
    const property =
      propertiesById.get(
        valuation.propertyId,
      );
    const label =
      property
        ? propertyLabel(property)
        : valuation.propertyId;

    if (
      !window.confirm(
        `Remove the recorded valuation for ${label}?`,
      )
    ) {
      return;
    }

    setError("");
    setMessage("");
    setDeletingId(
      valuation.id,
    );

    try {
      const response =
        await fetch(
          "/api/property-valuations",
          {
            method:
              "DELETE",
            headers: {
              "Content-Type":
                "application/json",
            },
            body:
              JSON.stringify({
                valuationId:
                  valuation.id,
              }),
          },
        );

      await readJson(response);

      const refreshedResponse =
        await fetch(
          "/api/property-valuations",
        );

      const refreshedPayload =
        await readJson(
          refreshedResponse,
        );

      setValuations(
        refreshedPayload
          .valuations ?? [],
      );

      setMessage(
        "Property valuation removed.",
      );
    } catch (removeError) {
      setError(
        removeError instanceof Error
          ? removeError.message
          : "Unable to remove the property valuation.",
      );
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <section
      data-property-valuation-panel
      className={
        workflow === null
          ? "max-w-5xl rounded-2xl border border-slate-200 bg-white p-6"
          : "rounded-2xl border border-slate-200 bg-white p-6"
      }
    >
      {workflow === null ? (
        <>
          <div>
            <div className="text-xs font-black uppercase tracking-wide text-emerald-700">
              Property Intelligence
            </div>

            <h3 className="mt-2 text-xl font-black text-slate-950">
              Current property values
            </h3>

            <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-slate-600">
              Maintain an owner-controlled valuation history with explicit source and effective-date provenance.
            </p>
          </div>

          {loading && (
            <div className="mt-5 max-w-xl rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm font-bold text-slate-600">
              Loading property valuations…
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="mt-5 max-w-3xl rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-800"
            >
              {error}
            </div>
          )}

          {message && (
            <div
              role="status"
              className="mt-5 max-w-3xl rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-bold text-emerald-800"
            >
              {message}
            </div>
          )}

          <div className="mt-5 max-w-xl rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="text-[11px] font-black uppercase text-slate-500">
              Recorded property values
            </div>

            <div className="mt-1 text-xl font-black text-slate-950">
              {valuations.length}
            </div>
          </div>

          <PropertyValuationWorkflowChooser
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
          <PropertyValuationWorkflowHeader
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
              className="mt-5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-800"
            >
              {error}
            </div>
          )}

          {message && (
            <div
              role="status"
              className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-bold text-emerald-800"
            >
              {message}
            </div>
          )}

          {workflow === "record" && (
            <div className="mt-6 max-w-3xl">
        <form
          onSubmit={
            handleManualSubmit
          }
          className="rounded-2xl border border-slate-200 bg-white p-5"
        >
          <div className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">
            Manual Update
          </div>

          <h4 className="mt-2 text-lg font-black text-slate-950">
            Record a property value
          </h4>

          <div className="mt-5 space-y-4">
            <label className="block">
              <span className="text-sm font-bold text-slate-700">
                Property
              </span>

              <select
                value={propertyId}
                onChange={(event) =>
                  setPropertyId(
                    event.target.value,
                  )
                }
                required
                className="mt-2 block w-full rounded-xl border border-slate-300 bg-white px-4 py-3"
              >
                <option value="">
                  Select property
                </option>

                {properties.map(
                  (property) => (
                    <option
                      key={
                        property.id
                      }
                      value={
                        property.id
                      }
                    >
                      {
                        propertyLabel(
                          property,
                        )
                      }
                    </option>
                  ),
                )}
              </select>
            </label>

            <label className="block">
              <span className="text-sm font-bold text-slate-700">
                Current value
              </span>

              <input
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(event) =>
                  setAmount(
                    event.target.value,
                  )
                }
                required
                placeholder="125000"
                className="mt-2 block w-full rounded-xl border border-slate-300 px-4 py-3"
              />
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="text-sm font-bold text-slate-700">
                  Valuation type
                </span>

                <select
                  value={
                    valuationType
                  }
                  onChange={(event) =>
                    setValuationType(
                      event.target.value,
                    )
                  }
                  className="mt-2 block w-full rounded-xl border border-slate-300 bg-white px-4 py-3"
                >
                  <option value="owner_estimate">
                    Owner estimate
                  </option>
                  <option value="appraisal">
                    Appraisal
                  </option>
                  <option value="assessed_value">
                    Assessed value
                  </option>
                  <option value="provider_estimate">
                    Provider estimate
                  </option>
                  <option value="purchase_price">
                    Purchase price
                  </option>
                </select>
              </label>

              <label className="block">
                <span className="text-sm font-bold text-slate-700">
                  Effective date
                </span>

                <input
                  type="date"
                  value={
                    effectiveAt
                  }
                  onChange={(event) =>
                    setEffectiveAt(
                      event.target.value,
                    )
                  }
                  className="mt-2 block w-full rounded-xl border border-slate-300 px-4 py-3"
                />
              </label>
            </div>

            <label className="block">
              <span className="text-sm font-bold text-slate-700">
                Notes
              </span>

              <textarea
                value={notes}
                onChange={(event) =>
                  setNotes(
                    event.target.value,
                  )
                }
                rows={3}
                className="mt-2 block w-full rounded-xl border border-slate-300 px-4 py-3"
              />
            </label>

            <button
              type="submit"
              disabled={
                saving ||
                !propertyId
              }
              className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving
                ? "Recording…"
                : "Record valuation"}
            </button>
          </div>
        </form>
            </div>
          )}

          {workflow === "import" && (
            <div className="mt-6 max-w-3xl">
        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">
            Spreadsheet Update
          </div>

          <h4 className="mt-2 text-lg font-black text-slate-950">
            Preview and import CSV
          </h4>

          <p className="mt-2 text-sm leading-6 text-slate-600">
            Required columns: property_id and current_value. Optional columns include valuation_type, valuation_date, currency_code, and notes.
          </p>

          <label className="mt-5 block">
            <span className="text-sm font-bold text-slate-700">
              Property valuation CSV
            </span>

            <input
              type="file"
              accept=".csv,text/csv"
              onChange={
                handleFileChange
              }
              className="mt-2 block w-full rounded-xl border border-slate-300 bg-slate-50 px-4 py-3"
            />
          </label>

          {fileName && (
            <div className="mt-3 text-sm font-semibold text-slate-600">
              Selected file:{" "}
              <span className="text-slate-950">
                {fileName}
              </span>
            </div>
          )}

          {preview && (
            <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="grid grid-cols-3 gap-3 text-center">
                <PreviewMetric
                  label="Rows"
                  value={
                    preview.rowCount
                  }
                />

                <PreviewMetric
                  label="Valid"
                  value={
                    preview.validRowCount
                  }
                />

                <PreviewMetric
                  label="Invalid"
                  value={
                    preview.invalidRowCount
                  }
                />
              </div>

              {preview.errors
                ?.length > 0 && (
                <ul className="mt-4 space-y-2 text-sm font-semibold text-rose-800">
                  {preview.errors.map(
                    (rowError) => (
                      <li
                        key={`${rowError.rowNumber}-${rowError.message}`}
                      >
                        Row{" "}
                        {
                          rowError.rowNumber
                        }
                        :{" "}
                        {
                          rowError.message
                        }
                      </li>
                    ),
                  )}
                </ul>
              )}

              <button
                type="button"
                onClick={
                  handleImport
                }
                disabled={
                  importing ||
                  !preview.valid ||
                  csvRows.length === 0
                }
                className="mt-4 rounded-xl bg-emerald-700 px-5 py-3 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {importing
                  ? "Importing…"
                  : "Import valuations"}
              </button>
            </div>
          )}
        </section>
            </div>
          )}

          {workflow === "history" && (
            <div className="mt-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">
              Latest Recorded Values
            </div>

            <h4 className="mt-2 text-lg font-black text-slate-950">
              Owner-scoped property valuations
            </h4>
          </div>

          <div className="rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs font-black text-slate-600">
            {valuations.length} current
          </div>
        </div>

        {!loading &&
          valuations.length === 0 && (
            <div className="mt-5 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm font-semibold text-slate-600">
              No property valuations recorded yet.
            </div>
          )}

        {valuations.length > 0 && (
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {valuations.map(
              (valuation) => {
                const property =
                  propertiesById.get(
                    valuation.propertyId,
                  );

                return (
                  <article
                    key={
                      valuation.id
                    }
                    className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
                  >
                    <div className="text-sm font-black text-slate-950">
                      {property
                        ? propertyLabel(
                            property,
                          )
                        : valuation.propertyId}
                    </div>

                    <div className="mt-2 text-2xl font-black text-emerald-800">
                      {formatCurrency(
                        valuation.amountCents,
                      )}
                    </div>

                    <div className="mt-2 text-xs font-bold uppercase tracking-wide text-slate-500">
                      {
                        valuation.valuationType
                      }
                      {" · "}
                      {
                        valuation.source
                      }
                    </div>

                    <div className="mt-1 text-xs font-semibold text-slate-600">
                      Effective{" "}
                      {formatDate(
                        valuation.effectiveAt,
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        handleRemove(
                          valuation,
                        )
                      }
                      disabled={
                        deletingId ===
                        valuation.id
                      }
                      className="mt-4 rounded-xl border border-rose-300 bg-white px-4 py-2 text-xs font-black text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {deletingId ===
                      valuation.id
                        ? "Removing…"
                        : "Remove valuation"}
                    </button>
                  </article>
                );
              },
            )}
          </div>
        )}
      </section>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function PreviewMetric({
  label,
  value,
}) {
  return (
    <div className="rounded-xl bg-white p-3">
      <div className="text-xl font-black text-slate-950">
        {value}
      </div>

      <div className="mt-1 text-[10px] font-black uppercase tracking-wide text-slate-500">
        {label}
      </div>
    </div>
  );
}
