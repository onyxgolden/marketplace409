"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { forgeTheme } from "@/components/forge/theme";

const FOCUS_RING =
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2";

async function postActions(body) {
  const response = await fetch("/api/financial/actions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error || "That action could not be completed.");
  }
  return payload;
}

function ConfidenceBadge({ confidence }) {
  const pct = Math.round((confidence ?? 0) * 100);
  const tone =
    confidence >= 0.8
      ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200"
      : "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200";
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-black ${tone}`}>
      {pct}%
    </span>
  );
}

export default function BrainActionBar() {
  const [collapsed, setCollapsed] = useState(false);
  const [command, setCommand] = useState("");
  const [plan, setPlan] = useState(null);
  const [gate, setGate] = useState("none");
  const [unparseableHint, setUnparseableHint] = useState(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [confirmationText, setConfirmationText] = useState("");
  const [status, setStatus] = useState("idle");
  const [message, setMessage] = useState("");

  const resetPlan = () => {
    setPlan(null);
    setGate("none");
    setAcknowledged(false);
    setConfirmationText("");
  };

  const planCommand = async (event) => {
    event.preventDefault();
    const trimmed = command.trim();
    if (!trimmed) {
      setMessage("Type a command first.");
      return;
    }
    setStatus("planning");
    setMessage("");
    setUnparseableHint(null);
    resetPlan();
    try {
      const payload = await postActions({ command: trimmed });
      if (payload?.data?.unparseable) {
        setUnparseableHint(payload.data.hint);
      } else {
        setPlan(payload.data.plan);
        setGate(payload.data.gate);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not plan that command.");
    } finally {
      setStatus("idle");
    }
  };

  const canApply =
    plan &&
    plan.items.length > 0 &&
    (gate === "typed"
      ? acknowledged && confirmationText.trim().toUpperCase() === "CONFIRM"
      : acknowledged);

  const applyPlan = async () => {
    setStatus("applying");
    setMessage("");
    try {
      const payload = await postActions({
        command: command.trim(),
        planItems: plan.items.map((item) => ({
          itemKey: item.itemKey,
          kind: item.kind,
          eventId: item.eventId ?? null,
          alertKey: item.alertKey ?? null,
          category: item.category ?? null,
        })),
        confirmation: gate === "typed" ? confirmationText.trim().toUpperCase() : "SINGLE",
      });
      const parts = [];
      if (payload.appliedCount > 0) parts.push(`${payload.appliedCount} applied`);
      if (payload.failedCount > 0) parts.push(`${payload.failedCount} failed`);
      setMessage(
        parts.length > 0
          ? `Done: ${parts.join(", ")}. Nothing was deleted -- amounts and dates are unchanged.`
          : "Nothing was applied.",
      );
      if (payload.failedCount === 0) resetPlan();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not apply that plan.");
    } finally {
      setStatus("idle");
    }
  };

  return (
    <section data-brain-actions className={forgeTheme.card}>
      <button
        type="button"
        onClick={() => setCollapsed((current) => !current)}
        aria-expanded={!collapsed}
        className="flex w-full items-start justify-between gap-3 rounded-xl text-left"
      >
        <span className="min-w-0">
          <span className={forgeTheme.labelSmall}>Forge Brain</span>
          <h2 className="mt-2 text-2xl font-black text-slate-950 dark:text-slate-50">
            Tell the books what to do
          </h2>
        </span>
        <ChevronDown
          size={20}
          aria-hidden="true"
          className={`mt-1 shrink-0 text-slate-500 transition-transform dark:text-slate-400 ${collapsed ? "-rotate-90" : ""}`}
        />
      </button>

      {!collapsed && (
        <>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-400">
            Plain-word commands, planned first and applied only with your
            confirmation. Try “categorize Shell transactions as fuel”,
            “apply suggestions for uncategorized”, “mark transfer for the
            Fidelity legs”, or “dismiss the high duplicate alert”.
          </p>

          <form onSubmit={planCommand} className="mt-4 flex flex-col gap-3 sm:flex-row">
            <input
              type="text"
              value={command}
              onChange={(event) => setCommand(event.target.value)}
              placeholder="categorize Shell transactions as fuel"
              aria-label="Tell the books what to do"
              className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-900 placeholder:text-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
            />
            <button
              type="submit"
              disabled={status === "planning"}
              className={`rounded-xl bg-amber-500 px-5 py-2 text-sm font-bold text-slate-950 disabled:opacity-50 ${FOCUS_RING}`}
            >
              {status === "planning" ? "Planning…" : "Plan"}
            </button>
          </form>

          <div className="mt-5">
            {status === "planning" && (
              <p className={forgeTheme.textSmall}>Reading the command…</p>
            )}

            {message && (
              <p className="text-sm text-slate-700 dark:text-slate-300">{message}</p>
            )}

            {unparseableHint && <p className={forgeTheme.textSmall}>{unparseableHint}</p>}

            {plan && plan.items.length === 0 && (
              <p className={forgeTheme.textSmall}>{plan.summary}</p>
            )}

            {plan && plan.items.length > 0 && (
              <div className="rounded-2xl border border-slate-200 p-5 dark:border-slate-700">
                <p className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  {plan.summary}
                </p>
                <ul className="mt-3 space-y-2">
                  {plan.items.map((item) => (
                    <li
                      key={item.itemKey}
                      className="flex items-start justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800/60"
                    >
                      <span className="text-slate-700 dark:text-slate-300">
                        {item.summary}
                        <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">
                          reversible
                        </span>
                      </span>
                      <ConfidenceBadge confidence={item.confidence} />
                    </li>
                  ))}
                </ul>

                <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/30">
                  <label className="flex gap-3 text-sm font-bold text-amber-950 dark:text-amber-200">
                    <input
                      type="checkbox"
                      checked={acknowledged}
                      onChange={(event) => setAcknowledged(event.target.checked)}
                      className={FOCUS_RING}
                    />
                    I reviewed this plan and understand it reclassifies these{" "}
                    {plan.items.length} item(s). Amounts and dates never change,
                    nothing is deleted, and every action is reversible.
                  </label>
                  {gate === "typed" && (
                    <label className="mt-3 block text-sm font-bold text-amber-950 dark:text-amber-200">
                      Type CONFIRM to apply — some matches are uncertain
                      <input
                        value={confirmationText}
                        onChange={(event) => setConfirmationText(event.target.value)}
                        autoComplete="off"
                        className={`mt-2 block w-full max-w-xs rounded-lg border border-amber-400 bg-white px-3 py-2 text-slate-950 dark:bg-slate-950 dark:text-white ${FOCUS_RING}`}
                      />
                    </label>
                  )}
                  <button
                    type="button"
                    disabled={!canApply || status === "applying"}
                    onClick={applyPlan}
                    className={`mt-4 rounded-xl bg-amber-500 px-5 py-3 text-sm font-black text-slate-950 disabled:cursor-not-allowed disabled:opacity-40 ${FOCUS_RING}`}
                  >
                    {status === "applying"
                      ? "Applying…"
                      : gate === "typed"
                        ? `Apply ${plan.items.length} action(s)`
                        : `Confirm & apply ${plan.items.length} action(s)`}
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
