"use client";

import { useState } from "react";
import {
  LINK_RELATIONSHIPS, RESOLVABLE_LINK_TYPES,
  LINK_STATUS_LABELS, LINK_PROVENANCE_LABELS,
} from "@/domains/work-management/workLinks.js";

const input = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm";
const btn = "rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50";
const btnPrimary = `${btn} bg-slate-900 text-white hover:bg-slate-700`;
const btnGhost = `${btn} border border-slate-300 text-slate-700 hover:bg-slate-50`;

// Package-scoped links panel. The package end of every link is this package;
// the user picks a relationship and identifies the other record. Relationship
// types are shown in plain English; the fixed orientation from the
// vocabulary decides which end the package sits on.
export default function WorkPackageLinks({ packageId, initialLinks = [], onLinksChanged = null }) {
  const [links, setLinks] = useState(initialLinks);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [relType, setRelType] = useState("");
  const [otherId, setOtherId] = useState("");

  const rel = relType ? LINK_RELATIONSHIPS[relType] : null;
  // Which end is the package? For package-centric types the package is the
  // source or the target; the user supplies the other end.
  const packageIsSource = rel && rel.source.domain === "workmgmt" && rel.source.type === "work_package";
  const other = rel ? (packageIsSource ? rel.target : rel.source) : null;

  async function fetchLinks() {
    const response = await fetch(`/api/work-links?packageId=${encodeURIComponent(packageId)}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not load links.");
    return data.links || [];
  }

  async function load() {
    setError("");
    try {
      setLinks(await fetchLinks());
      if (onLinksChanged) onLinksChanged();
    } catch (e) {
      setError(e.message);
    }
  }

  async function onCreate(event) {
    event.preventDefault();
    if (!rel || !otherId.trim()) return;
    setBusy(true); setError("");
    try {
      const body = packageIsSource
        ? { relationship_type: relType,
            source_domain: "workmgmt", source_type: "work_package", source_id: packageId,
            target_domain: other.domain, target_type: other.type, target_id: otherId.trim() }
        : { relationship_type: relType,
            source_domain: other.domain, source_type: other.type, source_id: otherId.trim(),
            target_domain: "workmgmt", target_type: "work_package", target_id: packageId };
      const response = await fetch("/api/work-links", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) { setError(data.error || "Could not create the link."); return; }
      setRelType(""); setOtherId("");
      load();
    } finally { setBusy(false); }
  }

  async function onAction(linkId, action, body) {
    setBusy(true); setError("");
    try {
      const path = action === "unlink"
        ? `/api/work-links/${linkId}`
        : `/api/work-links/${linkId}/${action}`;
      const response = await fetch(path, {
        method: action === "unlink" ? "DELETE" : "POST",
        headers: { "content-type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await response.json();
      if (!response.ok) { setError(data.error || "Request failed."); return; }
      load();
    } finally { setBusy(false); }
  }

  function otherEnd(link) {
    const isSource = link.source_domain === "workmgmt" && link.source_type === "work_package";
    const d = isSource ? link.target_domain : link.source_domain;
    const t = isSource ? link.target_type : link.source_type;
    const id = isSource ? link.target_id : link.source_id;
    return `${d} · ${t.replace(/_/g, " ")} · ${id}`;
  }

  return (
    <section id="work-package-links" className="rounded-lg border border-slate-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-slate-900">Links</h2>
      <p className="mt-1 text-xs text-slate-500">
        Connections to schedules, drawings, documents, vendors, and equipment.
        Links reference the real records — they never copy them.
      </p>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      <form onSubmit={onCreate} className="mt-3 flex flex-col gap-2 sm:flex-row">
        <select className={`${input} sm:w-72`} value={relType} onChange={(e) => setRelType(e.target.value)} required>
          <option value="">Link type…</option>
          {RESOLVABLE_LINK_TYPES.map((key) => (
            <option key={key} value={key}>{LINK_RELATIONSHIPS[key].label}</option>
          ))}
        </select>
        {other && (
          <input className={`${input} flex-1`} placeholder={`${other.domain} ${other.type} id`}
            value={otherId} onChange={(e) => setOtherId(e.target.value)} required />
        )}
        <button type="submit" className={btnPrimary} disabled={busy || !relType}>Link</button>
      </form>

      {links.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {links.map((link) => (
            <li key={link.id} className="rounded border border-slate-100 p-3 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="font-medium text-slate-900">
                    {LINK_RELATIONSHIPS[link.relationship_type]?.label || link.relationship_type}
                  </span>
                  <span className="ml-2 text-slate-500">{otherEnd(link)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-slate-600">
                    {LINK_STATUS_LABELS[link.status] || link.status}
                  </span>
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-slate-600">
                    {LINK_PROVENANCE_LABELS[link.provenance] || link.provenance}
                  </span>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {link.provenance === "ai_proposed" && (
                  <button className={btnPrimary} disabled={busy}
                    onClick={() => onAction(link.id, "confirm", { note: "Confirmed from the package page." })}>
                    Confirm suggestion
                  </button>
                )}
                <button className={btnGhost} disabled={busy} onClick={() => onAction(link.id, "recheck")}>
                  Re-check
                </button>
                <button className={btnGhost} disabled={busy} onClick={() => onAction(link.id, "unlink")}>
                  Unlink
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-xs text-slate-500">No links yet.</p>
      )}
    </section>
  );
}
