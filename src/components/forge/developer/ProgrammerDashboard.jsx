"use client";

import {
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

function statusClass(status) {
  if (status === "passing") {
    return "border-emerald-300 bg-emerald-50 text-emerald-900";
  }

  if (status === "failing") {
    return "border-rose-300 bg-rose-50 text-rose-900";
  }

  return "border-slate-300 bg-slate-50 text-slate-700";
}

export default function ProgrammerDashboard({
  commands,
  programmerEmail,
}) {
  const [
    runningCommandId,
    setRunningCommandId,
  ] = useState(null);

  const [
    execution,
    setExecution,
  ] = useState(null);

  const [
    error,
    setError,
  ] = useState("");

  async function executeCommand(
    command,
  ) {
    if (
      command.confirmationRequired &&
      !window.confirm(
        `${command.label}\n\n${command.description}\n\nContinue?`,
      )
    ) {
      return;
    }

    setRunningCommandId(
      command.id,
    );
    setExecution(null);
    setError("");

    try {
      const response =
        await fetch(
          "/api/forge/developer/commands",
          {
            method: "POST",
            headers: {
              "content-type":
                "application/json",
            },
            body:
              JSON.stringify({
                commandId:
                  command.id,
              }),
          },
        );

      const payload =
        await response.json();

      if (
        !response.ok ||
        !payload?.result
      ) {
        throw new Error(
          payload?.error ||
          "Programmer command failed.",
        );
      }

      setExecution(
        payload.result,
      );
    } catch (
      executionError
    ) {
      setError(
        executionError instanceof Error
          ? executionError.message
          : "Programmer command failed.",
      );
    } finally {
      setRunningCommandId(
        null,
      );
    }
  }

  return (
    <main
      data-programmer-dashboard
      className="min-h-screen bg-slate-100 px-4 py-6 text-slate-950 lg:px-8"
    >
      <div className="max-w-6xl">
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

        <section
          aria-label="Programmer commands"
          className="mt-5 grid items-start gap-4 md:grid-cols-2"
        >
          {commands.map(
            (command) => {
              const running =
                runningCommandId ===
                  command.id;

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
                      {riskLabel(
                        command.risk,
                      )}
                    </span>
                  </div>

                  <p className="mt-3 text-sm font-semibold leading-6 text-slate-600">
                    {command.description}
                  </p>

                  {command.confirmationRequired && (
                    <p className="mt-3 text-xs font-bold text-amber-800">
                      Confirmation required before execution.
                    </p>
                  )}

                  <button
                    type="button"
                    disabled={
                      runningCommandId !==
                        null
                    }
                    onClick={() =>
                      executeCommand(
                        command,
                      )
                    }
                    className="mt-4 rounded-xl bg-slate-950 px-4 py-3 text-sm font-black text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {running
                      ? "Running…"
                      : "Run action"}
                  </button>
                </article>
              );
            },
          )}
        </section>

        {(execution || error) && (
          <section className="mt-5 rounded-2xl border border-slate-300 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-black">
                Execution result
              </h2>

              {execution && (
                <span
                  className={[
                    "rounded-full border px-3 py-1 text-xs font-black uppercase",
                    statusClass(
                      execution.status,
                    ),
                  ].join(" ")}
                >
                  {execution.status}
                </span>
              )}
            </div>

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
                    {execution.startedAt &&
                    execution.completedAt
                      ? `${execution.startedAt} → ${execution.completedAt}`
                      : "Execution completed"}
                  </div>
                </div>

                {execution.steps.map(
                  (
                    step,
                    index,
                  ) => (
                    <article
                      key={`${step.command}-${index}`}
                      className={[
                        "rounded-xl border p-4",
                        statusClass(
                          step.status,
                        ),
                      ].join(" ")}
                    >
                      <div className="text-xs font-black uppercase tracking-wide">
                        Step {index + 1} · {step.status}
                      </div>

                      <div className="mt-2 break-all font-mono text-xs font-bold">
                        {step.command}
                      </div>

                      <pre className="mt-3 max-h-[36rem] overflow-auto whitespace-pre-wrap rounded-lg bg-slate-950 p-4 text-xs leading-5 text-slate-100">
                        {step.output ||
                          "Command completed without output."}
                      </pre>
                    </article>
                  ),
                )}
              </div>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
