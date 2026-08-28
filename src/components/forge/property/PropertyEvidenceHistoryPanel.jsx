"use client";

import {
  useEffect,
  useState,
} from "react";

function displayValue(value) {
  return String(value || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) =>
      character.toUpperCase(),
    );
}

function displayEvidenceValue(
  value,
) {
  const normalizedValue =
    String(value || "")
      .trim()
      .toLowerCase();

  const labels = {
    "application/pdf":
      "PDF",
    "image/jpeg":
      "JPEG",
    "image/png":
      "PNG",
    native_pdf:
      "Native PDF",
    google_cloud_vision:
      "Google Cloud Vision",
  };

  return (
    labels[normalizedValue] ||
    displayValue(
      normalizedValue,
    )
  );
}

function formatTimestamp(value) {
  if (
    !value ||
    Number.isNaN(
      Date.parse(value),
    )
  ) {
    return "Date unavailable";
  }

  return new Intl.DateTimeFormat(
    "en-US",
    {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    },
  ).format(
    new Date(value),
  );
}

function formatBytes(value) {
  const bytes =
    Number(value);

  if (
    !Number.isFinite(bytes) ||
    bytes < 0
  ) {
    return "Size unavailable";
  }

  if (bytes < 1024) {
    return `${bytes} bytes`;
  }

  return `${(
    bytes / 1024
  ).toFixed(1)} KB`;
}

function statusPresentation(
  reviewStatus,
) {
  switch (reviewStatus) {
    case "approved":
      return {
        label:
          "Approved",
        className:
          "border-emerald-200 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30",
      };

    case "extraction_failed":
      return {
        label:
          "Extraction failed",
        className:
          "border-rose-200 bg-rose-50 text-rose-800 dark:bg-rose-950/30",
      };

    case "pending_review":
      return {
        label:
          "Pending review",
        className:
          "border-amber-200 bg-amber-50 text-amber-800 dark:text-amber-300 dark:bg-amber-950/30",
      };

    default:
      return {
        label:
          displayValue(
            reviewStatus ||
              "pending",
          ),
        className:
          "border-slate-200 bg-slate-50 text-slate-700 dark:bg-slate-800/60 dark:text-slate-300 dark:border-slate-800",
      };
  }
}

export function buildPropertyEvidenceUrl(
  propertyId,
) {
  const normalizedPropertyId =
    String(propertyId || "")
      .trim();

  return normalizedPropertyId
    ? `/api/property-evidence?propertyId=${encodeURIComponent(
        normalizedPropertyId,
      )}`
    : null;
}

export function PropertyEvidenceHistoryList({
  evidence = [],
  systems = [],
}) {
  if (evidence.length === 0) {
    return (
      <p className="mt-4 text-sm font-semibold text-slate-500 dark:text-slate-400">
        No private evidence has been recorded for this property.
      </p>
    );
  }

  const systemNames =
    new Map(
      systems.map(
        (system) => [
          system.id,
          system.name,
        ],
      ),
    );

  return (
    <div className="mt-4 grid gap-3">
      {evidence.map((record) => {
        const status =
          statusPresentation(
            record.reviewStatus,
          );

        const linkedSystem =
          record.hvacSystemId
            ? systemNames.get(
                record.hvacSystemId,
              ) ||
              `HVAC system ${record.hvacSystemId}`
            : "No HVAC system linked";

        return (
          <article
            key={record.id}
            className="rounded-xl border border-slate-200 bg-white p-4 dark:bg-slate-900 dark:border-slate-800"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-sm font-black text-slate-950 dark:text-slate-50">
                  {record.originalFilename}
                </div>

                <div className="mt-1 text-xs font-bold text-slate-500 dark:text-slate-400">
                  {displayEvidenceValue(
                    record.mimeType,
                  )}
                  {" · "}
                  {formatBytes(
                    record.byteSize,
                  )}
                  {" · "}
                  {formatTimestamp(
                    record.createdAt,
                  )}
                </div>
              </div>

              <span
                className={`rounded-full border px-3 py-1 text-xs font-black ${status.className}`}
              >
                {status.label}
              </span>
            </div>

            <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <dt className="font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Property
                </dt>

                <dd className="mt-1 font-bold text-slate-800 dark:text-slate-200">
                  {record.propertyId}
                </dd>
              </div>

              <div>
                <dt className="font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Extraction
                </dt>

                <dd className="mt-1 font-bold text-slate-800 dark:text-slate-200">
                  {displayEvidenceValue(
                    record.extractionMethod,
                  )}
                </dd>
              </div>

              <div>
                <dt className="font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Parser
                </dt>

                <dd className="mt-1 font-bold text-slate-800 dark:text-slate-200">
                  {record.parserVersion ||
                    "Not available"}
                </dd>
              </div>

              <div>
                <dt className="font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  HVAC link
                </dt>

                <dd className="mt-1 font-bold text-slate-800 dark:text-slate-200">
                  {linkedSystem}
                </dd>
              </div>
            </dl>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
              <div
                title={
                  record.hvacEventId ||
                  undefined
                }
                className="text-xs font-semibold text-slate-500 dark:text-slate-400"
              >
                {record.hvacEventId
                  ? "Linked to approved service event"
                  : "No approved service event linked"}
              </div>

              <a
                href={record.accessUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg bg-sky-700 px-4 py-2 text-xs font-black text-white"
              >
                Open private evidence
              </a>
            </div>
          </article>
        );
      })}
    </div>
  );
}

export default function PropertyEvidenceHistoryPanel({
  propertyId,
  systems = [],
}) {
  const [
    evidence,
    setEvidence,
  ] = useState([]);

  const [
    loading,
    setLoading,
  ] = useState(false);

  const [
    message,
    setMessage,
  ] = useState("");

  const [
    refreshVersion,
    setRefreshVersion,
  ] = useState(0);

  useEffect(() => {
    const url =
      buildPropertyEvidenceUrl(
        propertyId,
      );

    if (!url) {
      setEvidence([]);
      setMessage("");
      setLoading(false);
      return;
    }

    let active = true;

    async function loadEvidence() {
      setLoading(true);
      setMessage("");

      try {
        const response =
          await fetch(url);

        const payload =
          await response.json();

        if (!response.ok) {
          throw new Error(
            payload?.error ||
              "Unable to load property evidence.",
          );
        }

        if (active) {
          setEvidence(
            Array.isArray(
              payload?.evidence,
            )
              ? payload.evidence
              : [],
          );
        }
      } catch (error) {
        if (active) {
          setEvidence([]);
          setMessage(
            error instanceof Error
              ? error.message
              : "Unable to load property evidence.",
          );
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadEvidence();

    return () => {
      active = false;
    };
  }, [
    propertyId,
    refreshVersion,
  ]);

  return (
    <section
      data-property-evidence-history-panel
      className="mt-7 rounded-2xl border border-violet-200 bg-violet-50/50 p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-xs font-black uppercase tracking-wide text-violet-700">
            Property Evidence
          </div>

          <h5 className="mt-2 text-lg font-black text-slate-950 dark:text-slate-50">
            Private evidence history
          </h5>

          <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-slate-600 dark:text-slate-300">
            Review original invoices and photographs, extraction provenance, approval state, and linked HVAC history.
          </p>
        </div>

        <button
          type="button"
          disabled={
            loading ||
            !buildPropertyEvidenceUrl(
              propertyId,
            )
          }
          onClick={() =>
            setRefreshVersion(
              (current) =>
                current + 1,
            )
          }
          className="rounded-xl border border-violet-300 bg-white px-4 py-2 text-xs font-black text-violet-800 disabled:opacity-50 dark:bg-slate-900"
        >
          {loading
            ? "Refreshing evidence..."
            : "Refresh evidence"}
        </button>
      </div>

      {!propertyId ? (
        <p className="mt-4 text-sm font-semibold text-slate-500 dark:text-slate-400">
          Choose a property to view its private evidence.
        </p>
      ) : loading ? (
        <p className="mt-4 text-sm font-semibold text-slate-500 dark:text-slate-400">
          Loading private evidence...
        </p>
      ) : message ? (
        <p
          role="status"
          className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-bold text-rose-800 dark:bg-rose-950/30"
        >
          {message}
        </p>
      ) : (
        <PropertyEvidenceHistoryList
          evidence={evidence}
          systems={systems}
        />
      )}
    </section>
  );
}
