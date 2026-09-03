"use client";
/* eslint-disable @next/next/no-img-element -- private, short-lived signed URLs cannot use the static Next image host allowlist */

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { compressImageFile } from "@/components/forge/rental/compressImageFile";

const tabs = ["Overview", "Labs", "Regimen", "Peptides", "Workouts", "Timeline"];

function Card({ title, children }) {
  return <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900"><h2 className="text-lg font-black">{title}</h2><div className="mt-4">{children}</div></section>;
}

function HealthDocumentImporter({ workspaceId, profiles, defaultCategory, onConfirmed }) {
  const supabase = useMemo(() => createClient(), []);
  const [profileId, setProfileId] = useState(profiles[0]?.id || "");
  const [category, setCategory] = useState(defaultCategory);
  const [title, setTitle] = useState("");
  const [documentDate, setDocumentDate] = useState("");
  const [file, setFile] = useState(null);
  const [proposal, setProposal] = useState(null);
  const [reviewed, setReviewed] = useState(null);
  const [source, setSource] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function propose(event) {
    event.preventDefault(); setBusy(true); setMessage(""); setProposal(null);
    const body = new FormData();
    body.append("file", file); body.append("workspaceId", workspaceId); body.append("profileId", profileId);
    body.append("category", category); body.append("title", title); body.append("documentDate", documentDate);
    const response = await fetch("/api/health/documents/propose", { method: "POST", body });
    const result = await response.json(); setBusy(false);
    if (!response.ok) { setMessage(result.error || "Unable to read this document."); return; }
    setSource(result.sourceUrl ? { url: result.sourceUrl, mimeType: result.mimeType } : null);
    if (!result.proposal) { setMessage(result.warning || "The source was saved. Enter its fields manually."); return; }
    setProposal(result.proposal); setReviewed(structuredClone(result.proposal.proposed_data));
    setMessage("Review every field below. Nothing has been added to the health record yet.");
  }

  function updateResult(index, key, value) {
    setReviewed((current) => ({ ...current, results: current.results.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: value } : row) }));
  }

  async function confirm() {
    setBusy(true); setMessage("");
    const { error } = await supabase.rpc("confirm_health_extraction_proposal", { p_proposal_id: proposal.id, p_reviewed_data: reviewed });
    setBusy(false);
    if (error) { setMessage(error.message); return; }
    setProposal(null); setReviewed(null); setSource(null); setTitle(""); setDocumentDate(""); setFile(null);
    setMessage("Confirmed fields were added and remain linked to the source document.");
    await onConfirmed();
  }

  return <Card title="Upload a photo or document">
    <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">Use a medication label, lab report, prescription or PDF. FORGE proposes fields; you approve or correct them before saving.</p>
    {!proposal && <form onSubmit={propose} className="grid gap-3 sm:grid-cols-2">
      <label className="text-sm font-bold">Person<select value={profileId} onChange={(event) => setProfileId(event.target.value)} required className="mt-1 w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2 dark:border-slate-600">{profiles.map((profile) => <option className="text-slate-950" key={profile.id} value={profile.id}>{profile.display_name}</option>)}</select></label>
      <label className="text-sm font-bold">Document type<select value={category} onChange={(event) => setCategory(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2 dark:border-slate-600"><option className="text-slate-950" value="medication_label">Medication label</option><option className="text-slate-950" value="lab_report">Lab report</option><option className="text-slate-950" value="prescription">Prescription</option><option className="text-slate-950" value="visit_summary">Visit summary</option><option className="text-slate-950" value="insurance">Insurance</option><option className="text-slate-950" value="authorization">Authorization / POA</option><option className="text-slate-950" value="other">Other</option></select></label>
      <label className="text-sm font-bold">Title<input value={title} onChange={(event) => setTitle(event.target.value)} required placeholder="August 2026 lab report" className="mt-1 w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2 dark:border-slate-600"/></label>
      <label className="text-sm font-bold">Document date<input type="date" value={documentDate} onChange={(event) => setDocumentDate(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2 dark:border-slate-600"/></label>
      <label className="text-sm font-bold sm:col-span-2">Photo or PDF<input type="file" accept="application/pdf,image/jpeg,image/png" onChange={async (event) => { const picked = event.target.files?.[0] || null; setFile(picked ? await compressImageFile(picked) : null); }} required className="mt-1 block w-full rounded-xl border border-dashed border-slate-400 p-3 text-sm"/></label>
      <button disabled={busy || !file} className="rounded-xl bg-amber-400 px-4 py-3 font-black text-slate-950 disabled:opacity-50 sm:col-span-2">{busy ? "Reading document…" : "Read and propose fields"}</button>
    </form>}
    {source && <div className="mb-4 rounded-xl border border-slate-300 p-3 dark:border-slate-600">{source.mimeType?.startsWith("image/") ? <img src={source.url} alt="Uploaded source for field review" className="max-h-80 w-full object-contain"/> : <a href={source.url} target="_blank" rel="noreferrer" className="font-black text-sky-600 underline">Open the uploaded source PDF</a>}<p className="mt-2 text-xs text-slate-500">Compare the source with every proposed field before confirming.</p></div>}
    {proposal?.proposal_type === "regimen_item" && reviewed && <div className="grid gap-3 sm:grid-cols-2">
      {[['name','Name'],['dose','Dose'],['route','Route'],['frequency','Frequency'],['instructions','Instructions'],['refillsRemaining','Refills remaining']].map(([key,label]) => <label key={key} className={`text-sm font-bold ${key === 'instructions' ? 'sm:col-span-2' : ''}`}>{label}<input value={reviewed[key] ?? ""} onChange={(event) => setReviewed({ ...reviewed, [key]: event.target.value })} className="mt-1 w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2 dark:border-slate-600"/></label>)}
      <label className="text-sm font-bold">Category<select value={reviewed.category || "prescription"} onChange={(event) => setReviewed({ ...reviewed, category: event.target.value })} className="mt-1 w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2 dark:border-slate-600"><option className="text-slate-950" value="prescription">Prescription</option><option className="text-slate-950" value="supplement">Supplement</option><option className="text-slate-950" value="peptide">Peptide</option><option className="text-slate-950" value="other">Other</option></select></label>
    </div>}
    {proposal?.proposal_type === "lab_results" && reviewed && <div className="space-y-3">
      <label className="block text-sm font-bold">Collection date<input type="date" value={reviewed.collectedOn || documentDate} onChange={(event) => setReviewed({ ...reviewed, collectedOn: event.target.value })} className="mt-1 w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2 dark:border-slate-600"/></label>
      {(reviewed.results || []).map((row, index) => <div key={`${row.markerName}-${index}`} className="grid gap-2 rounded-xl bg-slate-100 p-3 dark:bg-slate-800 sm:grid-cols-4"><input aria-label={`Marker ${index + 1}`} value={row.markerName || ""} onChange={(event) => updateResult(index, "markerName", event.target.value)} className="rounded-lg border bg-transparent px-2 py-1"/><input aria-label={`Value ${index + 1}`} value={row.valueNumeric ?? row.valueText ?? ""} onChange={(event) => updateResult(index, "valueNumeric", event.target.value)} className="rounded-lg border bg-transparent px-2 py-1"/><input aria-label={`Unit ${index + 1}`} value={row.unit || ""} onChange={(event) => updateResult(index, "unit", event.target.value)} className="rounded-lg border bg-transparent px-2 py-1"/><select aria-label={`Flag ${index + 1}`} value={row.flag || "unknown"} onChange={(event) => updateResult(index, "flag", event.target.value)} className="rounded-lg border bg-transparent px-2 py-1"><option className="text-slate-950" value="unknown">Unknown</option><option className="text-slate-950" value="normal">Normal</option><option className="text-slate-950" value="low">Low</option><option className="text-slate-950" value="high">High</option><option className="text-slate-950" value="critical">Critical</option></select></div>)}
    </div>}
    {proposal && <div className="mt-4 flex gap-2"><button onClick={confirm} disabled={busy || proposal.proposal_type === "unclassified"} className="rounded-xl bg-emerald-500 px-4 py-2 font-black text-slate-950 disabled:opacity-50">{busy ? "Saving…" : "Confirm and add fields"}</button><button onClick={() => { setProposal(null); setReviewed(null); setSource(null); setMessage(""); }} className="rounded-xl bg-slate-200 px-4 py-2 font-black text-slate-950">Cancel review</button></div>}
    {message && <p role="status" className="mt-4 rounded-xl bg-slate-100 p-3 text-sm font-bold dark:bg-slate-800">{message}</p>}
  </Card>;
}

export default function HealthDashboard({ initialMembership }) {
  const supabase = useMemo(() => createClient(), []);
  const [workspaceId, setWorkspaceId] = useState(initialMembership?.workspace_id ?? null);
  const [activeTab, setActiveTab] = useState("Overview");
  const [loading, setLoading] = useState(Boolean(workspaceId));
  const [error, setError] = useState("");
  const [dependentName, setDependentName] = useState("");
  const [dependentRelationship, setDependentRelationship] = useState("");
  const [data, setData] = useState({ profiles: [], conditions: [], careTeam: [], labs: [], regimen: [], measurements: [], workouts: [], timeline: [] });

  async function load(id = workspaceId) {
    if (!id) return;
    setError("");
    const tables = [
      ["profiles", "health_profiles", "display_name"], ["labs", "health_lab_results", "collected_on"],
      ["conditions", "health_conditions", "name"], ["careTeam", "health_care_team", "clinician_name"],
      ["regimen", "health_regimen_items", "name"], ["measurements", "health_measurements", "measured_at"],
      ["workouts", "health_workouts", "performed_at"], ["timeline", "health_clinical_timeline", "occurred_on"],
    ];
    const results = await Promise.all(tables.map(([, table, order]) => supabase.from(table).select("*").eq("workspace_id", id).order(order, { ascending: false })));
    const failed = results.find((result) => result.error);
    if (failed) setError(failed.error.message);
    else setData(Object.fromEntries(tables.map(([key], index) => [key, results[index].data ?? []])));
    setLoading(false);
  }

  // The workspace identifier is the external subscription key; reload its RLS-scoped snapshot when it changes.
  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
  useEffect(() => { if (workspaceId) load(workspaceId); }, [workspaceId]);

  async function initialize() {
    setLoading(true); setError("");
    const { data: id, error: setupError } = await supabase.rpc("bootstrap_private_health_workspace");
    if (setupError) { setError(setupError.message); setLoading(false); return; }
    setWorkspaceId(id);
  }

  async function addDependent(event) {
    event.preventDefault(); setError("");
    const { error: dependentError } = await supabase.rpc("add_health_managed_dependent", {
      p_workspace_id: workspaceId, p_display_name: dependentName, p_relationship: dependentRelationship, p_date_of_birth: null,
    });
    if (dependentError) { setError(dependentError.message); return; }
    setDependentName(""); setDependentRelationship(""); await load(workspaceId);
  }

  if (!workspaceId) return <main className="mx-auto max-w-3xl p-6"><Card title="Private FORGE Health"><p className="text-slate-600 dark:text-slate-300">Create one shared health workspace for you and your active co-owner. Only the two explicitly added accounts will have access.</p><button onClick={initialize} disabled={loading} className="mt-5 rounded-xl bg-amber-400 px-5 py-3 font-black text-slate-950 disabled:opacity-50">{loading ? "Creating…" : "Create our private health workspace"}</button>{error && <p role="alert" className="mt-4 text-sm font-bold text-red-600">{error}</p>}</Card></main>;

  const activeRegimen = data.regimen.filter((item) => item.status === "active");
  const latestLabs = data.labs.slice(0, 8);
  return <main className="min-h-screen bg-slate-100 p-4 text-slate-950 dark:bg-slate-950 dark:text-white sm:p-6">
    <div className="mx-auto max-w-7xl">
      <p className="text-xs font-black uppercase tracking-[.24em] text-amber-600 dark:text-amber-400">FORGE Application</p>
      <h1 className="text-3xl font-black">Health</h1>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Shared private health history, regimen, laboratory trends, peptides, and training.</p>
      <div className="mt-5 flex flex-wrap gap-2">{tabs.map((tab) => <button key={tab} onClick={() => setActiveTab(tab)} className={`rounded-xl px-4 py-2 text-sm font-black ${activeTab === tab ? "bg-amber-400 text-slate-950" : "bg-slate-200 dark:bg-slate-800"}`}>{tab}</button>)}</div>
      {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 font-bold text-red-700 dark:bg-red-950 dark:text-red-200">{error}</p>}
      {loading ? <p className="mt-8 font-bold">Loading private health records…</p> : <div className="mt-6 grid gap-5 lg:grid-cols-2">
        {activeTab === "Overview" && <>
          <Card title="Household profiles"><div className="space-y-3">{data.profiles.map((profile) => <div key={profile.id} className="rounded-xl bg-slate-100 p-4 dark:bg-slate-800"><p className="font-black">{profile.display_name}</p><p className="text-xs text-slate-500 dark:text-slate-400">{profile.profile_type === "managed_dependent" ? `Managed ${profile.relationship || "dependent"}` : "Private household member"} · {data.conditions.filter((condition) => condition.profile_id === profile.id && condition.status === "active").length} active conditions · {activeRegimen.filter((item) => item.profile_id === profile.id).length} active regimen items</p></div>)}</div><form onSubmit={addDependent} className="mt-4 grid gap-2 sm:grid-cols-2"><input aria-label="Dependent full name" required value={dependentName} onChange={(event) => setDependentName(event.target.value)} placeholder="Dependent full name" className="rounded-xl border border-slate-300 bg-transparent px-3 py-2 dark:border-slate-600"/><input aria-label="Relationship" required value={dependentRelationship} onChange={(event) => setDependentRelationship(event.target.value)} placeholder="Relationship, such as mother" className="rounded-xl border border-slate-300 bg-transparent px-3 py-2 dark:border-slate-600"/><button className="rounded-xl bg-slate-950 px-4 py-2 font-black text-white dark:bg-amber-400 dark:text-slate-950 sm:col-span-2">Add managed dependent</button></form></Card>
          <Card title="Current regimen"><p className="text-3xl font-black text-emerald-600">{activeRegimen.length}</p><p className="text-sm text-slate-500">active prescriptions, supplements, and peptides</p></Card>
          <Card title="Latest laboratory results">{latestLabs.length ? <div className="space-y-2">{latestLabs.map((lab) => <div key={lab.id} className="flex justify-between gap-4 border-b border-slate-200 py-2 dark:border-slate-700"><span className="font-bold">{lab.marker_name}</span><span className={lab.flag === "high" || lab.flag === "critical" ? "font-black text-red-600" : "font-black"}>{lab.value_numeric ?? lab.value_text} {lab.unit}</span></div>)}</div> : <p className="text-sm text-slate-500">No structured lab results yet.</p>}</Card>
          <Card title="Activity"><div className="grid grid-cols-3 gap-3 text-center"><div><p className="text-2xl font-black">{data.measurements.length}</p><p className="text-xs">measurements</p></div><div><p className="text-2xl font-black">{data.workouts.length}</p><p className="text-xs">workouts</p></div><div><p className="text-2xl font-black">{data.timeline.length}</p><p className="text-xs">timeline events</p></div></div></Card>
        </>}
        {activeTab === "Labs" && <><HealthDocumentImporter workspaceId={workspaceId} profiles={data.profiles} defaultCategory="lab_report" onConfirmed={() => load(workspaceId)}/><Card title="Laboratory history"><p className="text-sm text-slate-500">Structured results and trend charts will appear here. The database preserves values, units, ranges, flags, dates, panels and source documents independently.</p></Card></>}
        {activeTab === "Regimen" && <><HealthDocumentImporter workspaceId={workspaceId} profiles={data.profiles} defaultCategory="medication_label" onConfirmed={() => load(workspaceId)}/><Card title="Prescriptions and supplements"><div className="space-y-3">{data.regimen.filter((x) => x.category !== "peptide").map((item) => <div key={item.id} className="rounded-xl bg-slate-100 p-4 dark:bg-slate-800"><div className="flex justify-between"><p className="font-black">{item.name}</p><span className="text-xs font-black uppercase text-emerald-600">{item.status}</span></div><p className="text-sm">{[item.dose,item.route,item.frequency].filter(Boolean).join(" · ")}</p></div>)}</div></Card></>}
        {activeTab === "Peptides" && <Card title="Peptides"><p className="text-sm text-slate-500">Track the prescribed or supervised product, concentration, dose, route, cycle, individual injections, injection site, missed doses and reactions.</p></Card>}
        {activeTab === "Workouts" && <Card title="Workout regimen"><p className="text-sm text-slate-500">Record strength, cardio and mobility sessions with duration, exercises, sets, repetitions, weight and perceived exertion.</p></Card>}
        {activeTab === "Timeline" && <Card title="Clinical timeline"><p className="text-sm text-slate-500">Physician visits, recommendations, insurance decisions and regimen changes are kept in date order without rewriting the original event.</p></Card>}
      </div>}
      <p className="mt-8 text-xs text-slate-500">FORGE Health organizes records and trends. It does not diagnose conditions or change treatment without clinician review.</p>
    </div>
  </main>;
}
