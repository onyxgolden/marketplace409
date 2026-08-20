import { randomUUID } from "node:crypto";

const SECRET_PATTERNS = [
  /bearer\s+\S+/gi,
  /sk_(test|live)_\w+/gi,
  /pk_(test|live)_\w+/gi,
  /rk_(test|live)_\w+/gi,
  /whsec_\w+/gi,
];
const SENSITIVE_KEY_PATTERN = /authorization|header|cookie|secret|token|api[_-]?key|password|credential/i;

export function sanitizeCronText(value) {
  if (typeof value !== "string") return value;
  let sanitized = value;
  for (const pattern of SECRET_PATTERNS) sanitized = sanitized.replace(pattern, "[redacted]");
  return sanitized.slice(0, 2000);
}

export function sanitizeCronSummary(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return sanitizeCronText(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(sanitizeCronSummary);
  if (typeof value === "object") {
    const sanitized = {};
    for (const [key, entry] of Object.entries(value)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) continue;
      sanitized[key] = sanitizeCronSummary(entry);
    }
    return sanitized;
  }
  return null;
}

export function classifyCronTriggerSource(request) {
  const userAgent = request?.headers?.get?.("user-agent") || "";
  return userAgent.toLowerCase().includes("vercel-cron") ? "vercel_cron" : "unknown_authorized";
}

export function classifyCronRunStatus({ succeededCount = 0, pendingCount = 0, failedCount = 0 } = {}) {
  if (failedCount > 0) return succeededCount > 0 || pendingCount > 0 ? "partially_succeeded" : "failed";
  if (pendingCount > 0) return "partially_succeeded";
  return "succeeded";
}

export async function startCronRun(db, { jobName, routePath, request }) {
  const id = `rental_cron_run_${randomUUID()}`;
  const startedAt = new Date().toISOString();
  try {
    const triggerSource = classifyCronTriggerSource(request);
    const { error } = await db.from("rental_cron_runs").insert({
      id, job_name: jobName, route_path: routePath, trigger_source: triggerSource,
      status: "running", started_at: startedAt,
      deployment_id: process.env.VERCEL_DEPLOYMENT_ID || null,
      commit_sha: process.env.VERCEL_GIT_COMMIT_SHA || null,
    });
    if (error) throw error;
    return { id, startedAt };
  } catch (error) {
    console.error("Cron audit run could not be recorded", { jobName, routePath }, error);
    return { id: null, startedAt };
  }
}

export async function finalizeCronRun(db, run, outcome = {}) {
  if (!run?.id) return;
  try {
    const completedAt = new Date();
    const startedAtMs = new Date(run.startedAt).getTime();
    const durationMs = Number.isFinite(startedAtMs) ? Math.max(0, completedAt.getTime() - startedAtMs) : null;
    const counts = {
      processedCount: outcome.processedCount ?? null,
      succeededCount: outcome.succeededCount ?? null,
      pendingCount: outcome.pendingCount ?? null,
      failedCount: outcome.failedCount ?? 0,
    };
    const status = outcome.status || classifyCronRunStatus(counts);
    const { error } = await db.from("rental_cron_runs").update({
      status,
      completed_at: completedAt.toISOString(),
      duration_ms: durationMs,
      processed_count: counts.processedCount,
      succeeded_count: counts.succeededCount,
      pending_count: counts.pendingCount,
      failed_count: counts.failedCount,
      result_summary: sanitizeCronSummary(outcome.summary ?? null),
      error_code: outcome.errorCode ? sanitizeCronText(String(outcome.errorCode)) : null,
      error_message: outcome.errorMessage ? sanitizeCronText(String(outcome.errorMessage)) : null,
      updated_at: completedAt.toISOString(),
    }).eq("id", run.id);
    if (error) throw error;
  } catch (error) {
    console.error("Cron audit run could not be finalized", { runId: run.id }, error);
  }
}
