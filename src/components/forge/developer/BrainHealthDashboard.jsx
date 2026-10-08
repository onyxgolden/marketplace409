"use client";
import { useCallback, useState } from "react";
import { useStaleWhileRevalidate } from "@/hooks/useStaleWhileRevalidate";
import {
  ForgeEmptyState,
  ForgeErrorState,
  ForgeLoadingState,
} from "@/components/forge/ForgeStates";
import { goldControlClassName } from "@/components/forge/forgeMetallicTheme";

const STATE_BADGE = {
  confirmed: "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200",
  suspected: "border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-800 dark:bg-sky-950/30 dark:text-sky-200",
  unavailable: "border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300",
  stale: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200",
  "not-enabled": "border-slate-400 bg-slate-100 text-slate-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400",
};

function StateBadge({ state }) {
  return (
    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-black ${STATE_BADGE[state] || STATE_BADGE.unavailable}`}>
      {state}
    </span>
  );
}

function SectionCard({ title, children }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <h2 className="text-sm font-black uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

async function fetchHealth() {
  const res = await fetch("/api/forge/engineering-brain/health");
  const payload = await res.json();
  if (!res.ok) throw new Error(payload.error || "Unable to load engineering health.");
  return payload;
}

function buildDraftMarkdown({ findings, openQuestions }) {
  const lines = ["# Engineering Brain review handoff", ""];
  lines.push(`Drafted: ${new Date().toISOString()}`);
  lines.push("_Draft only — preview/copy/export. Nothing has been posted or assigned._");
  lines.push("");
  if (findings.length > 0) {
    lines.push("## Evidence-linked findings", "");
    for (const f of findings) {
      lines.push(`### ${f.what}`);
      lines.push(`- Subsystem: ${f.subsystem}`);
      lines.push(`- Why it matters: ${f.whyItMatters}`);
      lines.push(`- Confidence: ${f.confidence}${f.lastSeen ? ` (last seen ${f.lastSeen})` : ""}`);
      lines.push(`- Next step: ${f.nextStep}`);
      lines.push(`- Evidence: ${f.evidenceLinks.map((l) => `${l.label} (${l.ref})`).join("; ")}`);
      lines.push("");
    }
  }
  lines.push("## Open questions for the reviewer", "");
  lines.push(openQuestions.trim() ? openQuestions.trim().split("\n").map((q) => `- ${q}`).join("\n") : "_none_");
  lines.push("");
  return lines.join("\n");
}

export function HandoffDraftBuilder({ findings }) {
  const [openQuestions, setOpenQuestions] = useState("");
  const [copied, setCopied] = useState(false);
  const draft = buildDraftMarkdown({ findings: findings || [], openQuestions });

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(draft);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }, [draft]);

  return (
    <SectionCard title="Review handoff draft">
      <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
        Read-only draft builder. Assembles the findings above into a review handoff.
        Preview below, copy to clipboard, or paste into a ChatGPT/Claude review request.
        Nothing is posted or assigned automatically.
      </p>
      <label className="mt-3 block">
        <span className="block text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Open questions for the reviewer (one per line)
        </span>
        <textarea
          value={openQuestions}
          onChange={(e) => setOpenQuestions(e.target.value)}
          rows={3}
          placeholder="e.g. Is this coverage gap acceptable for a daily job?"
          className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-sm dark:border-slate-600 dark:bg-slate-950 dark:text-white"
        />
      </label>
      <pre className="mt-3 max-h-64 overflow-auto rounded-lg bg-slate-950 p-3 font-mono text-xs text-slate-200 dark:bg-black">
        {draft}
      </pre>
      <button
        type="button"
        onClick={handleCopy}
        className={`mt-3 rounded-lg px-5 py-2 text-sm font-black transition ${goldControlClassName}`}
      >
        {copied ? "Copied ✓" : "Copy draft to clipboard"}
      </button>
    </SectionCard>
  );
}

export default function BrainHealthDashboard() {
  const { data, error, isLoading, refresh } = useStaleWhileRevalidate(
    "engineering-brain:health",
    fetchHealth,
    { ttlMs: 60_000 },
  );

  if (isLoading && !data) {
    return (
      <div className="mt-5">
        <ForgeLoadingState label="Loading engineering health…" />
      </div>
    );
  }
  if (error && !data) {
    return (
      <div className="mt-5">
        <ForgeErrorState title={error || "Unable to load engineering health."} onRetry={refresh} />
      </div>
    );
  }
  if (!data) {
    return (
      <div className="mt-5">
        <ForgeEmptyState headline="No health data." guidance="The health endpoint returned nothing usable." />
      </div>
    );
  }

  const { health, findings } = data;
  const coverage = health.runtimeCoverage;

  return (
    <div className="mt-5 flex flex-col gap-4">
      {/* Watchdog honesty banner — always visible */}
      <div className="rounded-xl border border-slate-300 bg-slate-100 p-4 text-sm text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300">
        <p className="font-black">Watchdog: not enabled</p>
        <p className="mt-1 text-xs font-semibold">
          {health.watchdog.detail} Coverage states below come from the static registry and indexed
          evidence — not from live monitoring.
        </p>
      </div>

      <SectionCard title={`Runtime coverage — ${coverage.totalCapabilities} capabilities`}>
        <div className="flex flex-wrap gap-2">
          {Object.entries(coverage.byMonitoringStatus).map(([status, count]) => (
            <span key={status} className="flex items-center gap-2 rounded-full border border-slate-200 px-3 py-1 text-xs font-bold dark:border-slate-700">
              <StateBadge state={status === "covered" ? "confirmed" : status === "uncovered" ? "stale" : "suspected"} />
              {status}: {count}
            </span>
          ))}
        </div>
        <ul className="mt-3 flex max-h-72 flex-col gap-2 overflow-auto">
          {coverage.capabilities.map((cap) => (
            <li key={cap.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-bold">{cap.name}</p>
                <StateBadge state={cap.monitoringStatus === "covered" ? "confirmed" : cap.monitoringStatus === "uncovered" ? "stale" : "suspected"} />
              </div>
              <p className="mt-1 font-mono text-xs text-slate-400">{cap.monitoringStatus}{cap.monitoringNote ? ` — ${cap.monitoringNote}` : ""}</p>
              {cap.executionPath ? <p className="mt-1 text-xs text-slate-500">{cap.executionPath}</p> : null}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-slate-400">Provenance: {coverage.provenance}</p>
      </SectionCard>

      <div className="grid gap-4 md:grid-cols-2">
        <SectionCard title="Index freshness">
          <div className="flex items-center gap-2">
            <StateBadge state={health.index.state} />
          </div>
          <p className="mt-2 text-sm font-semibold">{health.index.detail}</p>
          {health.index.commitSha ? (
            <p className="mt-1 font-mono text-xs text-slate-400">commit {health.index.commitSha.slice(0, 12)}</p>
          ) : null}
          <p className="mt-2 text-xs text-slate-400">Provenance: {health.index.provenance}</p>
        </SectionCard>

        <SectionCard title="Bug catalog">
          <div className="flex items-center gap-2">
            <StateBadge state={health.bugCatalog.state} />
          </div>
          <p className="mt-2 text-sm font-semibold">{health.bugCatalog.detail}</p>
          <p className="mt-2 text-xs text-slate-400">Provenance: {health.bugCatalog.provenance}</p>
        </SectionCard>
      </div>

      <SectionCard title={`Evidence-linked findings — ${findings.length}`}>
        {findings.length === 0 ? (
          <p className="text-sm text-slate-500">No findings. Coverage is healthy and no repaired defects are on record for this run.</p>
        ) : (
          <ul className="flex max-h-96 flex-col gap-3 overflow-auto">
            {findings.map((f) => (
              <li key={f.id} className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                <p className="text-sm font-bold">{f.what}</p>
                <p className="mt-1 text-xs text-slate-500">Subsystem: {f.subsystem}</p>
                <p className="mt-1 text-xs">{f.whyItMatters}</p>
                <p className="mt-2 text-xs font-semibold">
                  Confidence: {f.confidence}
                  {f.lastSeen ? ` · last seen ${f.lastSeen}` : ""}
                </p>
                <p className="mt-1 text-xs text-slate-500">Next step: {f.nextStep}</p>
                <p className="mt-1 font-mono text-xs text-slate-400">
                  Evidence: {f.evidenceLinks.map((l) => l.label).join("; ")}
                </p>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <HandoffDraftBuilder findings={findings} />

      <p className="text-xs text-slate-400">
        Snapshot generated {health.generatedAt}. Advisory only — findings recommend investigation, never assert root cause.
      </p>
    </div>
  );
}
