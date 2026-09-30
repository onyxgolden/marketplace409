/**
 * collectEvidence.mjs — gather root-cause evidence for runtime signals.
 *
 * Detection tells us *something failed*; evidence tells us *why*. For CI
 * failures this pulls the failed job's log and extracts the failing step,
 * the ##[error] lines, and the file paths the log mentions — the same facts
 * a human would read before writing a fix. For delivery signals the evidence
 * is the row's own failure record. Pure parsing functions are exported for
 * unit tests; network access lives in fetchFailedJobLog and the CLI.
 *
 * No model calls, no writes, no side effects beyond reading the GitHub API.
 */

const ANSI_ESCAPE_RE = /\x1b\[[0-9;]*m/g;
// Leading "2026-09-28T04:19:01.9159183Z " timestamps on every log line.
const TIMESTAMP_PREFIX_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\s+/;
const GROUP_MARKER = "##[group]";
const ERROR_MARKER = "##[error]";

// Conservative path-like tokens: must contain at least one slash and look
// like a file reference (extension or glob). Avoids matching prose.
const UNIX_PATH_RE = /\b[\w.+*{}$-]+(?:\/[\w.+*{}$-]+)+\.\w[\w+]*/g;
const WINDOWS_PATH_RE = /\b[A-Za-z]:\\(?:[^\s\\]+\\)+[^\s\\]+/g;

export const MAX_ERROR_LINES = 10;
export const MAX_MENTIONED_PATHS = 20;
export const MAX_CONTEXT_LINES = 3;

/** Strip ANSI escapes and the per-line timestamp prefix. */
export function cleanLogLine(line) {
  return String(line).replace(ANSI_ESCAPE_RE, "").replace(TIMESTAMP_PREFIX_RE, "").trim();
}

/**
 * Extract ##[error] lines from a GitHub Actions job log, attributing each
 * to the ##[group] step that contains it, with a few context lines around it.
 * Returns [{ step, line, context }]. Pure.
 */
export function extractErrorLines(logText, { contextLines = MAX_CONTEXT_LINES, maxErrors = MAX_ERROR_LINES } = {}) {
  const rawLines = String(logText).split("\n");
  const lines = rawLines.map(cleanLogLine);
  const results = [];
  let currentStep = null;
  for (let i = 0; i < lines.length && results.length < maxErrors; i += 1) {
    const line = lines[i];
    if (line.startsWith(GROUP_MARKER)) {
      // "##[group]Run actions/upload-artifact@v4" -> "actions/upload-artifact@v4",
      // but keep a human step label when present: "##[group]Run Upload installer".
      const label = line.slice(GROUP_MARKER.length).trim().replace(/^Run\s+/, "");
      currentStep = label || null;
      continue;
    }
    if (!line.includes(ERROR_MARKER)) continue;
    const errorLine = line.slice(line.indexOf(ERROR_MARKER) + ERROR_MARKER.length).trim();
    const context = [];
    for (let j = Math.max(0, i - contextLines); j < Math.min(lines.length, i + contextLines + 1); j += 1) {
      if (j === i || lines[j]) context.push(lines[j]);
    }
    results.push({ step: currentStep, line: errorLine, context });
  }
  return results;
}

/**
 * Pull file-path-like tokens out of text. Returns a de-duplicated list,
 * unix-style and Windows-style, in order of first appearance. Pure.
 */
export function extractMentionedPaths(text, { maxPaths = MAX_MENTIONED_PATHS } = {}) {
  const seen = new Set();
  const out = [];
  const cleaned = String(text);
  for (const re of [UNIX_PATH_RE, WINDOWS_PATH_RE]) {
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(cleaned)) !== null && out.length < maxPaths) {
      const token = match[0].replace(/[),;:'"]+$/, "");
      if (!seen.has(token)) {
        seen.add(token);
        out.push(token);
      }
      if (match[0].length === 0) re.lastIndex += 1;
    }
  }
  return out;
}

/** Extract the numeric run id from a https://github.com/.../actions/runs/<id> URL. Pure. */
export function runIdFromUrl(url) {
  const match = String(url || "").match(/\/actions\/runs\/(\d+)/);
  return match ? match[1] : null;
}

/**
 * Summarize a CI job log into evidence: failing step, error lines, and the
 * paths the log mentions. Pure — pass the log text you fetched.
 */
export function summarizeCiEvidence(logText) {
  const errors = extractErrorLines(logText);
  const blob = errors.map((e) => `${e.line}\n${e.context.join("\n")}`).join("\n");
  return {
    failed_step: errors.length > 0 ? errors[0].step : null,
    error_lines: errors.map((e) => e.line),
    mentioned_paths: extractMentionedPaths(blob),
  };
}

/** Light-touch evidence for delivery signals: the row's own failure record. Pure. */
export function buildDeliveryEvidence(signal) {
  const evidence = (signal && signal.evidence) || {};
  return {
    status: evidence.status || signal.status || null,
    failure_reason: evidence.failure_reason || evidence.failure_message || null,
    row_id: evidence.row_id || null,
  };
}

function authHeaders(token) {
  return {
    Accept: "application/vnd.github+json",
    "User-Agent": "engineering-brain-evidence",
    Authorization: `Bearer ${token}`,
  };
}

/**
 * Fetch the failed job's log for a workflow run. Follows the API's redirect
 * to the pre-signed log URL (the pre-signed URL carries its own auth; the
 * bearer token is only sent to api.github.com). Throws on any failure —
 * callers must treat that as a collection failure, never an all-clear.
 */
export async function fetchFailedJobLog({ owner, repo, runId, token, apiBase = "https://api.github.com" }) {
  if (!token) throw new Error("GITHUB_TOKEN is required to fetch CI failure evidence");
  const headers = authHeaders(token);
  const jobsRes = await fetch(`${apiBase}/repos/${owner}/${repo}/actions/runs/${runId}/jobs?per_page=100`, { headers });
  if (!jobsRes.ok) throw new Error(`GitHub jobs API failed for run ${runId}: HTTP ${jobsRes.status}`);
  const jobs = ((await jobsRes.json()).jobs) || [];
  const failed = jobs.find((j) => j.conclusion === "failure") || null;
  if (!failed) throw new Error(`no failed job found for run ${runId}`);
  const logRes = await fetch(`${apiBase}/repos/${owner}/${repo}/actions/jobs/${failed.id}/logs`, {
    headers,
    redirect: "follow",
  });
  if (!logRes.ok) throw new Error(`GitHub log download failed for job ${failed.id}: HTTP ${logRes.status}`);
  return { jobName: failed.name, logText: await logRes.text() };
}

/**
 * Build the evidence record for one signal. ci_failed signals need a fetched
 * log ({ jobName, logText }); delivery signals need nothing beyond the signal.
 * Pure.
 */
export function buildSignalEvidence(signal, ciLog) {
  const base = {
    signal_id: signal.signal_id,
    kind: signal.kind || "unknown",
    collected_at: new Date().toISOString(),
  };
  if (signal.kind === "ci_failed") {
    if (!ciLog) throw new Error(`no CI log provided for signal ${signal.signal_id}`);
    return { ...base, failed_job: ciLog.jobName, ...summarizeCiEvidence(ciLog.logText) };
  }
  return { ...base, ...buildDeliveryEvidence(signal) };
}
