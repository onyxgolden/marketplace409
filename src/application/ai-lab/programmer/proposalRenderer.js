/**
 * proposalRenderer.js — pure, injection-resistant list + detail
 * renderer for programmer dry-run proposals.
 *
 * Conforms to the drop-side Workbench XSS contract
 * (forge-ai-drop tools/agent-workbench/renderers.mjs, P666-001):
 * - every interpolated value passes esc() (HTML-escaping)
 * - record IDs are gated by validRecordId: an ID that does not
 *   match withholds that row's decision controls
 * - buttons carry data-* attributes only; NO inline event handlers
 * - NO JSON-in-script, NO string interpolation into code — the one
 *   client script is a fixed literal
 * - unknown agent/kind => UNKNOWN_RENDERER refusal, never a
 *   fallback render
 *
 * Drop-side registration note: this renderer produces the HTML the
 * Workbench will serve once the drop-side follow-up registers the
 * "programmer-dry-run-proposal" kind and the decision endpoint in
 * renderers.mjs / workbench.html. That registration is NOT part of
 * this slice. Until it lands, decision controls render disabled
 * (decisionsEnabled: false is the default) with the reason shown.
 */
export class RendererError extends Error {
  constructor(code, detail = "") {
    super(detail ? `${code}:${detail}` : code);
    this.name = "RendererError";
    this.code = code;
  }
}

export const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/** Record IDs that may reach the DOM as data attributes. */
const RECORD_ID_RE = /^[A-Za-z0-9][A-Za-z0-9:_-]*$/;
export const validRecordId = (id) =>
  typeof id === "string" && id.length > 0 && id.length <= 128 && RECORD_ID_RE.test(id);

const KNOWN_KINDS = new Map([["programmer", "programmer-dry-run-proposal"]]);

function requireKnownItem(item) {
  if (!item || typeof item !== "object") throw new RendererError("UNKNOWN_RENDERER", "item must be an object");
  const kind = KNOWN_KINDS.get(item.agent);
  if (!kind || item.kind !== kind) {
    throw new RendererError("UNKNOWN_RENDERER", `no renderer for agent '${String(item.agent)}' kind '${String(item.kind)}'`);
  }
  if (typeof item.item_id !== "string" || !validRecordId(item.item_id)) {
    throw new RendererError("UNKNOWN_RENDERER", "item has no valid record id");
  }
  if (!item.proposal || typeof item.proposal !== "object") {
    throw new RendererError("UNKNOWN_RENDERER", "item carries no validated proposal");
  }
}

const NON_AUTH_BANNER =
  "Proposal only — never applied, committed, pushed, or merged by this system. Accept means approve for human consideration only.";

const STYLE = `
  :root { --bg:#0d1117; --card:#161b22; --line:#2a3240; --txt:#e6edf3; --dim:#8a94a6;
    --green:#3fb96f; --red:#e05d5d; --amber:#e0a23f; --accent:#4f9cf9; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--txt); font:15px/1.5 -apple-system,"Segoe UI",Roboto,sans-serif; }
  header { padding:14px 18px; border-bottom:1px solid var(--line); }
  main { padding:14px 18px 40px; max-width:860px; margin:0 auto; }
  .meta { color:var(--dim); font-size:12.5px; }
  .banner { background:#3a2f12; color:var(--amber); border:1px solid var(--amber); border-radius:8px; padding:8px 12px; margin:12px 0; font-weight:600; }
  .off { background:#2a1214; color:var(--red); border:1px solid var(--red); border-radius:8px; padding:8px 12px; margin:12px 0; font-weight:600; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:14px 16px; margin:12px 0; }
  .chip { display:inline-block; border-radius:20px; padding:1px 9px; font-size:12px; font-weight:700; margin:2px 4px 2px 0; border:1px solid var(--accent); color:var(--accent); }
  .warn { color:var(--amber); } .bad { color:var(--red); } .ok { color:var(--green); }
  button { background:#1d2635; color:var(--txt); border:1px solid var(--line); border-radius:8px; padding:8px 14px; font-size:14px; cursor:pointer; }
  button:disabled { opacity:.45; cursor:default; }
  table { border-collapse:collapse; width:100%; font-size:13.5px; }
  td, th { border-bottom:1px solid var(--line); padding:5px 6px; text-align:left; vertical-align:top; }
  pre { background:#10151d; padding:10px; border-radius:8px; overflow-x:auto; font-size:12.5px; white-space:pre-wrap; word-break:break-word; }
`;

/**
 * The ONE client script for programmer decision buttons. A fixed
 * literal — no interpolation, no data, nothing an item can touch.
 * Buttons declare intent in data-* attributes; the listener reads
 * them via the DOM and posts to the programmer decision endpoint
 * (registered by the drop-side follow-up; until then the buttons
 * render disabled and this script never fires).
 */
const DECIDE_SCRIPT = `
document.addEventListener("click", async function (ev) {
  var btn = ev.target && ev.target.closest ? ev.target.closest("button[data-decision]") : null;
  if (!btn || btn.disabled) return;
  var endpoint = btn.getAttribute("data-endpoint");
  var record = btn.getAttribute("data-record");
  var decision = btn.getAttribute("data-decision");
  var box = btn.closest(".controls");
  var noteEl = box ? box.querySelector("input[data-note]") : null;
  var note = noteEl ? noteEl.value.trim() : "";
  var main = document.querySelector("main[data-item-id]");
  if (!main) { alert("page context missing"); return; }
  var decisionId = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : "web-" + Date.now() + "-" + Math.random();
  var payload = { itemId: main.getAttribute("data-item-id"), proposalDigest: main.getAttribute("data-proposal-digest"),
    rowId: record, decision: decision, note: note, decisionId: decisionId };
  var res = await fetch("/workbench/api/private/programmer-decision",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  var out = {};
  try { out = await res.json(); } catch (e) { /* non-JSON error body */ }
  if (!res.ok) { alert("Could not record that call: " + (out.error || res.status)); return; }
  location.reload();
});`;

function verificationChip(state) {
  const cls = state === "PASS" ? "ok" : state === "FAIL" ? "bad" : state === "BLOCKED" ? "warn" : "";
  return `<span class="chip ${cls}">Verification: ${esc(state)}</span>`;
}

function humanChip(state) {
  const cls = state === "ACCEPTED_FOR_CONSIDERATION" ? "ok" : state === "REJECTED" ? "bad" : "";
  return `<span class="chip ${cls}">Human decision: ${esc(state)}</span>`;
}

function page(title, mainAttrs, bodyHtml, includeScript) {
  return `<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<meta name="robots" content="noindex">\n<title>${esc(title)}</title><style>${STYLE}</style></head>\n<body><header><b>${esc(title)}</b></header>\n<main ${mainAttrs}>\n${bodyHtml}\n</main>${includeScript ? `<script>${DECIDE_SCRIPT}</script>` : ""}</body></html>`;
}

/** One list row for a private item: both columns always distinct. */
export function renderListItem(item, { humanState = "PENDING", mode = "DISABLED" } = {}) {
  requireKnownItem(item);
  const verification = item.verification?.verification_state ?? "NOT_RUN";
  const p = item.proposal;
  const offNote = mode === "DISABLED" ? `<div class="off">Feature OFF — synthetic preview only. No dry run is executing.</div>` : "";
  return `<article class="card" data-item-id="${esc(item.item_id)}">
  <h4>${esc(item.title)}</h4>
  <div>${verificationChip(verification)}${humanChip(humanState)}</div>
  <p class="meta">job ${esc(p.job_id)} · base ${esc(p.source.base_sha)} · patch ${esc(p.plan.patch_sha256.slice(0, 16))}…</p>
  <div class="banner">${esc(NON_AUTH_BANNER)}</div>
  ${offNote}
</article>`;
}

/** A list page over private items (all must be programmer items). */
export function renderListPage(items, { mode = "DISABLED" } = {}) {
  const rows = items.map((item) => renderListItem(item, { mode })).join("\n");
  const offNote =
    mode === "DISABLED"
      ? `<div class="off">Feature OFF — the programmer dry-run slice ships DISABLED. Synthetic preview only.</div>`
      : "";
  return page(
    "Programmer dry-run proposals",
    "",
    `${offNote}\n<div class="banner">${esc(NON_AUTH_BANNER)}</div>\n${rows || "<p>No proposals.</p>"}`,
    false,
  );
}

function decisionControls(item, { decisionsEnabled }) {
  const rowId = "proposal";
  if (!validRecordId(rowId) || !validRecordId(item.item_id)) {
    return `<p class="meta">Decision controls withheld: invalid record id.</p>`;
  }
  if (!decisionsEnabled) {
    return `<div class="controls"><p class="meta">Decision controls are disabled: the programmer decision endpoint is registered by the drop-side follow-up, not by this slice. No decision can be recorded from this preview.</p>
    <div class="btnrow"><button type="button" disabled data-decision="accept" data-endpoint="programmer-private" data-record="${esc(rowId)}">Accept for consideration</button>
    <button type="button" disabled data-decision="reject" data-endpoint="programmer-private" data-record="${esc(rowId)}">Reject</button>
    <button type="button" disabled data-decision="send-back" data-endpoint="programmer-private" data-record="${esc(rowId)}">Send back</button></div></div>`;
  }
  return `<div class="controls"><input type="text" data-note maxlength="500" placeholder="Note (optional, max 500 chars)">
  <div class="btnrow"><button type="button" data-decision="accept" data-endpoint="programmer-private" data-record="${esc(rowId)}">Accept for consideration</button>
  <button type="button" data-decision="reject" data-endpoint="programmer-private" data-record="${esc(rowId)}">Reject</button>
  <button type="button" data-decision="send-back" data-endpoint="programmer-private" data-record="${esc(rowId)}">Send back</button></div>
  <p class="meta">Accept approves this proposal for human consideration only. It never applies the patch, creates a branch, launches a PR, or activates anything.</p></div>`;
}

function decisionHistoryHtml(decisions) {
  const list = Array.isArray(decisions) ? decisions : [];
  if (list.length === 0) return `<p class="meta">No decisions recorded yet.</p>`;
  const rows = list
    .map(
      (d) =>
        `<tr><td>${esc(d.human_state ?? d.decision)}</td><td>${esc(d.actor)}</td><td>${esc(d.at)}</td><td>${esc(d.note ?? "")}</td></tr>`,
    )
    .join("\n");
  return `<table><thead><tr><th>Decision</th><th>Actor</th><th>At</th><th>Note</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function suiteEvidenceHtml(proposal) {
  const receipt = proposal.verification?.receipt;
  if (!receipt) return `<p class="meta">No P3 verification receipt attached (NOT_RUN).</p>`;
  const rows = (receipt.suites ?? [])
    .map(
      (s) =>
        `<tr><td>${esc(s.id)}</td><td>${esc(s.status)}</td><td>${esc(s.reason_code ?? "")}</td><td>${esc(String(s.test_counts?.passed ?? 0))}/${esc(String(s.test_counts?.total ?? 0))} passed</td></tr>`,
    )
    .join("\n");
  return `<p class="meta">P3 runner ${esc(receipt.agent)} · verdict ${esc(receipt.verdict)} · head pin ${esc(receipt.head_pin ?? "")} · isolation ${esc(receipt.isolation?.mechanism ?? "none")}</p>
  <table><thead><tr><th>Suite</th><th>Status</th><th>Reason</th><th>Tests</th></tr></thead><tbody>${rows}</tbody></table>`;
}

/**
 * Full detail page for one private item. `decisions` is the
 * append-only history for this item (may be empty). `mode` is the
 * host mode; DISABLED renders the explicit OFF state.
 */
export function renderDetail(item, { decisions = [], humanState = "PENDING", mode = "DISABLED", decisionsEnabled = false } = {}) {
  requireKnownItem(item);
  const p = item.proposal;
  const verification = item.verification?.verification_state ?? "NOT_RUN";
  const offNote =
    mode === "DISABLED"
      ? `<div class="off">Feature OFF — the programmer dry-run slice ships DISABLED. This page is a synthetic preview; no dry run is executing and no decision endpoint is live.</div>`
      : `<div class="banner">Synthetic preview mode. No real branch, no worktree, no test execution.</div>`;
  const risks = (p.risks ?? []).map((r) => `<li>${esc(r)}</li>`).join("\n");
  const files = p.plan.files
    .map((f) => `<tr><td>${esc(f.path)}</td><td>${esc(f.operation)}</td><td>+${esc(String(f.added_lines))} / -${esc(String(f.removed_lines))}</td></tr>`)
    .join("\n");
  const body = `
  <div class="banner">${esc(NON_AUTH_BANNER)}</div>
  ${offNote}
  <div>${verificationChip(verification)}${humanChip(humanState)}</div>
  <p class="meta">job ${esc(p.job_id)} · status ${esc(p.status)} · created ${esc(p.created_at)} · expires ${esc(p.expires_at)}</p>
  <section class="card"><h4>Source pin</h4>
    <p class="meta">repo ${esc(p.source.repo)} · branch (display) ${esc(p.source.branch_display_name)}</p>
    <p>base SHA<br><code>${esc(p.source.base_sha)}</code></p>
    <p>observed head<br><code>${esc(p.source.observed_head)}</code></p>
    <p>patch SHA-256<br><code>${esc(p.plan.patch_sha256)}</code></p>
    <p>candidate tree digest<br><code>${esc(p.plan.candidate_tree_digest)}</code></p>
  </section>
  <section class="card"><h4>Planned change (${esc(String(p.plan.files.length))} file(s), budget ≤3 files / ≤200 lines / ≤64 KiB)</h4>
    <table><thead><tr><th>Path</th><th>Operation</th><th>Lines</th></tr></thead><tbody>${files}</tbody></table>
    <details><summary>Unified diff (bounded, advisory only)</summary><pre>${esc(p.plan.diff)}</pre></details>
  </section>
  <section class="card"><h4>Verification evidence</h4>
    <p class="meta">mapping ${esc(item.pinned?.receipt_mapping_version ?? "")} · reasons: ${esc((item.verification?.reason_codes ?? []).join(", "))}</p>
    ${suiteEvidenceHtml(p)}
  </section>
  <section class="card"><h4>Risks &amp; uncertainty</h4><ul>${risks || "<li>None recorded.</li>"}</ul>
    <p>${esc(p.rollback_notes)}</p>
  </section>
  <section class="card"><h4>Decision history</h4>${decisionHistoryHtml(decisions)}</section>
  ${decisionControls(item, { decisionsEnabled })}
  `;
  return page(
    item.title,
    `data-item-id="${esc(item.item_id)}" data-proposal-digest="${esc(item.proposal_digest)}"`,
    body,
    decisionsEnabled,
  );
}
