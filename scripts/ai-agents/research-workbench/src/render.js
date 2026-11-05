/**
 * render.js — pure HTML rendering for the P1-C Research Workbench UI.
 *
 * Pure functions of view data → HTML strings. No store, no transport,
 * no network, no clock: the host assembles the view model and these
 * functions render it. Every interpolated value passes through esc(),
 * the same escaping the drop's closed renderer registry uses
 * (tools/agent-workbench/renderers.mjs), so a hostile title, claim,
 * excerpt, or decision note can never break out of the page.
 *
 * Deliberate absences (asserted in tests): there is no control that
 * could turn a job on, arm a recurrence, or start live work. The
 * only actions are "run a synthetic preview" (manual, explicit
 * invocation) and "accept / reject one preview item for human
 * consideration". ACCEPT never means approval to write production
 * data, contact anyone, spend, or run anything — the page says so
 * next to every decision control.
 */

export const esc = (s) => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** IDs that may appear in URLs, form values, and data attributes. */
const JOB_ID_RE = /^research-[a-z0-9][a-z0-9-]*@[0-9]+$/;
const HEX64_RE = /^[0-9a-f]{64}$/;
const RUN_ID_RE = /^run-[0-9a-f]{32}$/;

export function isJobId(value) {
  return typeof value === "string" && JOB_ID_RE.test(value);
}

function isSafeId(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 128
    && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
}

const STYLE = `
  body { margin:0; background:#0d1117; color:#e6edf3; font:15px/1.5 -apple-system,"Segoe UI",Roboto,sans-serif; }
  header { padding:14px 18px; border-bottom:1px solid #2a3240; }
  header b { font-size:17px; } header .dim { color:#8a94a6; font-size:13px; }
  main { padding:14px 18px 40px; max-width:860px; margin:0 auto; }
  .banner { background:#3a2f12; border:1px solid #e0a23f; color:#e0a23f; border-radius:8px; padding:10px 14px; margin:12px 0; font-weight:700; }
  .banner.green { background:#12281c; border-color:#3fb96f; color:#3fb96f; }
  .banner.blue { background:#12203a; border-color:#4f9cf9; color:#4f9cf9; }
  .card { background:#161b22; border:1px solid #2a3240; border-radius:10px; padding:14px 16px; margin:12px 0; }
  .card h3 { margin:0 0 4px; font-size:16px; } .card h4 { margin:0 0 6px; font-size:15.5px; }
  .meta { color:#8a94a6; font-size:12.5px; } .dim { color:#8a94a6; }
  .chip { display:inline-block; border-radius:20px; padding:1px 9px; font-size:12px; font-weight:700; margin:2px 4px 2px 0; border:1px solid; }
  .chip.disabled { color:#e0a23f; border-color:#e0a23f; } .chip.synthetic { color:#4f9cf9; border-color:#4f9cf9; }
  .chip.fact { color:#3fb96f; border-color:#3fb96f; } .chip.inference { color:#e0a23f; border-color:#e0a23f; }
  .chip.proposal { color:#c792ea; border-color:#c792ea; } .chip.pending { color:#8a94a6; border-color:#8a94a6; }
  .chip.accepted { color:#3fb96f; border-color:#3fb96f; } .chip.rejected { color:#e05d5d; border-color:#e05d5d; }
  .chip.closed { color:#3fb96f; border-color:#3fb96f; }
  blockquote { margin:4px 0 4px 12px; padding:6px 10px; border-left:3px solid #2a3240; color:#c9d4e3; background:#10151d; font-size:13.5px; }
  code { font-size:12.5px; word-break:break-all; }
  button { background:#1d2635; color:#e6edf3; border:1px solid #2a3240; border-radius:8px; padding:8px 14px; font-size:14px; cursor:pointer; }
  button:hover { border-color:#4f9cf9; } button.accept { border-color:#3fb96f; } button.reject { border-color:#e05d5d; }
  button:disabled { opacity:.45; cursor:default; }
  input[type=text], select { width:100%; background:#0d1117; color:#e6edf3; border:1px solid #2a3240; border-radius:8px; padding:8px 10px; font-size:14px; margin-bottom:8px; }
  .btnrow { display:flex; gap:8px; flex-wrap:wrap; }
  .receipt { font-size:13px; color:#4f9cf9; margin-top:8px; }
  a { color:#4f9cf9; text-decoration:none; }
  .empty { color:#8a94a6; padding:30px 0; text-align:center; }
`;

function layout({ title, body }) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">`
    + `<meta name="viewport" content="width=device-width, initial-scale=1">`
    + `<title>${esc(title)} — Research Workbench</title><style>${STYLE}</style></head><body>`
    + `<header><b>FORGE — Research Workbench</b> <span class="dim">P1-C · synthetic preview only</span></header><main>${body}</main></body></html>`;
}

function disabledBanner() {
  return `<div class="banner">DISABLED job — SYNTHETIC PREVIEW only. No live research runs, no recurrence is registered, and no decision here starts any work.</div>`;
}

function kindChip(kind) {
  const safe = ["fact", "inference", "proposal"].includes(kind) ? kind : "fact";
  return `<span class="chip ${esc(safe)}">${esc(safe)}</span>`;
}

function decisionChip(revision) {
  if (!revision) return `<span class="chip pending">PENDING</span>`;
  const label = revision.decision === "accept" ? "ACCEPTED for human consideration" : "REJECTED";
  const cls = revision.decision === "accept" ? "accepted" : "rejected";
  return `<span class="chip ${cls}">${esc(label)}</span>`;
}

/**
 * Job list. `jobs` are validated JobDefinitionV1 objects;
 * `runsByJob` maps job_id → { item, closed, decidedCount, pendingCount } | null.
 */
export function renderJobList({ jobs, runsByJob, basePath }) {
  const base = esc(basePath);
  let body = `<h2>Research jobs</h2>${disabledBanner()}`;
  if (!Array.isArray(jobs) || jobs.length === 0) {
    body += `<p class="empty">No disabled research jobs registered. Add a job-definition JSON file to the host jobs directory.</p>`;
    return layout({ title: "Research jobs", body });
  }
  for (const job of jobs) {
    if (!isJobId(job.job_id)) continue;
    const run = runsByJob?.get?.(job.job_id) ?? null;
    const runLine = run === null
      ? `<span class="meta">No preview yet — run a synthetic preview from the job page.</span>`
      : run.closed
        ? `<span class="chip closed">REVIEW COMPLETE — all ${esc(String(run.decidedCount))} items decided</span>`
        : `<span class="meta">Latest run ${esc(run.item.item_id)}: ${esc(String(run.decidedCount))} decided, ${esc(String(run.pendingCount))} pending.</span>`;
    body += `<div class="card"><h3><a href="${base}/jobs/${esc(job.job_id)}">${esc(job.title)}</a></h3>`
      + `<div><span class="chip disabled">DISABLED</span><span class="chip synthetic">SYNTHETIC ONLY</span></div>`
      + `<p class="meta">${esc(job.job_id)} · version ${esc(String(job.version))} · ${esc(job.question)}</p>`
      + `<p>${runLine}</p></div>`;
  }
  return layout({ title: "Research jobs", body });
}

function budgetLine(receipt) {
  const b = receipt?.budget ?? {};
  return `Budget used: ${esc(String(b.items_used ?? "?"))}/${esc(String(b.max_items_per_run ?? "?"))} items · `
    + `${esc(String(b.bytes_used ?? "?"))}/${esc(String(b.max_bytes_per_run ?? "?"))} bytes · `
    + `${esc(String(b.tool_calls_used ?? "?"))}/${esc(String(b.max_tool_calls_per_run ?? "?"))} tool calls.`;
}

function itemCard({ item, revision, jobId, basePath, reportDigest, itemId }) {
  const base = esc(basePath);
  let html = `<div class="card"><h4>${esc(item.claim)}</h4>`
    + `<div>${kindChip(item.kind)}${decisionChip(revision)}</div>`
    + `<p><span class="dim">Evidence (citation byte identity):</span></p>`
    + `<blockquote>${esc(item.evidence_excerpt)}</blockquote>`
    + `<p class="meta">evidence sha256: <code>${esc(item.evidence_sha256)}</code></p>`;
  if (item.uncertainty) html += `<p><span class="dim">Uncertainty:</span> ${esc(item.uncertainty)}</p>`;
  if (item.limitations) html += `<p><span class="dim">Limitations:</span> ${esc(item.limitations)}</p>`;
  if (item.recommendation) html += `<p><span class="dim">Recommendation:</span> ${esc(item.recommendation)}</p>`;
  if (item.proposed_action) html += `<p><span class="dim">Proposed action:</span> ${esc(item.proposed_action)}</p>`;
  if (revision) {
    html += `<p class="receipt">Recorded: revision ${esc(String(revision.revision))} · ${esc(revision.decision)} · `
      + `by ${esc(revision.actor)} · ${esc(revision.at)}${revision.note ? ` · note: ${esc(revision.note)}` : ""}</p>`;
  } else {
    html += `<form method="post" action="${base}/jobs/${esc(jobId)}/decide">`
      + `<input type="hidden" name="itemId" value="${esc(itemId)}">`
      + `<input type="hidden" name="reportDigest" value="${esc(reportDigest)}">`
      + `<input type="hidden" name="rowId" value="${esc(item.item_key)}">`
      + `<input type="text" name="note" maxlength="500" placeholder="Note (optional)">`
      + `<div class="btnrow">`
      + `<button class="accept" type="submit" name="decision" value="accept">Accept for human consideration</button>`
      + `<button class="reject" type="submit" name="decision" value="reject">Reject</button>`
      + `</div></form>`
      + `<p class="meta">Accept means accepted for human consideration only — never approval to write production data, contact anyone, spend, or run anything.</p>`;
  }
  return `${html}</div>`;
}

/**
 * Job detail / run card. `run` is the stored private item (or null when
 * no preview has run); `decisions` is the store decision record (or
 * null); `closed` is the transport closedLoop result (or null).
 * `invocationId` is a fresh explicit invocation id for the preview
 * form; re-posting the same form replays idempotently.
 */
export function renderJobDetail({ job, run, decisions, closed, invocationId, receiptNote, basePath }) {
  const base = esc(basePath);
  let body = `<p><a href="${base}/">← All research jobs</a></p><h2>${esc(job.title)}</h2>`
    + `<div><span class="chip disabled">DISABLED</span><span class="chip synthetic">SYNTHETIC ONLY</span></div>`
    + `<p class="meta">${esc(job.job_id)} · version ${esc(String(job.version))}</p>`
    + `<p>${esc(job.question)}</p>${disabledBanner()}`;
  if (receiptNote) body += `<div class="banner blue">${esc(receiptNote)}</div>`;
  if (run === null) {
    body += `<p>No synthetic preview has run for this job yet. A preview is manual, explicit, and synthetic-only.</p>`;
  } else {
    const receipt = run.report?.receipt ?? {};
    const items = run.report?.items ?? [];
    const revisionsByRow = new Map((decisions?.revisions ?? []).map((r) => [r.row_id, r]));
    if (closed?.closed) {
      body += `<div class="banner green">REVIEW COMPLETE — all ${esc(String(items.length))} items decided. `
        + `This is review completion only: no action executes from these decisions.</div>`;
    }
    body += `<div class="card"><h3>Run ${esc(run.item_id)}</h3>`
      + `<p class="meta">job ${esc(run.created_from?.job_id ?? job.job_id)} · version ${esc(String(run.created_from?.job_version ?? job.version))} `
      + `· invocation ${esc(run.created_from?.invocation_id ?? "")} · published ${esc(run.published_at)} · actor ${esc(run.created_from?.actor ?? "")}</p>`
      + `<p class="meta">report digest: <code>${esc(run.report_digest)}</code></p>`
      + `<p class="meta">${esc(budgetLine(receipt))}</p>`;
    if (receipt.empty_claim) body += `<p>${esc(receipt.empty_claim)}</p>`;
    if (run.next_due) body += `<p class="meta">Next due (stored recurrence rule, preview math only — never registered): ${esc(run.next_due)}</p>`;
    body += `</div>`;
    for (const item of items) {
      body += itemCard({
        item,
        revision: revisionsByRow.get(item.item_key) ?? null,
        jobId: job.job_id,
        basePath,
        reportDigest: run.report_digest,
        itemId: run.item_id,
      });
    }
  }
  body += `<div class="card"><h3>Run a synthetic preview</h3>`
    + `<form method="post" action="${base}/jobs/${esc(job.job_id)}/preview">`
    + `<input type="hidden" name="invocation_id" value="${esc(invocationId)}">`
    + `<label class="dim" for="corpus">Synthetic corpus (must be in the job's allowed list)</label>`
    + `<select id="corpus" name="corpus_id">${(job.allowed_source_corpus_ids ?? []).map((id) => `<option value="${esc(id)}">${esc(id)}</option>`).join("")}</select>`
    + `<div class="btnrow"><button type="submit">Run synthetic preview</button></div></form>`
    + `<p class="meta">Manual only. Re-posting this same form replays the same preview idempotently — it cannot double-create decision items. A new preview needs a new invocation, rendered fresh on this page.</p></div>`;
  return layout({ title: job.title, body });
}

export function renderErrorPage({ status, code, detail }) {
  const safeCode = typeof code === "string" && /^[A-Z_]+$/.test(code) ? code : "INTERNAL";
  const body = `<h2>Workbench refused the request (${esc(String(status))})</h2>`
    + `<p><code>${esc(safeCode)}</code></p>`
    + (detail ? `<p>${esc(detail)}</p>` : "")
    + `<p><a href="/research/">← Back to research jobs</a></p>`;
  return layout({ title: "Request refused", body });
}

/** Exposed for tests: the exact ids the UI will accept in a URL. */
export function isRunId(value) {
  return typeof value === "string" && RUN_ID_RE.test(value);
}

export function isHex64(value) {
  return typeof value === "string" && HEX64_RE.test(value);
}

export function isSafeFormId(value) {
  return isSafeId(value);
}
