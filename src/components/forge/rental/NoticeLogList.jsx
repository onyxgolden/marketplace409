"use client";
import { useCallback, useEffect, useState } from "react";

// Rentec parity R15 — the generated-notice log. Lists rendered notice
// snapshots logged against tenant records (optionally filtered to one
// tenant). Each row expands to the full rendered text; the print button on
// the expanded row prints just that notice.

export default function NoticeLogList({ tenantId = null, tenantName = null, compact = false }) {
  const [notices, setNotices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expandedId, setExpandedId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const url = tenantId ? `/api/rental/notices?tenantId=${encodeURIComponent(tenantId)}` : "/api/rental/notices";
      const response = await fetch(url);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to load generated notices.");
      setNotices(body.notices || []);
    } catch (reason) { setError(reason.message); }
    finally { setLoading(false); }
  }, [tenantId]);
  useEffect(() => { load(); }, [load]);

  function printNotice(notice) {
    const win = window.open("", "_blank", "width=800,height=900");
    if (!win) return;
    const safe = (value) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    win.document.write(`<!doctype html><html><head><title>${safe(notice.formName)}</title><style>body{font-family:Georgia,serif;max-width:640px;margin:40px auto;padding:0 24px;line-height:1.7}h1{font-size:20px;margin-bottom:24px}p{margin:0 0 1em}.meta{color:#555;font-size:13px;border-bottom:1px solid #ccc;padding-bottom:12px;margin-bottom:24px}@media print{.noprint{display:none}}</style></head><body><div class="noprint" style="margin-bottom:16px"><button onclick="window.print()">Print</button></div><div class="meta">${safe(notice.formName)}${tenantName ? ` — ${safe(tenantName)}` : ""} · Generated ${notice.createdAt ? new Date(notice.createdAt).toLocaleString() : ""}</div>${safe(notice.renderedBody).split(/\r?\n/).map((line) => `<p>${line || "&nbsp;"}</p>`).join("")}</body></html>`);
    win.document.close();
    win.focus();
  }

  if (loading) return <p className="mt-2 text-sm font-bold text-slate-500 dark:text-slate-400">Loading notice log…</p>;
  if (error) return <p role="alert" className="mt-2 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-800 dark:bg-red-950/40 dark:text-red-300">{error}</p>;
  if (notices.length === 0) {
    return <p className="mt-2 rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">No notices generated yet{tenantName ? ` for ${tenantName}` : ""}.</p>;
  }

  return (
    <ul className={compact ? "mt-2 space-y-2" : "mt-4 space-y-2"}>
      {notices.map((notice) => {
        const expanded = expandedId === notice.id;
        return (
          <li key={notice.id} className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-black text-slate-950 dark:text-white">{notice.formName}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {notice.createdAt ? new Date(notice.createdAt).toLocaleString() : "—"}
                  {notice.tenantId && !tenantId ? ` · Tenant ${notice.tenantId.slice(0, 8)}…` : ""}
                </p>
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => setExpandedId(expanded ? null : notice.id)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-black text-slate-700 dark:border-slate-600 dark:text-slate-300">{expanded ? "Hide" : "View"}</button>
                <button type="button" onClick={() => printNotice(notice)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-black text-slate-700 dark:border-slate-600 dark:text-slate-300">Print</button>
              </div>
            </div>
            {expanded && (
              <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-4 font-serif text-sm leading-relaxed text-slate-900 dark:bg-slate-950 dark:text-slate-100">{notice.renderedBody}</pre>
            )}
          </li>
        );
      })}
    </ul>
  );
}
