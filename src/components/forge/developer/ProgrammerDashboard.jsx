"use client";

import {
  useEffect,
  useState,
} from "react";

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

  async function executeCommand(command) {
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

  return (
    <main
      data-programmer-dashboard
      className="min-h-screen bg-slate-100 px-4 py-6 text-slate-950 lg:px-8"
    >
      <div className="mx-auto max-w-7xl">
        <header className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
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
                  className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
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
                      disabled={runningCommandId !== null}
                      onClick={() => executeCommand(command)}
                      className="rounded-xl bg-slate-950 px-4 py-3 text-sm font-black text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {running ? "Running…" : "Run action"}
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
            className="rounded-2xl border border-slate-300 bg-white p-5 shadow-sm lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:overflow-auto"
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
    </main>
  );
}
