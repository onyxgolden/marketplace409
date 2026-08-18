"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

const dateFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
const timestampFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

function formatDate(iso) {
  if (!iso) return "—";
  return dateFormatter.format(new Date(`${iso}T00:00:00`));
}
function formatTimestamp(iso) {
  if (!iso) return "—";
  return timestampFormatter.format(new Date(iso));
}

async function fetchProjects() {
  const response = await fetch("/api/forge/scheduling");
  if (!response.ok) return [];
  const body = await response.json();
  return body.projects || [];
}

export default function ProjectsScreen() {
  const router = useRouter();
  const [projects, setProjects] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [creating, setCreating] = useState(false);

  async function refresh() {
    setProjects(await fetchProjects());
  }

  useEffect(() => {
    refresh().finally(() => setLoaded(true));
  }, []);

  async function handleCreateProject() {
    setCreating(true);
    try {
      const response = await fetch("/api/forge/scheduling", { method: "POST" });
      if (!response.ok) { window.alert("Unable to create a new project."); return; }
      const body = await response.json();
      router.push(`/forge/scheduling/${body.id}`);
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(project) {
    if (!window.confirm(`Delete "${project.name}"? This can't be undone.`)) return;
    const response = await fetch(`/api/forge/scheduling/${project.id}`, { method: "DELETE" });
    if (!response.ok) { window.alert("Unable to delete that project."); return; }
    refresh();
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm" data-scheduling-projects>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-amber-700">Scheduling</p>
          <h1 className="mt-2 text-2xl font-black">Projects</h1>
          <p className="mt-2 text-sm text-slate-600">Every saved Gantt Chart. Open one to keep working, or start a new one.</p>
        </div>
        <button type="button" onClick={handleCreateProject} disabled={creating}
          className="shrink-0 rounded-xl bg-slate-950 px-5 py-3 font-black text-white disabled:opacity-50">+ New Project</button>
      </div>

      {loaded && projects.length === 0 && (
        <div className="mt-8 rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
          No projects yet. Click "+ New Project" to build your first Gantt Chart.
        </div>
      )}

      {projects.length > 0 && (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[720px] table-fixed text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-black uppercase tracking-wide text-slate-500">
                <th className="w-1/3 py-2">Name</th>
                <th className="py-2">Start Date</th>
                <th className="py-2">Finish Date</th>
                <th className="py-2">Created</th>
                <th className="py-2">Last Modified</th>
                <th className="w-20 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((project) => (
                <tr key={project.id} className="border-b border-slate-100 last:border-0">
                  <td className="py-3 pr-3 font-bold text-slate-950">
                    <Link href={`/forge/scheduling/${project.id}`} className="hover:underline">{project.name || "Untitled project"}</Link>
                    {project.isPublic && !project.isOwner && (
                      <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black text-amber-700">SHARED EXAMPLE</span>
                    )}
                  </td>
                  <td className="py-3 pr-3 text-slate-600">{formatDate(project.startDate)}</td>
                  <td className="py-3 pr-3 text-slate-600">{formatDate(project.endDate)}</td>
                  <td className="py-3 pr-3 text-slate-600">{formatTimestamp(project.createdAt)}</td>
                  <td className="py-3 pr-3 text-slate-600">{formatTimestamp(project.updatedAt)}</td>
                  <td className="py-3 text-right">
                    {project.isOwner && (
                      <button type="button" onClick={() => handleDelete(project)} title="Delete project"
                        className="font-bold text-slate-400 hover:text-red-600">✕</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
