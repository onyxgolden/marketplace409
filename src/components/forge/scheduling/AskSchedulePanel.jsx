"use client";
import { useCallback, useState } from "react";
import { SUPPORTED_SCHEDULE_QUESTIONS } from "@/domains/scheduling/schedulingAskSchedule";

// Read-only "Ask the Schedule" panel for the docked inspector rail. Sends the
// question to POST /api/forge/scheduling/[projectId]/ask and renders the
// deterministic answer (summary + item list). No LLM: the API answers only its
// fixed question set and returns the supported list for anything else.
export function AskSchedulePanel({ projectId, onClose }) {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [answer, setAnswer] = useState(null);

  const ask = useCallback(async (text) => {
    const trimmed = String(text ?? "").trim();
    if (!trimmed || loading) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/forge/scheduling/${projectId}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || "The schedule could not answer that.");
      setAnswer(body);
    } catch (err) {
      setError(err.message);
      setAnswer(null);
    } finally {
      setLoading(false);
    }
  }, [projectId, loading]);

  const submit = (event) => {
    event.preventDefault();
    ask(question);
  };

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-black text-slate-900">Ask the Schedule</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            Deterministic answers from the live CPM run. Read-only — nothing here changes the schedule.
          </p>
        </div>
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Close panel"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-lg font-black text-slate-500 hover:bg-slate-100 hover:text-slate-800">
            &times;
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {SUPPORTED_SCHEDULE_QUESTIONS.map((preset) => (
          <button key={preset.id} type="button" disabled={loading}
            onClick={() => { setQuestion(preset.example); ask(preset.example); }}
            className="rounded-full border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50">
            {preset.label}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="flex gap-2">
        <input
          type="text"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder='Ask about the schedule, e.g. "Which milestones are late?"'
          aria-label="Ask a question about the schedule"
          className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm text-slate-900 placeholder:text-slate-400"
        />
        <button type="submit" disabled={loading || !question.trim()}
          className="shrink-0 rounded-lg bg-slate-950 px-3 py-1.5 text-sm font-bold text-white disabled:opacity-50">
          {loading ? "Asking…" : "Ask"}
        </button>
      </form>

      {error && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-2 text-xs text-red-700">
          {error}
        </p>
      )}

      {answer && (
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
          <p className="text-sm font-semibold text-slate-900">{answer.summary}</p>
          {answer.items.length > 0 ? (
            <ul className="flex flex-col gap-1.5">
              {answer.items.map((item) => (
                <li key={`${item.taskCode}-${item.label}-${item.detail}`}
                  className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5">
                  <p className="text-xs font-bold text-slate-900">
                    {item.taskCode}{item.label ? ` — ${item.label}` : ""}
                  </p>
                  {item.detail && <p className="mt-0.5 text-xs text-slate-600">{item.detail}</p>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs italic text-slate-500">Nothing to list for this answer.</p>
          )}
        </div>
      )}
    </div>
  );
}
