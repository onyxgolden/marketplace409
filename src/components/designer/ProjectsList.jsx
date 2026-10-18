"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { SAMPLE_PROJECTS } from "@/domains/roomDesigner/sampleProjects";

/** Standalone project list for the room designer. */
export default function ProjectsList() {
  const router = useRouter();
  const [projects, setProjects] = useState([]);
  const [status, setStatus] = useState({ kind: "loading" });
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [forking, setForking] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/forge/designer");
        if (!res.ok) throw new Error(`Load failed (${res.status})`);
        const body = await res.json();
        if (cancelled) return;
        setProjects(body.projects || []);
        setStatus({ kind: "ready" });
      } catch (error) {
        if (!cancelled) setStatus({ kind: "error", message: error.message });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const create = async () => {
    setCreating(true);
    try {
      const res = await fetch("/api/forge/designer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: newName.trim() || undefined }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `Create failed (${res.status})`);
      window.location.href = `/forge/designer/${body.id}`;
    } catch (error) {
      setStatus({ kind: "error", message: error.message });
      setCreating(false);
    }
  };

  const remove = async (id, name) => {
    if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/forge/designer/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`Delete failed (${res.status})`);
      setProjects((list) => list.filter((p) => p.id !== id));
    } catch (error) {
      setStatus({ kind: "error", message: error.message });
    }
  };

  // Fork a sample project: POST a fresh project, then PUT the generated
  // seed document into it. The seed carries no identity (no projectId, no
  // owner, no timestamps) — the server assigns a new projectId/owner_id
  // and row timestamps, so the fork gets its own draft key and revision
  // history. Nothing here edits the sample itself.
  const forkSample = async (sample) => {
    setForking(sample.seedId);
    try {
      const seedDocument = sample.build();
      const postRes = await fetch("/api/forge/designer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: seedDocument.name }),
      });
      const postBody = await postRes.json();
      if (!postRes.ok) throw new Error(postBody.error || `Create failed (${postRes.status})`);
      const putRes = await fetch(`/api/forge/designer/${postBody.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: seedDocument.name, design: seedDocument }),
      });
      const putBody = await putRes.json().catch(() => ({}));
      if (!putRes.ok) throw new Error(putBody.error || `Copy failed (${putRes.status})`);
      router.push(`/forge/designer/${postBody.id}`);
    } catch (error) {
      setStatus({ kind: "error", message: error.message });
      setForking(null);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-bold text-white">Room designs</h1>
      <p className="mt-1 text-sm text-gray-400">
        Floor plans for remodels and new layouts — 2D plans with a 3D view.
      </p>

      <div className="mt-6 flex gap-2">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") create(); }}
          placeholder="New design name (e.g. Kitchen remodel)"
          className="flex-1 rounded bg-gray-800 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-emerald-500"
          aria-label="New design name"
        />
        <button
          onClick={create}
          disabled={creating}
          className="flex items-center gap-1 rounded bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          <Plus size={16} /> {creating ? "Creating…" : "New design"}
        </button>
      </div>

      {status.kind === "error" && (
        <div className="mt-4 rounded bg-red-900/60 px-4 py-2 text-sm text-red-200">{status.message}</div>
      )}

      <div className="mt-8">
        <h2 className="text-lg font-semibold text-white">Sample projects</h2>
        <p className="mt-1 text-sm text-gray-400">
          Finished examples to explore — &ldquo;Use this sample&rdquo; creates your own
          editable copy; the sample itself is never changed.
        </p>
        <ul className="mt-4 space-y-2">
          {SAMPLE_PROJECTS.map((sample) => (
            <li
              key={sample.seedId}
              className="flex items-center gap-3 rounded-lg border border-gray-800 bg-gray-900 px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <span className="block truncate font-semibold text-white">{sample.name}</span>
                <span className="block text-xs text-gray-500">
                  {sample.levels.join(" · ")}
                </span>
                <span className="mt-1 block text-sm text-gray-400">{sample.description}</span>
              </div>
              <button
                onClick={() => forkSample(sample)}
                disabled={forking !== null}
                className="shrink-0 rounded bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {forking === sample.seedId ? "Copying…" : "Use this sample"}
              </button>
            </li>
          ))}
        </ul>
      </div>

      {status.kind === "loading" ? (
        <p className="mt-6 text-sm text-gray-400">Loading designs…</p>
      ) : projects.length === 0 ? (
        <div className="mt-6 rounded-lg border border-dashed border-gray-700 p-8 text-center">
          <p className="text-gray-300">No designs yet.</p>
          <p className="mt-1 text-sm text-gray-500">Name your first design above and start drawing walls.</p>
        </div>
      ) : (
        <ul className="mt-6 space-y-2">
          {projects.map((p) => (
            <li
              key={p.id}
              className="flex items-center gap-3 rounded-lg border border-gray-800 bg-gray-900 px-4 py-3 hover:border-gray-600"
            >
              <Link href={`/forge/designer/${p.id}`} className="min-w-0 flex-1">
                <span className="block truncate font-semibold text-white">{p.name}</span>
                <span className="block text-xs text-gray-500">
                  Updated {p.updatedAt ? new Date(p.updatedAt).toLocaleString() : "—"}
                </span>
              </Link>
              <button
                onClick={() => remove(p.id, p.name)}
                className="rounded p-2 text-gray-500 hover:bg-red-900/40 hover:text-red-300"
                aria-label={`Delete ${p.name}`}
              >
                <Trash2 size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
