"use client";

import {
  useEffect,
  useState,
} from "react";

import {
  validateReviewedSessionMetadata,
} from "../../../../scripts/governance/reviewedSessionMetadataContract.mjs";

import {
  REVIEW_REQUIRED,
  requiresHumanReview,
} from "../../../../scripts/conversation/requiresHumanReview.mjs";

function riskLabel(risk) {
  return String(risk || "")
    .split("-")
    .filter(Boolean)
    .map(
      (part) =>
        part.charAt(0).toUpperCase() +
        part.slice(1),
    )
    .join(" ");
}

export function calculateProgrammerCommandProgress({
  elapsedSeconds,
  expectedDurationSeconds,
}) {
  if (
    !Number.isFinite(elapsedSeconds) ||
    !Number.isFinite(expectedDurationSeconds) ||
    expectedDurationSeconds <= 0
  ) {
    return 0;
  }

  return Math.min(
    90,
    Math.max(
      0,
      Math.round(
        (elapsedSeconds / expectedDurationSeconds) * 100,
      ),
    ),
  );
}

function statusClass(status) {
  if (status === "passing") {
    return "border-emerald-300 bg-emerald-50 text-emerald-900";
  }

  if (status === "failing") {
    return "border-rose-300 bg-rose-50 text-rose-900";
  }

  return "border-slate-300 bg-slate-50 text-slate-700";
}

const VALIDATION_CATEGORIES = Object.freeze([
  { key: "focusedTests", label: "Focused tests" },
  { key: "fullTests", label: "Full tests" },
  { key: "productionBuild", label: "Production build" },
]);

function validationStatusLabel(status) {
  if (status === "passing") return "Passing";
  if (status === "failing") return "Failing";
  return "Not run";
}

export function buildReadableProgrammerResultText({
  execution,
  error,
} = {}) {
  if (error) {
    return [
      "FORGE PROGRAMMER COMMAND RESULT",
      "",
      "Status: Error",
      `Error: ${error}`,
    ].join("\n");
  }

  if (!execution) {
    return "";
  }

  const lines = [
    "FORGE PROGRAMMER COMMAND RESULT",
    "",
    `Action: ${execution.label || ""}`,
    `Status: ${execution.status || ""}`,
    `Started: ${execution.startedAt || "n/a"}`,
    `Completed: ${execution.completedAt || "n/a"}`,
  ];

  (execution.steps || []).forEach((step, index) => {
    lines.push("");
    lines.push(`Step ${index + 1} · ${step.status}`);
    lines.push(`Command: ${step.command}`);
    lines.push("Output:");
    lines.push(
      step.output || "Command completed without output.",
    );
  });

  return lines.join("\n");
}

const INITIAL_DELIVERED_WORK_DISPLAY_COUNT = 6;

const SESSION_REVIEW_TEXT_FIELDS = Object.freeze([
  "phaseIdentifier",
  "phaseTitle",
  "startingObjective",
  "endingObjective",
  "incompleteReason",
  "nextSessionObjective",
  "nextSessionStartingInspection",
]);

const SESSION_REVIEW_LIST_FIELDS = Object.freeze([
  "deliveredWork",
  "knownWarnings",
]);

export function createEmptySessionReviewFields() {
  return {
    phaseIdentifier: "",
    phaseTitle: "",
    startingObjective: "",
    endingObjective: "",
    deliveredWork: "",
    knownWarnings: "",
    markSessionComplete: false,
    incompleteReason: "",
    nextSessionObjective: "",
    nextSessionStartingInspection: "",
  };
}

export function buildReviewedSessionMetadataPayload(reviewFields) {
  const payload = {};

  for (const field of SESSION_REVIEW_TEXT_FIELDS) {
    const value = String(reviewFields?.[field] || "").trim();

    if (value) {
      payload[field] = value;
    }
  }

  for (const field of SESSION_REVIEW_LIST_FIELDS) {
    const items = String(reviewFields?.[field] || "")
      .split("\n")
      .map((item) => item.trim())
      .filter(Boolean);

    if (items.length > 0) {
      payload[field] = items;
    }
  }

  payload.markSessionComplete = Boolean(
    reviewFields?.markSessionComplete,
  );

  return payload;
}

export function sessionReviewFieldsFromProposal(proposal) {
  const empty = createEmptySessionReviewFields();

  if (!proposal) {
    return empty;
  }

  const nonReviewRequired = (value) =>
    value && value !== "REVIEW_REQUIRED" ? value : "";

  return {
    ...empty,
    phaseIdentifier: nonReviewRequired(
      proposal.phase?.identifier,
    ),
    phaseTitle: nonReviewRequired(proposal.phase?.title),
    startingObjective:
      proposal.objective?.startingObjective || "",
    endingObjective:
      proposal.objective?.endingObjective || "",
    deliveredWork: (proposal.deliveredWork || []).join("\n"),
    knownWarnings: (proposal.knownWarnings || []).join("\n"),
    markSessionComplete: Boolean(
      proposal.completion?.proposedMarkSessionComplete,
    ),
    nextSessionObjective:
      proposal.nextSession?.objective || "",
    nextSessionStartingInspection:
      proposal.nextSession?.startingInspection || "",
  };
}

function reviewFieldOrReviewRequired(value) {
  const trimmed = String(value || "").trim();
  return trimmed || REVIEW_REQUIRED;
}

/**
 * Adapts the dashboard's flat review-field shape into the
 * { state: { activePhase, currentObjective, nextSession } } shape
 * requiresHumanReview() expects -- the same shape
 * buildConversationState.mjs reads from governance/state/current-
 * governance-state.json. A blank field maps to the same REVIEW_REQUIRED
 * sentinel the backend would leave in place, so this mirrors, rather than
 * re-derives, what the collector actually does with an omitted field.
 * endingObjective maps to currentObjective because
 * generateGovernanceState.mjs sets state.currentObjective from the
 * snapshot's objective.endingObjective.
 */
export function reviewFieldsToGovernanceStateShape(reviewFields) {
  return {
    state: {
      activePhase: {
        identifier: reviewFieldOrReviewRequired(
          reviewFields?.phaseIdentifier,
        ),
        title: reviewFieldOrReviewRequired(
          reviewFields?.phaseTitle,
        ),
      },
      currentObjective: reviewFieldOrReviewRequired(
        reviewFields?.endingObjective,
      ),
      nextSession: {
        objective: reviewFieldOrReviewRequired(
          reviewFields?.nextSessionObjective,
        ),
        startingInspection: reviewFieldOrReviewRequired(
          reviewFields?.nextSessionStartingInspection,
        ),
      },
    },
  };
}

/**
 * True when the current review fields would leave a policy-required
 * governance field REVIEW_REQUIRED -- reuses requiresHumanReview so this
 * can never drift from what the backend invariant (and the generated
 * bootstrap) actually require.
 */
export function isSessionReviewIncomplete(reviewFields) {
  return requiresHumanReview(
    reviewFieldsToGovernanceStateShape(reviewFields),
  );
}

export function validateSessionReviewFields(reviewFields) {
  const payload = buildReviewedSessionMetadataPayload(reviewFields);

  try {
    validateReviewedSessionMetadata(payload);

    return {
      valid: true,
      payload,
    };
  } catch (validationError) {
    return {
      valid: false,
      message:
        validationError instanceof Error
          ? validationError.message
          : "Reviewed session metadata is invalid.",
    };
  }
}

export default function ProgrammerDashboard({
  commands,
  programmerEmail,
}) {
  const [runningCommandId, setRunningCommandId] = useState(null);
  const [execution, setExecution] = useState(null);
  const [error, setError] = useState("");
  const [runningStartedAt, setRunningStartedAt] = useState(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [copyStatus, setCopyStatus] = useState(null);
  const [reviewCommand, setReviewCommand] = useState(null);
  const [reviewFields, setReviewFields] = useState(
    createEmptySessionReviewFields(),
  );
  const [reviewValidationError, setReviewValidationError] =
    useState(null);
  const [reviewProposalStatus, setReviewProposalStatus] =
    useState("idle");
  const [reviewProposal, setReviewProposal] = useState(null);
  const [reviewProposalError, setReviewProposalError] =
    useState("");
  const [reviewMode, setReviewMode] = useState("summary");
  const [showAllDeliveredWork, setShowAllDeliveredWork] =
    useState(false);

  useEffect(() => {
    if (!runningStartedAt) {
      setElapsedSeconds(0);
      return undefined;
    }

    function updateElapsedTime() {
      setElapsedSeconds(
        Math.max(
          0,
          Math.floor(
            (Date.now() - runningStartedAt) / 1000,
          ),
        ),
      );
    }

    updateElapsedTime();

    const intervalId = window.setInterval(updateElapsedTime, 1000);

    return () => window.clearInterval(intervalId);
  }, [runningStartedAt]);

  const readableResultText = buildReadableProgrammerResultText({
    execution,
    error,
  });

  useEffect(() => {
    if (!readableResultText) {
      setCopyStatus(null);
      return;
    }

    let cancelled = false;

    async function attemptCopy() {
      try {
        if (
          typeof navigator === "undefined" ||
          !navigator.clipboard ||
          typeof navigator.clipboard.writeText !== "function"
        ) {
          if (!cancelled) {
            setCopyStatus("blocked");
          }
          return;
        }

        await navigator.clipboard.writeText(readableResultText);

        if (!cancelled) {
          setCopyStatus("success");
        }
      } catch {
        if (!cancelled) {
          setCopyStatus("blocked");
        }
      }
    }

    attemptCopy();

    return () => {
      cancelled = true;
    };
  }, [readableResultText]);

  async function copyResultsManually() {
    try {
      if (
        typeof navigator === "undefined" ||
        !navigator.clipboard ||
        typeof navigator.clipboard.writeText !== "function"
      ) {
        setCopyStatus("blocked");
        return;
      }

      await navigator.clipboard.writeText(readableResultText);
      setCopyStatus("success");
    } catch {
      setCopyStatus("blocked");
    }
  }

  const runningCommand =
    commands.find((command) => command.id === runningCommandId) || null;

  const estimatedProgress = runningCommand
    ? calculateProgrammerCommandProgress({
        elapsedSeconds,
        expectedDurationSeconds: runningCommand.expectedDurationSeconds,
      })
    : 0;

  async function executeCommand(command, reviewedMetadata = null) {
    if (
      command.confirmationRequired &&
      !window.confirm(
        `${command.label}\n\n${command.description}\n\nContinue?`,
      )
    ) {
      return;
    }

    setRunningCommandId(command.id);
    setRunningStartedAt(Date.now());
    setExecution(null);
    setError("");
    setCopyStatus(null);

    try {
      const response = await fetch("/api/forge/developer/commands", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          commandId: command.id,
          ...(reviewedMetadata
            ? { reviewedMetadata }
            : {}),
        }),
      });

      const payload = await response.json();

      if (!response.ok || !payload?.result) {
        throw new Error(
          payload?.error || "Programmer command failed.",
        );
      }

      setExecution(payload.result);
    } catch (executionError) {
      setError(
        executionError instanceof Error
          ? executionError.message
          : "Programmer command failed.",
      );
    } finally {
      setRunningCommandId(null);
      setRunningStartedAt(null);
    }
  }

  async function startCommand(command) {
    if (!command.requiresSessionReview) {
      executeCommand(command);
      return;
    }

    setReviewFields(createEmptySessionReviewFields());
    setReviewValidationError(null);
    setReviewProposal(null);
    setReviewProposalError("");
    setReviewMode("summary");
    setReviewProposalStatus("loading");
    setShowAllDeliveredWork(false);
    setReviewCommand(command);

    try {
      const response = await fetch(
        "/api/forge/developer/commands/closeout-proposal",
      );

      const payload = await response.json();

      if (!response.ok || !payload?.proposal) {
        throw new Error(
          payload?.error ||
            "Could not build a closeout proposal.",
        );
      }

      setReviewProposal(payload.proposal);
      setReviewFields(
        sessionReviewFieldsFromProposal(payload.proposal),
      );
      setReviewProposalStatus("ready");
    } catch (proposalError) {
      setReviewProposalError(
        proposalError instanceof Error
          ? proposalError.message
          : "Could not build a closeout proposal.",
      );
      setReviewProposalStatus("error");
      setReviewMode("edit");
    }
  }

  function updateReviewField(field, value) {
    setReviewFields((current) => ({
      ...current,
      [field]: value,
    }));
    setReviewValidationError(null);
  }

  function cancelSessionReview() {
    setReviewCommand(null);
    setReviewValidationError(null);
    setReviewProposal(null);
    setReviewProposalStatus("idle");
    setReviewProposalError("");
    setReviewMode("summary");
    setShowAllDeliveredWork(false);
  }

  function openEditDetails() {
    setReviewMode("edit");
  }

  function submitReview() {
    if (isSessionReviewIncomplete(reviewFields)) {
      setReviewValidationError(
        "This proposal is missing a required governance field (phase, objective, or next-session details). Use Edit details to fill it in before approving.",
      );
      setReviewMode("edit");
      return;
    }

    const validation = validateSessionReviewFields(reviewFields);

    if (!validation.valid) {
      setReviewValidationError(validation.message);
      return;
    }

    const command = reviewCommand;

    setReviewCommand(null);
    setReviewValidationError(null);
    setReviewProposal(null);
    setReviewProposalStatus("idle");
    setReviewProposalError("");
    setReviewMode("summary");
    executeCommand(command, validation.payload);
  }

  function approveSessionReview(event) {
    event.preventDefault();
    submitReview();
  }

  return (
    <main
      data-programmer-dashboard
      className="min-h-screen bg-slate-950 px-4 py-6 text-slate-950 lg:px-8"
    >
      <div className="mx-auto max-w-7xl">
        <header className="rounded-2xl border border-slate-200 bg-white p-5 text-slate-950 shadow-sm">
          <div className="text-xs font-black uppercase tracking-[0.18em] text-amber-700">
            Private Programmer Tools
          </div>

          <h1 className="mt-2 text-2xl font-black">
            FORGE Programmer Dashboard
          </h1>

          <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-slate-600">
            Choose an approved engineering action. FORGE explains what it does, verifies your identity again at the API boundary, and displays the result here.
          </p>

          <div className="mt-4 inline-flex rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-900">
            Authorized as {programmerEmail}
          </div>

          <p className="mt-3 text-xs font-bold text-slate-500">
            Repository commands execute only from the authorized local FORGE workstation. They are disabled on Vercel.
          </p>
        </header>

        <div
          data-programmer-dashboard-layout
          className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_420px] lg:items-start"
        >
          <section
            data-programmer-commands-column
            aria-label="Programmer commands"
            className="grid items-start gap-4 md:grid-cols-2"
          >
            {commands.map((command) => {
              const running = runningCommandId === command.id;

              return (
                <article
                  key={command.id}
                  className="rounded-2xl border border-slate-200 bg-white p-5 text-slate-950 shadow-sm"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-xs font-black uppercase tracking-wide text-slate-500">
                        {command.category}
                      </div>

                      <h2 className="mt-1 text-lg font-black text-slate-950">
                        {command.label}
                      </h2>
                    </div>

                    <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[10px] font-black uppercase tracking-wide text-slate-600">
                      {riskLabel(command.risk)}
                    </span>
                  </div>

                  <p className="mt-3 text-sm font-semibold leading-6 text-slate-600">
                    {command.description}
                  </p>

                  <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950 p-3">
                    <div className="text-[10px] font-black uppercase tracking-wide text-amber-400">
                      Command preview
                    </div>

                    <div className="mt-2 space-y-2">
                      {command.commandPreview.map((preview, index) => (
                        <code
                          key={`${command.id}-preview-${index}`}
                          className="block break-all font-mono text-xs leading-5 text-slate-100"
                        >
                          {preview}
                        </code>
                      ))}
                    </div>
                  </div>

                  {command.confirmationRequired && (
                    <p className="mt-3 text-xs font-bold text-amber-800">
                      Confirmation required before execution.
                    </p>
                  )}

                  <div className="mt-4 flex flex-wrap items-center gap-4">
                    <button
                      type="button"
                      disabled={
                        runningCommandId !== null ||
                        reviewCommand !== null
                      }
                      onClick={() => startCommand(command)}
                      className="rounded-xl bg-slate-950 px-4 py-3 text-sm font-black text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {running
                        ? "Running…"
                        : command.requiresSessionReview
                          ? "Review & run"
                          : "Run action"}
                    </button>

                    {running && elapsedSeconds >= 5 && (
                      <div
                        data-programmer-command-progress
                        className="min-w-52 flex-1"
                      >
                        <div className="flex items-center justify-between gap-3 text-[11px] font-black uppercase tracking-wide text-slate-600">
                          <span>Estimated progress</span>

                          <span>
                            {estimatedProgress}% · {elapsedSeconds}s
                          </span>
                        </div>

                        <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200">
                          <div
                            className="h-full rounded-full bg-amber-500 transition-[width] duration-1000"
                            style={{
                              width: `${estimatedProgress}%`,
                            }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </section>

          <section
            data-programmer-results-panel
            className="rounded-2xl border border-slate-300 bg-white p-5 text-slate-950 shadow-sm lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:overflow-auto"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-black">Execution result</h2>

              {execution && (
                <span
                  className={[
                    "rounded-full border px-3 py-1 text-xs font-black uppercase",
                    statusClass(execution.status),
                  ].join(" ")}
                >
                  {execution.status}
                </span>
              )}
            </div>

            {!execution && !error && (
              <p
                data-programmer-results-empty
                className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm font-semibold text-slate-500"
              >
                Results will appear here after you run an action.
              </p>
            )}

            {(execution || error) && (
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={copyResultsManually}
                  className="rounded-xl border border-slate-300 bg-slate-100 px-4 py-2 text-xs font-black uppercase tracking-wide text-slate-800 transition hover:bg-slate-200"
                >
                  Copy results
                </button>

                {copyStatus === "success" && (
                  <span className="text-xs font-bold text-emerald-700">
                    Results copied automatically.
                  </span>
                )}

                {copyStatus === "blocked" && (
                  <span className="text-xs font-bold text-amber-700">
                    Clipboard permission blocked. Use Copy results to try again.
                  </span>
                )}
              </div>
            )}

            {error && (
              <p
                role="alert"
                className="mt-4 rounded-xl border border-rose-300 bg-rose-50 p-4 text-sm font-bold text-rose-900"
              >
                {error}
              </p>
            )}

            {execution && (
              <div className="mt-4 space-y-4">
                <div>
                  <div className="text-sm font-black">
                    {execution.label}
                  </div>

                  <div className="mt-1 text-xs font-semibold text-slate-500">
                    {execution.startedAt && execution.completedAt
                      ? `${execution.startedAt} → ${execution.completedAt}`
                      : "Execution completed"}
                  </div>
                </div>

                {execution.steps.map((step, index) => (
                  <article
                    key={`${step.command}-${index}`}
                    className={[
                      "rounded-xl border p-4",
                      statusClass(step.status),
                    ].join(" ")}
                  >
                    <div className="text-xs font-black uppercase tracking-wide">
                      Step {index + 1} · {step.status}
                    </div>

                    <div className="mt-2 break-all font-mono text-xs font-bold">
                      {step.command}
                    </div>

                    <pre className="mt-3 max-h-[36rem] overflow-auto whitespace-pre-wrap rounded-lg bg-slate-950 p-4 text-xs leading-5 text-slate-100">
                      {step.output || "Command completed without output."}
                    </pre>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>

      {reviewCommand && (
        <div
          data-session-review-overlay
          className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-slate-950/70 p-4 py-10"
        >
          <form
            data-session-review-form
            aria-label={`Review before running ${reviewCommand.label}`}
            onSubmit={approveSessionReview}
            className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 text-slate-950 shadow-xl"
          >
            <h2 className="text-lg font-black">
              Review before running: {reviewCommand.label}
            </h2>

            {reviewProposalStatus === "loading" && (
              <p
                data-session-review-loading
                className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm font-semibold text-slate-600"
              >
                Building a proposal from repository evidence…
              </p>
            )}

            {reviewProposalStatus === "error" && (
              <p
                role="alert"
                data-session-review-proposal-error
                className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm font-bold text-amber-900"
              >
                {reviewProposalError} FORGE could not build a proposal, so
                fill in the details yourself below.
              </p>
            )}

            {reviewMode === "summary" &&
              reviewProposalStatus === "ready" && (
                <div
                  data-session-review-summary
                  className="mt-4 space-y-4"
                >
                  <p className="text-sm font-semibold leading-6 text-slate-600">
                    FORGE built this proposal from repository evidence
                    (governance state, commits since the last session,
                    validation results, and the synchronized roadmap).
                    Fields marked{" "}
                    <span className="font-black text-amber-700">
                      Proposed
                    </span>{" "}
                    could not be derived from trustworthy governance
                    history and were filled in as a starting point — review
                    them before approving. Edit anything before approving,
                    or approve as-is.
                  </p>

                  <div>
                    <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-wide text-slate-500">
                      Phase
                      {reviewProposal?.fallbackApplied?.phase && (
                        <span
                          data-session-review-fallback-badge="phase"
                          className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-black text-amber-800"
                        >
                          Proposed
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-sm font-bold text-slate-900">
                      {reviewFields.phaseIdentifier ||
                        "REVIEW_REQUIRED"}{" "}
                      —{" "}
                      {reviewFields.phaseTitle ||
                        "REVIEW_REQUIRED"}
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-wide text-slate-500">
                      Objective
                      {reviewProposal?.fallbackApplied
                        ?.objective && (
                        <span
                          data-session-review-fallback-badge="objective"
                          className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-black text-amber-800"
                        >
                          Proposed
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-sm font-semibold text-slate-900">
                      {reviewFields.endingObjective ||
                        "No objective on record. Add one below."}
                    </div>
                  </div>

                  <div>
                    <div className="text-[11px] font-black uppercase tracking-wide text-slate-500">
                      Delivered work
                    </div>
                    {reviewProposal?.deliveredWork?.length > 0 ? (
                      <>
                        <ul className="mt-1 list-disc space-y-1 pl-5 text-sm font-semibold text-slate-900">
                          {(showAllDeliveredWork
                            ? reviewProposal.deliveredWork
                            : reviewProposal.deliveredWork.slice(
                                0,
                                INITIAL_DELIVERED_WORK_DISPLAY_COUNT,
                              )
                          ).map((item, index) => (
                            <li key={`delivered-${index}`}>
                              {item}
                            </li>
                          ))}
                        </ul>

                        {reviewProposal.deliveredWork.length >
                          INITIAL_DELIVERED_WORK_DISPLAY_COUNT && (
                          <button
                            type="button"
                            data-session-review-toggle-delivered-work
                            onClick={() =>
                              setShowAllDeliveredWork(
                                (current) => !current,
                              )
                            }
                            className="mt-2 text-xs font-black uppercase tracking-wide text-slate-600 underline decoration-dotted underline-offset-2 hover:text-slate-900"
                          >
                            {showAllDeliveredWork
                              ? "Show fewer items"
                              : `Show all ${reviewProposal.deliveredWork.length} items`}
                          </button>
                        )}

                        {reviewProposal.generatedFrom
                          ?.recoveryMode && (
                          <div className="mt-2 text-xs font-semibold text-slate-500">
                            No trustworthy prior session checkpoint
                            was found, so this list is a bounded
                            recovery estimate
                            {reviewProposal.generatedFrom
                              .excludedCommitCount > 0
                              ? ` (${reviewProposal.generatedFrom.excludedCommitCount} older, unrelated commits were excluded)`
                              : ""}
                            .
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="mt-1 text-sm font-semibold text-slate-500">
                        No commits since the last recorded session.
                      </div>
                    )}
                  </div>

                  <div>
                    <div className="text-[11px] font-black uppercase tracking-wide text-slate-500">
                      Validation result
                    </div>
                    <div className="mt-1 flex flex-wrap gap-2 text-xs font-black uppercase">
                      {VALIDATION_CATEGORIES.map(
                        ({ key, label }) => {
                          const status =
                            reviewProposal?.validation?.[key]
                              ?.status;

                          const displayValue = reviewProposal?.hasCurrentValidationArtifact
                            ? validationStatusLabel(status)
                            : "Pending closeout";

                          return (
                            <span
                              key={key}
                              className={[
                                "rounded-full border px-2 py-1",
                                statusClass(status),
                              ].join(" ")}
                            >
                              {label}: {displayValue}
                            </span>
                          );
                        },
                      )}
                    </div>
                  </div>

                  <div>
                    <div className="text-[11px] font-black uppercase tracking-wide text-slate-500">
                      Known warnings
                    </div>
                    <div className="mt-1 text-sm font-semibold text-slate-900">
                      {reviewProposal?.knownWarnings?.length > 0
                        ? reviewProposal.knownWarnings.join(
                            ", ",
                          )
                        : "None detected."}
                    </div>
                  </div>

                  <div>
                    <div className="text-[11px] font-black uppercase tracking-wide text-slate-500">
                      Completion status
                    </div>
                    <div className="mt-1 text-sm font-semibold text-slate-900">
                      {reviewFields.markSessionComplete
                        ? "Will mark complete if closeout validation passes; otherwise it will remain incomplete."
                        : "Proposed: leave incomplete (validation evidence does not yet fully cover this commit)."}
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-wide text-slate-500">
                      Next objective
                      {reviewProposal?.fallbackApplied
                        ?.nextObjective && (
                        <span
                          data-session-review-fallback-badge="nextObjective"
                          className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-black text-amber-800"
                        >
                          Proposed
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-sm font-semibold text-slate-900">
                      {reviewFields.nextSessionObjective ||
                        "No next objective on record. Add one below."}
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-wide text-slate-500">
                      Next inspection
                      {reviewProposal?.fallbackApplied
                        ?.nextInspection && (
                        <span
                          data-session-review-fallback-badge="nextInspection"
                          className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-black text-amber-800"
                        >
                          Proposed
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-sm font-semibold text-slate-900">
                      {reviewFields
                        .nextSessionStartingInspection ||
                        "No starting inspection on record. Add one below."}
                    </div>
                  </div>
                </div>
              )}

            {reviewMode === "edit" && (
              <>
            <p className="mt-4 text-sm font-semibold leading-6 text-slate-600">
              FORGE will not choose these values for you. Fill in what you
              know, or leave a field blank to keep it marked
              REVIEW_REQUIRED in the generated governance documents.
            </p>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label
                htmlFor="review-phase-identifier"
                className="block text-xs font-black uppercase tracking-wide text-slate-600"
              >
                Phase identifier
                <input
                  id="review-phase-identifier"
                  type="text"
                  value={reviewFields.phaseIdentifier}
                  onChange={(event) =>
                    updateReviewField(
                      "phaseIdentifier",
                      event.target.value,
                    )
                  }
                  className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm font-semibold normal-case text-slate-900"
                />
              </label>

              <label
                htmlFor="review-phase-title"
                className="block text-xs font-black uppercase tracking-wide text-slate-600"
              >
                Phase title
                <input
                  id="review-phase-title"
                  type="text"
                  value={reviewFields.phaseTitle}
                  onChange={(event) =>
                    updateReviewField(
                      "phaseTitle",
                      event.target.value,
                    )
                  }
                  className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm font-semibold normal-case text-slate-900"
                />
              </label>
            </div>

            <label
              htmlFor="review-starting-objective"
              className="mt-4 block text-xs font-black uppercase tracking-wide text-slate-600"
            >
              Starting objective
              <textarea
                id="review-starting-objective"
                rows={2}
                value={reviewFields.startingObjective}
                onChange={(event) =>
                  updateReviewField(
                    "startingObjective",
                    event.target.value,
                  )
                }
                className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm font-semibold normal-case text-slate-900"
              />
            </label>

            <label
              htmlFor="review-ending-objective"
              className="mt-4 block text-xs font-black uppercase tracking-wide text-slate-600"
            >
              Ending / current objective
              <textarea
                id="review-ending-objective"
                rows={2}
                value={reviewFields.endingObjective}
                onChange={(event) =>
                  updateReviewField(
                    "endingObjective",
                    event.target.value,
                  )
                }
                className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm font-semibold normal-case text-slate-900"
              />
            </label>

            <label
              htmlFor="review-delivered-work"
              className="mt-4 block text-xs font-black uppercase tracking-wide text-slate-600"
            >
              Completed work items (one per line)
              <textarea
                id="review-delivered-work"
                rows={3}
                value={reviewFields.deliveredWork}
                onChange={(event) =>
                  updateReviewField(
                    "deliveredWork",
                    event.target.value,
                  )
                }
                className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm font-semibold normal-case text-slate-900"
              />
            </label>

            <label
              htmlFor="review-known-warnings"
              className="mt-4 block text-xs font-black uppercase tracking-wide text-slate-600"
            >
              Known warnings (one per line)
              <textarea
                id="review-known-warnings"
                rows={2}
                value={reviewFields.knownWarnings}
                onChange={(event) =>
                  updateReviewField(
                    "knownWarnings",
                    event.target.value,
                  )
                }
                className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm font-semibold normal-case text-slate-900"
              />
            </label>

            <label
              htmlFor="review-mark-complete"
              className="mt-4 flex items-center gap-2 text-xs font-black uppercase tracking-wide text-slate-600"
            >
              <input
                id="review-mark-complete"
                type="checkbox"
                checked={reviewFields.markSessionComplete}
                onChange={(event) =>
                  updateReviewField(
                    "markSessionComplete",
                    event.target.checked,
                  )
                }
              />
              Work complete
            </label>

            <label
              htmlFor="review-incomplete-reason"
              className="mt-4 block text-xs font-black uppercase tracking-wide text-slate-600"
            >
              Completion explanation
              <textarea
                id="review-incomplete-reason"
                rows={2}
                value={reviewFields.incompleteReason}
                onChange={(event) =>
                  updateReviewField(
                    "incompleteReason",
                    event.target.value,
                  )
                }
                className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm font-semibold normal-case text-slate-900"
              />
            </label>

            <label
              htmlFor="review-next-session-objective"
              className="mt-4 block text-xs font-black uppercase tracking-wide text-slate-600"
            >
              Next-session objective
              <textarea
                id="review-next-session-objective"
                rows={2}
                value={reviewFields.nextSessionObjective}
                onChange={(event) =>
                  updateReviewField(
                    "nextSessionObjective",
                    event.target.value,
                  )
                }
                className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm font-semibold normal-case text-slate-900"
              />
            </label>

            <label
              htmlFor="review-next-session-starting-inspection"
              className="mt-4 block text-xs font-black uppercase tracking-wide text-slate-600"
            >
              Next-session starting inspection
              <textarea
                id="review-next-session-starting-inspection"
                rows={2}
                value={reviewFields.nextSessionStartingInspection}
                onChange={(event) =>
                  updateReviewField(
                    "nextSessionStartingInspection",
                    event.target.value,
                  )
                }
                className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm font-semibold normal-case text-slate-900"
              />
            </label>
              </>
            )}

            {reviewValidationError && (
              <p
                role="alert"
                data-session-review-error
                className="mt-4 rounded-xl border border-rose-300 bg-rose-50 p-3 text-xs font-bold text-rose-900"
              >
                {reviewValidationError}
              </p>
            )}

            <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
              <button
                type="button"
                onClick={cancelSessionReview}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-black uppercase tracking-wide text-slate-700 transition hover:bg-slate-100"
              >
                Cancel
              </button>

              {reviewMode === "summary" &&
                reviewProposalStatus === "ready" && (
                  <>
                    {isSessionReviewIncomplete(
                      reviewFields,
                    ) && (
                      <span
                        data-session-review-incomplete-hint
                        className="text-xs font-bold text-amber-700"
                      >
                        Missing a required field. Use Edit
                        details to fill it in.
                      </span>
                    )}

                    <button
                      type="button"
                      onClick={openEditDetails}
                      className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-black uppercase tracking-wide text-slate-700 transition hover:bg-slate-100"
                    >
                      Edit details
                    </button>

                    <button
                      type="button"
                      onClick={submitReview}
                      disabled={isSessionReviewIncomplete(
                        reviewFields,
                      )}
                      className="rounded-xl bg-slate-950 px-4 py-2 text-xs font-black uppercase tracking-wide text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Approve closeout
                    </button>
                  </>
                )}

              {reviewMode === "edit" && (
                <button
                  type="submit"
                  className="rounded-xl bg-slate-950 px-4 py-2 text-xs font-black uppercase tracking-wide text-white transition hover:bg-slate-800"
                >
                  Approve &amp; run
                </button>
              )}
            </div>
          </form>
        </div>
      )}
    </main>
  );
}
