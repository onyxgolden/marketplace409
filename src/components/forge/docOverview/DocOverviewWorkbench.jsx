// FORGE Doc-to-Overview — slice B: curator review workbench.
//
// Client component: generate drafts on a saved manifest, list the
// owner's drafts, preview the selected draft (server-rendered,
// watermarked HTML), and run the explicit review actions — edit,
// submit, approve, revise, keep, discard, export.
//
// The preview HTML is rendered server-side by preview.js, which escapes
// every piece of source-derived text before placing it in the document.
// It is inserted here with dangerouslySetInnerHTML because it is
// markup by construction; no string from a source document, a request,
// or user input is ever concatenated into it client-side. The only
// client-supplied values sent to the API are the manifest id, the
// source texts, and the curator's edit JSON — all validated and
// hash-checked server-side.

"use client";

import { useState } from "react";

const STATUS_STYLES = {
  draft: "bg-slate-100 text-slate-700",
  needs_review: "bg-amber-100 text-amber-800",
  approved: "bg-blue-100 text-blue-800",
  kept: "bg-teal-100 text-teal-800",
  discarded: "bg-slate-200 text-slate-500",
};

async function callJson(url, init) {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error ?? `Request failed (${res.status}).`);
  }
  return body;
}

function editableSections(content) {
  if (!content) return {};
  if (content.kind === "infographic") {
    return { kind: "infographic", title: content.title, findings: content.findings ?? [] };
  }
  return {
    kind: "explainer",
    title: content.title,
    summary: content.summary ?? [],
    keyConcepts: content.keyConcepts ?? [],
    context: content.context ?? [],
    glossary: content.glossary ?? [],
  };
}

export default function DocOverviewWorkbench({ initialArtifacts = [] }) {
  const [artifacts, setArtifacts] = useState(initialArtifacts);
  const [selectedId, setSelectedId] = useState(null);
  const [preview, setPreview] = useState(null);
  const [manifestId, setManifestId] = useState("");
  const [documentsJson, setDocumentsJson] = useState("");
  const [editJson, setEditJson] = useState("");
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);

  const selected = artifacts.find((a) => a.id === selectedId) ?? null;

  async function refresh() {
    const body = await callJson("/api/doc-overview/artifacts");
    setArtifacts(body.artifacts ?? []);
    return body.artifacts ?? [];
  }

  async function selectArtifact(artifactId) {
    setSelectedId(artifactId);
    setEditing(false);
    setMessage(null);
    try {
      const body = await callJson(`/api/doc-overview/artifacts/${artifactId}`);
      setPreview(body);
      setEditJson(JSON.stringify(editableSections(body.artifact?.content), null, 2));
    } catch (error) {
      setMessage({ kind: "error", text: error.message });
    }
  }

  async function generate() {
    setMessage(null);
    let documents;
    try {
      documents = JSON.parse(documentsJson);
    } catch {
      setMessage({ kind: "error", text: "Documents must be valid JSON: { documentId: { text, pages? } }." });
      return;
    }
    setBusy(true);
    try {
      const body = await callJson("/api/doc-overview/artifacts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ manifestId: manifestId.trim(), documents }),
      });
      setMessage({ kind: "ok", text: `Generated ${body.artifacts.length} draft(s). Review each before approving.` });
      const list = await refresh();
      const first = body.artifacts[0];
      if (first) await selectArtifact(first.id);
      void list;
    } catch (error) {
      setMessage({ kind: "error", text: error.message });
    } finally {
      setBusy(false);
    }
  }

  async function reviewAction(action, editedContent) {
    if (!selected) return;
    setBusy(true);
    setMessage(null);
    try {
      const body = await callJson(`/api/doc-overview/artifacts/${selected.id}/review`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, editedContent }),
      });
      setMessage({ kind: "ok", text: `Done — draft is now ${body.artifact.status}.` });
      setEditing(false);
      await refresh();
      await selectArtifact(selected.id);
    } catch (error) {
      setMessage({ kind: "error", text: error.message });
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit() {
    let editedContent;
    try {
      editedContent = JSON.parse(editJson);
    } catch {
      setMessage({ kind: "error", text: "Edit must be valid JSON." });
      return;
    }
    await reviewAction("edit", editedContent);
  }

  return (
    <div data-doc-overview-workbench>
      {message && (
        <p
          data-doc-overview-message={message.kind}
          className={message.kind === "error" ? "rounded bg-red-100 px-3 py-2 text-sm text-red-800" : "rounded bg-teal-100 px-3 py-2 text-sm text-teal-800"}
        >
          {message.text}
        </p>
      )}

      <section className="mt-4 rounded border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-semibold">Generate drafts</h2>
        <p className="mt-1 text-sm text-slate-600">
          Generate an explainer and an infographic from a source set you already saved (slice A picker).
          The source texts are hash-checked against the manifest — a changed source generates nothing.
        </p>
        <label className="mt-3 block text-sm font-medium">
          Source-set manifest id
          <input
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1"
            value={manifestId}
            onChange={(event) => setManifestId(event.target.value)}
            placeholder="manifest_…"
          />
        </label>
        <label className="mt-3 block text-sm font-medium">
          Source texts (JSON: document id → {"{ text, pages? }"})
          <textarea
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1 font-mono text-xs"
            rows={5}
            value={documentsJson}
            onChange={(event) => setDocumentsJson(event.target.value)}
            placeholder='{"doc_a": {"text": "..."}}'
          />
        </label>
        <button
          type="button"
          disabled={busy}
          onClick={generate}
          className="mt-3 rounded bg-blue-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          Generate drafts
        </button>
      </section>

      <section className="mt-6 rounded border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-semibold">Your drafts</h2>
        {artifacts.length === 0 ? (
          <p className="mt-2 text-sm text-slate-600">No drafts yet. Generate one above.</p>
        ) : (
          <ul className="mt-2 divide-y divide-slate-200">
            {artifacts.map((artifact) => (
              <li key={artifact.id}>
                <button
                  type="button"
                  onClick={() => selectArtifact(artifact.id)}
                  className="flex w-full items-center justify-between gap-3 py-2 text-left"
                >
                  <span>
                    <span className="font-medium">{artifact.type}</span>{" "}
                    <span className="text-sm text-slate-500">{artifact.id}</span>
                    {artifact.stale && <span className="ml-2 text-sm font-semibold text-orange-700">STALE</span>}
                  </span>
                  <span className={`rounded px-2 py-0.5 text-xs font-semibold ${STATUS_STYLES[artifact.status] ?? ""}`}>
                    {artifact.status.replace("_", " ")} · v{artifact.version}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {selected && preview && (
        <section className="mt-6 rounded border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">
              Preview — {selected.type} · {selected.status.replace("_", " ")}
            </h2>
            <div className="flex flex-wrap gap-2">
              {selected.status === "draft" && (
                <button type="button" disabled={busy} onClick={() => reviewAction("submit")} className="rounded bg-blue-700 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">Submit for review</button>
              )}
              {selected.status === "needs_review" && (
                <>
                  <button type="button" disabled={busy} onClick={() => reviewAction("approve")} className="rounded bg-blue-700 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">Approve</button>
                  <button type="button" disabled={busy} onClick={() => setEditing(true)} className="rounded bg-slate-200 px-3 py-1.5 text-sm font-semibold disabled:opacity-50">Edit</button>
                </>
              )}
              {selected.status === "approved" && (
                <button type="button" disabled={busy} onClick={() => reviewAction("keep")} className="rounded bg-teal-700 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">Keep</button>
              )}
              {selected.status !== "discarded" && (
                <button type="button" disabled={busy} onClick={() => reviewAction("discard")} className="rounded bg-slate-200 px-3 py-1.5 text-sm font-semibold disabled:opacity-50">Discard</button>
              )}
              {(selected.status === "approved" || selected.status === "kept") && (
                <a href={`/api/doc-overview/artifacts/${selected.id}/export`} className="rounded bg-slate-800 px-3 py-1.5 text-sm font-semibold text-white">Export</a>
              )}
            </div>
          </div>

          {editing && (
            <div className="mt-4">
              <label className="block text-sm font-medium">
                Edit content (JSON — every claim must keep a citation to an admitted passage)
                <textarea
                  className="mt-1 w-full rounded border border-slate-300 px-2 py-1 font-mono text-xs"
                  rows={10}
                  value={editJson}
                  onChange={(event) => setEditJson(event.target.value)}
                />
              </label>
              <div className="mt-2 flex gap-2">
                <button type="button" disabled={busy} onClick={saveEdit} className="rounded bg-blue-700 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">Save edit</button>
                <button type="button" onClick={() => setEditing(false)} className="rounded bg-slate-200 px-3 py-1.5 text-sm font-semibold">Cancel</button>
              </div>
            </div>
          )}

          {preview.stale && (
            <p className="mt-3 rounded bg-orange-100 px-3 py-2 text-sm font-semibold text-orange-800">
              STALE — a source changed since this draft was generated. Regenerate and re-review before use.
            </p>
          )}
          <div className="mt-4" dangerouslySetInnerHTML={{ __html: preview.html }} />
        </section>
      )}
    </div>
  );
}
