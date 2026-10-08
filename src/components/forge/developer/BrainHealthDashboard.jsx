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
  "needs-review": "border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-200",
  "evidence-unavailable": "border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300",
  informational: "border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-800 dark:bg-sky-950/30 dark:text-sky-200",
};

const SEVERITY_BADGE = {
  critical: "border-red-500 bg-red-100 text-red-900 dark:border-red-700 dark:bg-red-950/40 dark:text-red-200",
  high: "border-orange-300 bg-orange-50 text-orange-900 dark:border-orange-800 dark:bg-orange-950/30 dark:text-orange-200",
  medium: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200",
  low: "border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300",
};

function SeverityBadge({ severity }) {
  return (
    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-black ${SEVERITY_BADGE[severity] || SEVERITY_BADGE.low}`}>
      {severity}
    </span>
  );
}

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

// Slice 6: triage queue view. Ordered by severity; each item expands to its
// evidence packet (current vs historical) with a per-item handoff draft.
// Advisory only — never claims broken/regression/root-cause/resolved.
export function TriageQueueView({ triage, packets, regressionExposureEvaluated }) {
  const [expandedId, setExpandedId] = useState(null);
  const [draftItemId, setDraftItemId] = useState(null);
  const [copiedId, setCopiedId] = useState(null);

  const buildTriageDraft = useCallback((packet) => {
    if (!packet) return "_No triage item selected._";
    const lines = [`# Triage review handoff — ${packet.id}`, ""];
    lines.push(`Drafted: ${new Date().toISOString()}`);
    lines.push("_Draft only — preview/copy/export. Nothing has been posted or assigned._");
    lines.push("");
    const c = packet.current || {};
    lines.push("## Current evidence (under triage now)", "");
    lines.push(`- What: ${c.what || "_unknown_"}`);
    lines.push(`- Severity: ${c.severity || "_unknown_"}${c.severityReason ? ` (${c.severityReason})` : ""}`);
    lines.push(`- Triage state: ${c.triageState || "_unknown_"}`);
    lines.push(`- Confidence: ${c.confidence || "_unknown_"}${c.lastSeen ? ` (last seen ${c.lastSeen})` : ""}`);
    if (c.moneyMoving) {
      lines.push(`- Money-moving: yes`);
      if (c.moneyNote) lines.push(`  - ${c.moneyNote}`);
    }
    if (c.monitoringStatus) lines.push(`- Monitoring status: ${c.monitoringStatus}`);
    lines.push(`- Evidence state: ${c.evidenceState || "_unknown_"}`);
    if (c.nextStep) lines.push(`- Recommended next step: ${c.nextStep}`);
    lines.push("");
    const h = packet.historical || {};
    lines.push("## Historical context (background only — not proof of a current defect)", "");
    if (h.note) lines.push(`_${h.note}_`, "");
    if (h.repairedDefects && h.repairedDefects.length > 0) {
      lines.push(`- Repaired defects touching related files:`);
      for (const d of h.repairedDefects) {
        lines.push(`  - ${d.shortSha}: ${d.subject}${d.pr ? ` (PR #${d.pr})` : ""}`);
      }
    }
    if (h.regressionExposures && h.regressionExposures.length > 0) {
      lines.push(`- Potential regression exposures (advisory):`);
      for (const e of h.regressionExposures) {
        lines.push(`  - ${e.priorFixShortSha}: ${e.priorFixSubject} — files: ${e.matchedFiles.join(", ")}`);
      }
      if (h.regressionNote) lines.push(`  _${h.regressionNote}_`);
    }
    lines.push("");
    return lines.join("\n");
  }, []);

  const handleCopyDraft = useCallback(async (itemId) => {
    const packet = packets && packets[itemId];
    if (!packet) return;
    try {
      await navigator.clipboard.writeText(buildTriageDraft(packet));
      setCopiedId(itemId);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      setCopiedId(null);
    }
  }, [packets, buildTriageDraft]);

  if (!triage || triage.length === 0) {
    return (
      <SectionCard title="Triage queue">
        <p className="text-sm text-slate-500">No items need triage. Findings are healthy or informational.</p>
      </SectionCard>
    );
  }

  return (
    <SectionCard title={`Triage queue — ${triage.length} item${triage.length === 1 ? "" : "s"}`}>
      <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
        Ordered by severity, then confidence and freshness. Advisory only — items recommend
        investigation, never assert root cause or resolution. Select an item for its evidence packet.
      </p>
      {regressionExposureEvaluated === false ? (
        <p className="mt-1 text-xs italic text-slate-400 dark:text-slate-500">
          Regression exposure: not evaluated (no changed-paths context at snapshot time).
        </p>
      ) : null}
      <ul className="mt-3 flex max-h-96 flex-col gap-3 overflow-auto">
        {triage.map((item) => {
          const expanded = expandedId === item.id;
          const packet = packets && packets[item.id];
          return (
            <li key={item.id} className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
              <button
                type="button"
                onClick={() => setExpandedId(expanded ? null : item.id)}
                className="flex w-full items-start justify-between gap-2 text-left"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <SeverityBadge severity={item.severity} />
                  <StateBadge state={item.triageState} />
                  {packet && packet.current && packet.current.moneyMoving ? (
                    <span className="rounded-full border border-amber-400 bg-amber-100 px-2 py-0.5 text-xs font-black text-amber-900 dark:border-amber-600 dark:bg-amber-950/40 dark:text-amber-200" title="Money-moving capability — higher review sensitivity, not a defect claim">
                      $ money
                    </span>
                  ) : null}
                </div>
                <span className="text-xs font-bold text-slate-400">{expanded ? "▾" : "▸"}</span>
              </button>
              <p className="mt-2 text-sm font-bold">{item.what}</p>
              <p className="mt-1 font-mono text-xs text-slate-400">{item.id}</p>
              {expanded && packet ? (
                <div className="mt-3 rounded-lg bg-slate-50 p-3 dark:bg-slate-800/50">
                  <p className="text-xs font-black uppercase tracking-wide text-slate-500">Current evidence</p>
                  <p className="mt-1 text-xs">{packet.current.whyItMatters || item.whyItMatters}</p>
                  <p className="mt-1 text-xs text-slate-500">Next step: {packet.current.nextStep || item.nextStep}</p>
                  {packet.current.evidenceLinks && packet.current.evidenceLinks.length > 0 ? (
                    <p className="mt-1 font-mono text-xs text-slate-400">
                      Evidence: {packet.current.evidenceLinks.map((l) => l.label).join("; ")}
                    </p>
                  ) : null}
                  {packet.historical && (
                    packet.historical.repairedDefects?.length > 0 ||
                    packet.historical.regressionExposures?.length > 0
                  ) ? (
                    <div className="mt-2 border-t border-slate-200 pt-2 dark:border-slate-700">
                      <p className="text-xs font-black uppercase tracking-wide text-slate-500">Historical context (not proof of current defect)</p>
                      {packet.historical.repairedDefects?.length > 0 ? (
                        <p className="mt-1 text-xs text-slate-500">
                          {packet.historical.repairedDefects.length} prior repair(s) touched related files.
                        </p>
                      ) : null}
                      {packet.historical.regressionExposures?.length > 0 ? (
                        <p className="mt-1 text-xs text-slate-500">
                          {packet.historical.regressionExposures.length} advisory regression exposure(s).
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={() => setDraftItemId(draftItemId === item.id ? null : item.id)}
                      className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-bold dark:border-slate-600"
                    >
                      {draftItemId === item.id ? "Hide draft" : "Preview handoff draft"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCopyDraft(item.id)}
                      className={`rounded-lg px-3 py-1 text-xs font-black ${goldControlClassName}`}
                    >
                      {copiedId === item.id ? "Copied ✓" : "Copy draft"}
                    </button>
                  </div>
                  {draftItemId === item.id ? (
                    <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-slate-950 p-3 font-mono text-xs text-slate-200 dark:bg-black">
                      {buildTriageDraft(packet)}
                    </pre>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
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

  const { health, findings, triage, packets, regressionExposureEvaluated } = data;
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

      {/* Slice 6: deterministic triage queue */}
      <TriageQueueView triage={triage} packets={packets} regressionExposureEvaluated={regressionExposureEvaluated} />

      <p className="text-xs text-slate-400">
        Snapshot generated {health.generatedAt}. Advisory only — findings recommend investigation, never assert root cause.
      </p>
    </div>
  );
}
