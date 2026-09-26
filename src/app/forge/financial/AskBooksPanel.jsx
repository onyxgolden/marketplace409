"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { forgeTheme } from "@/components/forge/theme";
import { ForgeActionButton } from "@/components/forge/ForgeActions";
import { formatLedgerAnswer } from "@/domains/ledger/brain/formatLedgerAnswer.js";
import { ledgerMoney } from "./formatMoney.js";

async function askBooks(question) {
  const response = await fetch("/api/financial/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question }),
  });
  const payload = await response.json();

  if (!response.ok || payload?.success !== true) {
    throw new Error(payload?.error || "Could not answer that question. Try again.");
  }

  return payload.data;
}

export default function AskBooksPanel() {
  const [collapsed, setCollapsed] = useState(false);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState(null);
  const [unparseableHint, setUnparseableHint] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const ask = async (event) => {
    event.preventDefault();

    const trimmed = question.trim();

    if (!trimmed) {
      setError("Type a question first.");
      return;
    }

    setIsLoading(true);
    setError(null);
    setAnswer(null);
    setUnparseableHint(null);

    try {
      const data = await askBooks(trimmed);

      if (data?.unparseable) {
        setUnparseableHint(data.hint);
      } else {
        setAnswer(data.answer);
      }
    } catch (askError) {
      setError(
        askError instanceof Error
          ? askError.message
          : "Could not answer that question. Try again.",
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <section
      data-ask-books
      className={forgeTheme.card}
    >
      <button
        type="button"
        onClick={() => setCollapsed((current) => !current)}
        aria-expanded={!collapsed}
        className="flex w-full items-start justify-between gap-3 rounded-xl text-left"
      >
        <span className="min-w-0">
          <span className={forgeTheme.labelSmall}>
            Forge Brain
          </span>

          <h2 className="mt-2 text-2xl font-black text-slate-950 dark:text-slate-50">
            Ask the books
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
            Ask about your books in plain words — no tokens, no waiting on a
            model. Try “what did I spend on dining last month?” or “revenue
            from rent in Q2”.
          </p>

          <form
            onSubmit={ask}
            className="mt-4 flex flex-col gap-3 sm:flex-row"
          >
            <input
              type="text"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="What did I spend on groceries in August?"
              aria-label="Ask the books a question"
              className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-900 placeholder:text-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
            />

            <ForgeActionButton
              type="submit"
              variant="accent"
              disabled={isLoading}
            >
              {isLoading ? "Asking…" : "Ask"}
            </ForgeActionButton>
          </form>

          <div className="mt-5">
            {isLoading && (
              <p className={forgeTheme.textSmall}>
                Reading the ledger…
              </p>
            )}

            {error && (
              <p className="text-sm text-red-600 dark:text-red-400">
                {error}
              </p>
            )}

            {unparseableHint && (
              <p className={forgeTheme.textSmall}>
                {unparseableHint}
              </p>
            )}

            {answer && (
              <>
                <p className="text-base font-bold text-slate-950 dark:text-white">
                  {formatLedgerAnswer(answer, ledgerMoney)}
                </p>

                {answer.lines.length > 0 ? (
                  <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800">
                    <table className="w-full border-collapse text-left">
                      <thead className="bg-slate-100 text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
                        <tr>
                          <th className="p-4">Account</th>
                          <th className="p-4 text-right">Amount</th>
                        </tr>
                      </thead>

                      <tbody className="text-sm">
                        {answer.lines.map((line) => (
                          <tr
                            key={line.accountId}
                            className="border-t border-slate-100 dark:border-slate-800"
                          >
                            <td className="p-4 text-slate-700 dark:text-slate-300">
                              {line.name}
                            </td>
                            <td className="p-4 text-right tabular-nums text-slate-900 dark:text-slate-100">
                              {ledgerMoney(line.amount)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className={`${forgeTheme.textSmall} mt-3`}>
                    No matching activity in {answer.period.label}.
                  </p>
                )}
              </>
            )}
          </div>
        </>
      )}
    </section>
  );
}
