"use client";
/* eslint-disable @next/next/no-img-element -- private, short-lived signed URLs cannot use the static Next image host allowlist */

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { compressImageFile } from "@/components/forge/rental/compressImageFile";
import HealthLabTrendChart from "./HealthLabTrendChart";
import HealthLabCombinedTrendChart from "./HealthLabCombinedTrendChart";
import HealthVitalsTrendChart from "./HealthVitalsTrendChart";

const tabs = ["Overview", "Labs", "Regimen", "Peptides", "Workouts", "Programs", "Vitals", "Timeline"];

// Maps to health_measurements.measurement_type. Blood pressure is the only type that uses
// secondary_value_numeric (diastolic alongside the systolic value_numeric) -- every other type is
// a single value. Chosen to match what a Samsung Health / smartwatch export typically reports, so
// a future CSV import can land in these same rows without a schema change.
const MEASUREMENT_TYPES = [
  { value: "steps", label: "Steps", unit: "steps" },
  { value: "blood_pressure", label: "Blood pressure", unit: "mmHg", primaryLabel: "Systolic", secondaryLabel: "Diastolic" },
  { value: "heart_rate", label: "Heart rate", unit: "bpm" },
  { value: "blood_oxygen", label: "Blood oxygen (SpO2)", unit: "%" },
  { value: "sleep_hours", label: "Sleep", unit: "hours" },
  { value: "weight", label: "Weight", unit: "lb" },
];
const MEASUREMENT_TYPE_BY_VALUE = Object.fromEntries(MEASUREMENT_TYPES.map((type) => [type.value, type]));

function groupMeasurementsByType(measurements) {
  const groups = {};
  for (const measurement of measurements) (groups[measurement.measurement_type] ??= []).push(measurement);
  return groups;
}

// timeZone: "UTC" is required -- the workout form saves its plain date input as UTC midnight
// (new Date("2026-09-03").toISOString()), and formatting that in the viewer's local timezone
// rolls it back a day for anyone west of UTC (e.g. every US timezone), mislabeling the workout.
const WORKOUT_DATE_LABEL = new Intl.DateTimeFormat("en-US", { timeZone: "UTC" });
function workoutDateLabel(performedAt) {
  return WORKOUT_DATE_LABEL.format(new Date(performedAt));
}

function groupLabsByMarker(labs) {
  const groups = {};
  for (const lab of labs) (groups[lab.marker_name] ??= []).push(lab);
  return groups;
}

// Splits grouped lab markers into two magnitude tiers so each combined chart's shared axis stays
// meaningful -- plotting Hemoglobin A1c (~5-8) next to Total cholesterol (~200-400) on one axis
// flattens A1c into a straight line, the same "different scales, one axis" problem a dual-axis
// chart has, just without the second scale to hide behind. Bucketed by each marker's own most
// recent value, not a hardcoded marker-name list, so a new marker sorts itself sensibly.
const NARROW_RANGE_CEILING = 15;
function splitLabTiers(groupedLabs) {
  const narrow = {};
  const wide = {};
  for (const [markerName, points] of Object.entries(groupedLabs)) {
    const latestValue = Number([...points].sort((a, b) => a.collected_on.localeCompare(b.collected_on)).at(-1).value_numeric);
    (latestValue < NARROW_RANGE_CEILING ? narrow : wide)[markerName] = points;
  }
  return { narrow, wide };
}

function Card({ title, children }) {
  return <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900"><h2 className="text-lg font-black">{title}</h2><div className="mt-4">{children}</div></section>;
}

function HealthDocumentImporter({ workspaceId, profiles, defaultCategory, defaultProfileId, onConfirmed }) {
  const supabase = useMemo(() => createClient(), []);
  const [profileId, setProfileId] = useState(defaultProfileId || profiles[0]?.id || "");
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
  function addResult() {
    setReviewed((current) => ({ ...current, results: [...(current.results || []), { markerName: "", valueNumeric: "", unit: "", referenceLow: "", referenceHigh: "", flag: "unknown" }] }));
  }
  function removeResult(index) {
    setReviewed((current) => ({ ...current, results: current.results.filter((_, rowIndex) => rowIndex !== index) }));
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
      <p className="text-xs text-slate-500 dark:text-slate-400">Reference range fields are never guessed from the document -- labs vary their own ranges, so type in the low/high shown on this report to enable the target band on the trend chart.</p>
      {(reviewed.results || []).map((row, index) => <div key={`${row.markerName}-${index}`} className="grid grid-cols-7 gap-2 rounded-xl bg-slate-100 p-3 dark:bg-slate-800 sm:grid-cols-13"><input aria-label={`Marker ${index + 1}`} placeholder="Marker" value={row.markerName || ""} onChange={(event) => updateResult(index, "markerName", event.target.value)} className="col-span-3 rounded-lg border bg-transparent px-2 py-1 sm:col-span-3"/><input aria-label={`Value ${index + 1}`} placeholder="Value" value={row.valueNumeric ?? row.valueText ?? ""} onChange={(event) => updateResult(index, "valueNumeric", event.target.value)} className="col-span-2 rounded-lg border bg-transparent px-2 py-1 sm:col-span-2"/><input aria-label={`Unit ${index + 1}`} placeholder="Unit" value={row.unit || ""} onChange={(event) => updateResult(index, "unit", event.target.value)} className="col-span-2 rounded-lg border bg-transparent px-2 py-1 sm:col-span-2"/><input aria-label={`Reference low ${index + 1}`} placeholder="Ref low" value={row.referenceLow ?? ""} onChange={(event) => updateResult(index, "referenceLow", event.target.value)} className="col-span-3 rounded-lg border bg-transparent px-2 py-1 sm:col-span-2"/><input aria-label={`Reference high ${index + 1}`} placeholder="Ref high" value={row.referenceHigh ?? ""} onChange={(event) => updateResult(index, "referenceHigh", event.target.value)} className="col-span-3 rounded-lg border bg-transparent px-2 py-1 sm:col-span-2"/><select aria-label={`Flag ${index + 1}`} value={row.flag || "unknown"} onChange={(event) => updateResult(index, "flag", event.target.value)} className="col-span-6 rounded-lg border bg-transparent px-2 py-1 sm:col-span-2"><option className="text-slate-950" value="unknown">Unknown</option><option className="text-slate-950" value="normal">Normal</option><option className="text-slate-950" value="low">Low</option><option className="text-slate-950" value="high">High</option><option className="text-slate-950" value="critical">Critical</option></select><button type="button" onClick={() => removeResult(index)} aria-label={`Remove result ${index + 1}`} className="col-span-1 rounded-lg bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-200">×</button></div>)}
      <button type="button" onClick={addResult} className="rounded-xl bg-slate-200 px-3 py-1.5 text-sm font-black dark:bg-slate-700">+ Add result</button>
    </div>}
    {proposal && <div className="mt-4 flex gap-2"><button onClick={confirm} disabled={busy || proposal.proposal_type === "unclassified"} className="rounded-xl bg-emerald-500 px-4 py-2 font-black text-slate-950 disabled:opacity-50">{busy ? "Saving…" : "Confirm and add fields"}</button><button onClick={() => { setProposal(null); setReviewed(null); setSource(null); setMessage(""); }} className="rounded-xl bg-slate-200 px-4 py-2 font-black text-slate-950">Cancel review</button></div>}
    {message && <p role="status" className="mt-4 rounded-xl bg-slate-100 p-3 text-sm font-bold dark:bg-slate-800">{message}</p>}
  </Card>;
}

function emptyExerciseRow() { return { exercise: "", sets: "", reps: "", weight: "" }; }

function HealthWorkoutForm({ workspaceId, profiles, defaultProfileId, onSaved }) {
  const supabase = useMemo(() => createClient(), []);
  const [profileId, setProfileId] = useState(defaultProfileId || profiles[0]?.id || "");
  const [performedAt, setPerformedAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [workoutType, setWorkoutType] = useState("");
  const [durationMinutes, setDurationMinutes] = useState("");
  const [perceivedExertion, setPerceivedExertion] = useState("");
  const [notes, setNotes] = useState("");
  const [exercises, setExercises] = useState([emptyExerciseRow()]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  function updateExercise(index, key, value) {
    setExercises((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: value } : row));
  }
  function addExercise() { setExercises((current) => [...current, emptyExerciseRow()]); }
  function removeExercise(index) { setExercises((current) => current.length > 1 ? current.filter((_, rowIndex) => rowIndex !== index) : current); }

  async function save(event) {
    event.preventDefault(); setBusy(true); setMessage("");
    const details = exercises.filter((row) => row.exercise.trim()).map((row) => ({
      exercise: row.exercise.trim(),
      sets: row.sets ? Number(row.sets) : null,
      reps: row.reps.trim() || null,
      weight: row.weight.trim() || null,
    }));
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from("health_workouts").insert({
      workspace_id: workspaceId, profile_id: profileId,
      performed_at: new Date(performedAt).toISOString(),
      workout_type: workoutType.trim() || "Workout",
      duration_minutes: durationMinutes ? Number(durationMinutes) : null,
      perceived_exertion: perceivedExertion ? Number(perceivedExertion) : null,
      notes: notes.trim() || null,
      details,
      recorded_by: user.id,
    });
    setBusy(false);
    if (error) { setMessage(error.message); return; }
    setWorkoutType(""); setDurationMinutes(""); setPerceivedExertion(""); setNotes(""); setExercises([emptyExerciseRow()]);
    setMessage("Workout saved.");
    await onSaved();
  }

  return <Card title="Log a workout">
    <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
      <label className="text-sm font-bold">Person<select value={profileId} onChange={(event) => setProfileId(event.target.value)} required className="mt-1 w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2 dark:border-slate-600">{profiles.map((profile) => <option className="text-slate-950" key={profile.id} value={profile.id}>{profile.display_name}</option>)}</select></label>
      <label className="text-sm font-bold">Date<input type="date" value={performedAt} onChange={(event) => setPerformedAt(event.target.value)} required className="mt-1 w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2 dark:border-slate-600"/></label>
      <label className="text-sm font-bold">Workout type<input value={workoutType} onChange={(event) => setWorkoutType(event.target.value)} placeholder="Strength & cardio" className="mt-1 w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2 dark:border-slate-600"/></label>
      <label className="text-sm font-bold">Duration (minutes)<input type="number" min="1" value={durationMinutes} onChange={(event) => setDurationMinutes(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2 dark:border-slate-600"/></label>
      <label className="text-sm font-bold">Perceived exertion (1-10)<input type="number" min="1" max="10" value={perceivedExertion} onChange={(event) => setPerceivedExertion(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2 dark:border-slate-600"/></label>
      <label className="text-sm font-bold">Notes<input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="e.g. performed 3 days a week" className="mt-1 w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2 dark:border-slate-600"/></label>
      <div className="sm:col-span-2 space-y-2">
        <p className="text-sm font-bold">Exercises</p>
        {exercises.map((row, index) => <div key={index} className="grid grid-cols-12 gap-2 rounded-xl bg-slate-100 p-3 dark:bg-slate-800">
          <input aria-label={`Exercise ${index + 1}`} value={row.exercise} onChange={(event) => updateExercise(index, "exercise", event.target.value)} placeholder="Exercise" className="col-span-5 rounded-lg border bg-transparent px-2 py-1"/>
          <input aria-label={`Sets ${index + 1}`} value={row.sets} onChange={(event) => updateExercise(index, "sets", event.target.value)} placeholder="Sets" className="col-span-2 rounded-lg border bg-transparent px-2 py-1"/>
          <input aria-label={`Reps ${index + 1}`} value={row.reps} onChange={(event) => updateExercise(index, "reps", event.target.value)} placeholder="Reps" className="col-span-2 rounded-lg border bg-transparent px-2 py-1"/>
          <input aria-label={`Weight ${index + 1}`} value={row.weight} onChange={(event) => updateExercise(index, "weight", event.target.value)} placeholder="Weight" className="col-span-2 rounded-lg border bg-transparent px-2 py-1"/>
          <button type="button" onClick={() => removeExercise(index)} aria-label={`Remove exercise ${index + 1}`} className="col-span-1 rounded-lg bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-200">×</button>
        </div>)}
        <button type="button" onClick={addExercise} className="rounded-xl bg-slate-200 px-3 py-1.5 text-sm font-black dark:bg-slate-700">+ Add exercise</button>
      </div>
      <button disabled={busy} className="rounded-xl bg-amber-400 px-4 py-3 font-black text-slate-950 disabled:opacity-50 sm:col-span-2">{busy ? "Saving…" : "Save workout"}</button>
    </form>
    {message && <p role="status" className="mt-4 rounded-xl bg-slate-100 p-3 text-sm font-bold dark:bg-slate-800">{message}</p>}
  </Card>;
}

function HealthMeasurementForm({ workspaceId, profiles, defaultProfileId, onSaved }) {
  const supabase = useMemo(() => createClient(), []);
  const [profileId, setProfileId] = useState(defaultProfileId || profiles[0]?.id || "");
  const [measurementType, setMeasurementType] = useState("steps");
  const [measuredAt, setMeasuredAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [value, setValue] = useState("");
  const [secondaryValue, setSecondaryValue] = useState("");
  const [context, setContext] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const type = MEASUREMENT_TYPE_BY_VALUE[measurementType];

  async function save(event) {
    event.preventDefault(); setBusy(true); setMessage("");
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from("health_measurements").insert({
      workspace_id: workspaceId, profile_id: profileId,
      measured_at: new Date(measuredAt).toISOString(),
      measurement_type: measurementType,
      value_numeric: Number(value),
      secondary_value_numeric: type.secondaryLabel && secondaryValue !== "" ? Number(secondaryValue) : null,
      unit: type.unit,
      context: context.trim() || null,
      notes: notes.trim() || null,
      recorded_by: user.id,
    });
    setBusy(false);
    if (error) { setMessage(error.message); return; }
    setValue(""); setSecondaryValue(""); setContext(""); setNotes("");
    setMessage(`${type.label} saved.`);
    await onSaved();
  }

  return <Card title="Log a vital">
    <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
      <label className="text-sm font-bold">Person<select value={profileId} onChange={(event) => setProfileId(event.target.value)} required className="mt-1 w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2 dark:border-slate-600">{profiles.map((profile) => <option className="text-slate-950" key={profile.id} value={profile.id}>{profile.display_name}</option>)}</select></label>
      <label className="text-sm font-bold">Type<select value={measurementType} onChange={(event) => { setMeasurementType(event.target.value); setSecondaryValue(""); }} className="mt-1 w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2 dark:border-slate-600">{MEASUREMENT_TYPES.map((option) => <option className="text-slate-950" key={option.value} value={option.value}>{option.label}</option>)}</select></label>
      <label className="text-sm font-bold">Date<input type="date" value={measuredAt} onChange={(event) => setMeasuredAt(event.target.value)} required className="mt-1 w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2 dark:border-slate-600"/></label>
      <label className="text-sm font-bold">{type.primaryLabel || "Value"} ({type.unit})<input aria-label={type.primaryLabel || "Value"} type="number" step="any" value={value} onChange={(event) => setValue(event.target.value)} required className="mt-1 w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2 dark:border-slate-600"/></label>
      {type.secondaryLabel && <label className="text-sm font-bold">{type.secondaryLabel} ({type.unit})<input aria-label={type.secondaryLabel} type="number" step="any" value={secondaryValue} onChange={(event) => setSecondaryValue(event.target.value)} required className="mt-1 w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2 dark:border-slate-600"/></label>}
      <label className="text-sm font-bold">Context<input value={context} onChange={(event) => setContext(event.target.value)} placeholder="e.g. resting, after exercise" className="mt-1 w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2 dark:border-slate-600"/></label>
      <label className="text-sm font-bold">Notes<input value={notes} onChange={(event) => setNotes(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2 dark:border-slate-600"/></label>
      <button disabled={busy} className="rounded-xl bg-amber-400 px-4 py-3 font-black text-slate-950 disabled:opacity-50 sm:col-span-2">{busy ? "Saving…" : "Save vital"}</button>
    </form>
    {message && <p role="status" className="mt-4 rounded-xl bg-slate-100 p-3 text-sm font-bold dark:bg-slate-800">{message}</p>}
  </Card>;
}

const REGIMEN_CATEGORIES = [
  { value: "prescription", label: "Prescription" },
  { value: "supplement", label: "Supplement" },
  { value: "peptide", label: "Peptide" },
  { value: "other", label: "Other" },
];
function emptyRegimenRow() { return { name: "", dose: "", frequency: "", status: "active" }; }

// The document importer above is the only other way to add a regimen item, and it requires a
// photo -- there was never a manual entry path, so a typed list (a text message, an email) had no
// way in except photographing it and running it through OCR, adding parsing risk for data that was
// already typed correctly. This adds several items in one save without a photo.
function HealthRegimenBulkForm({ workspaceId, profiles, defaultProfileId, defaultCategory, onSaved }) {
  const supabase = useMemo(() => createClient(), []);
  const [profileId, setProfileId] = useState(defaultProfileId || profiles[0]?.id || "");
  const [category, setCategory] = useState(defaultCategory || "prescription");
  const [rows, setRows] = useState([emptyRegimenRow()]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  function updateRow(index, key, value) { setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: value } : row)); }
  function addRow() { setRows((current) => [...current, emptyRegimenRow()]); }
  function removeRow(index) { setRows((current) => current.length > 1 ? current.filter((_, rowIndex) => rowIndex !== index) : current); }

  async function save(event) {
    event.preventDefault(); setBusy(true); setMessage("");
    const filled = rows.filter((row) => row.name.trim());
    if (!filled.length) { setBusy(false); setMessage("Enter at least one name."); return; }
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from("health_regimen_items").insert(filled.map((row) => ({
      workspace_id: workspaceId, profile_id: profileId, category,
      name: row.name.trim(), dose: row.dose.trim() || null, frequency: row.frequency.trim() || null,
      status: row.status, created_by: user.id, updated_by: user.id,
    })));
    setBusy(false);
    if (error) { setMessage(error.message); return; }
    setRows([emptyRegimenRow()]);
    setMessage(`${filled.length} item${filled.length > 1 ? "s" : ""} saved.`);
    await onSaved();
  }

  return <Card title="Add items manually">
    <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">Type in prescriptions, supplements or peptides directly -- no photo needed. Add several rows, then save them together.</p>
    <form onSubmit={save} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-bold">Person<select value={profileId} onChange={(event) => setProfileId(event.target.value)} required className="mt-1 w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2 dark:border-slate-600">{profiles.map((profile) => <option className="text-slate-950" key={profile.id} value={profile.id}>{profile.display_name}</option>)}</select></label>
        <label className="text-sm font-bold">Category<select value={category} onChange={(event) => setCategory(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2 dark:border-slate-600">{REGIMEN_CATEGORIES.map((option) => <option className="text-slate-950" key={option.value} value={option.value}>{option.label}</option>)}</select></label>
      </div>
      <div className="space-y-2">
        {rows.map((row, index) => <div key={index} className="grid grid-cols-12 gap-2 rounded-xl bg-slate-100 p-3 dark:bg-slate-800">
          <input aria-label={`Name ${index + 1}`} value={row.name} onChange={(event) => updateRow(index, "name", event.target.value)} placeholder="Name" className="col-span-4 rounded-lg border bg-transparent px-2 py-1"/>
          <input aria-label={`Dose ${index + 1}`} value={row.dose} onChange={(event) => updateRow(index, "dose", event.target.value)} placeholder="Dose" className="col-span-3 rounded-lg border bg-transparent px-2 py-1"/>
          <input aria-label={`Frequency ${index + 1}`} value={row.frequency} onChange={(event) => updateRow(index, "frequency", event.target.value)} placeholder="Frequency" className="col-span-3 rounded-lg border bg-transparent px-2 py-1"/>
          <select aria-label={`Status ${index + 1}`} value={row.status} onChange={(event) => updateRow(index, "status", event.target.value)} className="col-span-1 rounded-lg border bg-transparent px-1 py-1 text-xs"><option value="active">Active</option><option value="planned">Planned</option><option value="paused">Paused</option><option value="stopped">Stopped</option></select>
          <button type="button" onClick={() => removeRow(index)} aria-label={`Remove item ${index + 1}`} className="col-span-1 rounded-lg bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-200">×</button>
        </div>)}
        <button type="button" onClick={addRow} className="rounded-xl bg-slate-200 px-3 py-1.5 text-sm font-black dark:bg-slate-700">+ Add another</button>
      </div>
      <button disabled={busy} className="rounded-xl bg-amber-400 px-4 py-3 font-black text-slate-950 disabled:opacity-50">{busy ? "Saving…" : "Save items"}</button>
    </form>
    {message && <p role="status" className="mt-4 rounded-xl bg-slate-100 p-3 text-sm font-bold dark:bg-slate-800">{message}</p>}
  </Card>;
}

function HealthProgramForm({ workspaceId, onSaved }) {
  const supabase = useMemo(() => createClient(), []);
  const [name, setName] = useState("");
  const [source, setSource] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function save(event) {
    event.preventDefault(); setBusy(true); setMessage("");
    const { data: { user } } = await supabase.auth.getUser();
    const id = crypto.randomUUID();
    const { error } = await supabase.from("health_programs").insert({
      id, workspace_id: workspaceId, name: name.trim(), source: source.trim() || null, notes: notes.trim() || null,
      created_by: user.id, updated_by: user.id,
    });
    setBusy(false);
    if (error) { setMessage(error.message); return; }
    setName(""); setSource(""); setNotes("");
    setMessage("Program created. Add its days below.");
    await onSaved(id);
  }

  return <Card title="Add a program">
    <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
      <label className="text-sm font-bold sm:col-span-2">Name<input value={name} onChange={(event) => setName(event.target.value)} required placeholder="Jeff Nippard's Legs/Push/Pull Hypertrophy — Block 1" className="mt-1 w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2 dark:border-slate-600"/></label>
      <label className="text-sm font-bold">Source<input value={source} onChange={(event) => setSource(event.target.value)} placeholder="e.g. Jeff Nippard" className="mt-1 w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2 dark:border-slate-600"/></label>
      <label className="text-sm font-bold">Notes<input value={notes} onChange={(event) => setNotes(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2 dark:border-slate-600"/></label>
      <button disabled={busy} className="rounded-xl bg-amber-400 px-4 py-3 font-black text-slate-950 disabled:opacity-50 sm:col-span-2">{busy ? "Saving…" : "Add program"}</button>
    </form>
    {message && <p role="status" className="mt-4 rounded-xl bg-slate-100 p-3 text-sm font-bold dark:bg-slate-800">{message}</p>}
  </Card>;
}

function emptyProgramExerciseRow() { return { name: "", sets: "", reps: "", intensity: "", notes: "" }; }

function HealthProgramDayForm({ workspaceId, programId, nextDayNumber, onSaved }) {
  const supabase = useMemo(() => createClient(), []);
  const [dayNumber, setDayNumber] = useState(nextDayNumber);
  const [title, setTitle] = useState("");
  const [rows, setRows] = useState([emptyProgramExerciseRow()]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  function updateRow(index, key, value) { setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: value } : row)); }
  function addRow() { setRows((current) => [...current, emptyProgramExerciseRow()]); }
  function removeRow(index) { setRows((current) => current.length > 1 ? current.filter((_, rowIndex) => rowIndex !== index) : current); }

  async function save(event) {
    event.preventDefault(); setBusy(true); setMessage("");
    const exercises = rows.filter((row) => row.name.trim()).map((row) => ({
      name: row.name.trim(), sets: row.sets.trim() || null, reps: row.reps.trim() || null,
      intensity: row.intensity.trim() || null, notes: row.notes.trim() || null,
    }));
    if (!title.trim() || !exercises.length) { setBusy(false); setMessage("Enter a day title and at least one exercise."); return; }
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from("health_program_days").insert({
      workspace_id: workspaceId, program_id: programId, day_number: Number(dayNumber), title: title.trim(),
      exercises, created_by: user.id, updated_by: user.id,
    });
    setBusy(false);
    if (error) { setMessage(error.message); return; }
    setTitle(""); setRows([emptyProgramExerciseRow()]);
    setMessage("Day saved.");
    await onSaved();
  }

  return <Card title="Add a day">
    <form onSubmit={save} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm font-bold">Day #<input type="number" min="1" value={dayNumber} onChange={(event) => setDayNumber(event.target.value)} required className="mt-1 w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2 dark:border-slate-600"/></label>
        <label className="text-sm font-bold sm:col-span-2">Title<input value={title} onChange={(event) => setTitle(event.target.value)} required placeholder="Legs #1" className="mt-1 w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2 dark:border-slate-600"/></label>
      </div>
      <div className="space-y-2">
        {rows.map((row, index) => <div key={index} className="grid grid-cols-12 gap-2 rounded-xl bg-slate-100 p-3 dark:bg-slate-800">
          <input aria-label={`Exercise ${index + 1}`} value={row.name} onChange={(event) => updateRow(index, "name", event.target.value)} placeholder="Exercise" className="col-span-4 rounded-lg border bg-transparent px-2 py-1"/>
          <input aria-label={`Sets ${index + 1}`} value={row.sets} onChange={(event) => updateRow(index, "sets", event.target.value)} placeholder="Sets" className="col-span-1 rounded-lg border bg-transparent px-2 py-1"/>
          <input aria-label={`Reps ${index + 1}`} value={row.reps} onChange={(event) => updateRow(index, "reps", event.target.value)} placeholder="Reps" className="col-span-2 rounded-lg border bg-transparent px-2 py-1"/>
          <input aria-label={`Intensity ${index + 1}`} value={row.intensity} onChange={(event) => updateRow(index, "intensity", event.target.value)} placeholder="RPE / %1RM" className="col-span-2 rounded-lg border bg-transparent px-2 py-1"/>
          <input aria-label={`Exercise notes ${index + 1}`} value={row.notes} onChange={(event) => updateRow(index, "notes", event.target.value)} placeholder="Notes" className="col-span-2 rounded-lg border bg-transparent px-2 py-1"/>
          <button type="button" onClick={() => removeRow(index)} aria-label={`Remove exercise ${index + 1}`} className="col-span-1 rounded-lg bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-200">×</button>
        </div>)}
        <button type="button" onClick={addRow} className="rounded-xl bg-slate-200 px-3 py-1.5 text-sm font-black dark:bg-slate-700">+ Add exercise</button>
      </div>
      <button disabled={busy} className="rounded-xl bg-amber-400 px-4 py-3 font-black text-slate-950 disabled:opacity-50">{busy ? "Saving…" : "Save day"}</button>
    </form>
    {message && <p role="status" className="mt-4 rounded-xl bg-slate-100 p-3 text-sm font-bold dark:bg-slate-800">{message}</p>}
  </Card>;
}

function DeleteButton({ label, onDelete }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!confirming) return <button type="button" onClick={() => setConfirming(true)} aria-label={label} className="rounded-lg bg-red-100 px-2 py-1 text-xs font-black text-red-700 dark:bg-red-950 dark:text-red-200">Delete</button>;
  return <button type="button" disabled={busy} onClick={async () => { setBusy(true); await onDelete(); setBusy(false); }} aria-label={`Confirm ${label.toLowerCase()}`} className="rounded-lg bg-red-600 px-2 py-1 text-xs font-black text-white disabled:opacity-50">{busy ? "…" : "Confirm?"}</button>;
}

function HealthRegimenItemCard({ item, onChanged }) {
  const supabase = useMemo(() => createClient(), []);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: item.name, dose: item.dose || "", route: item.route || "", frequency: item.frequency || "", instructions: item.instructions || "", status: item.status });

  async function save() {
    setBusy(true);
    const { error } = await supabase.from("health_regimen_items").update({
      name: form.name.trim(), dose: form.dose.trim() || null, route: form.route.trim() || null,
      frequency: form.frequency.trim() || null, instructions: form.instructions.trim() || null, status: form.status,
    }).eq("id", item.id);
    setBusy(false);
    if (!error) { setEditing(false); await onChanged(); }
  }
  async function remove() { const { error } = await supabase.from("health_regimen_items").delete().eq("id", item.id); if (!error) await onChanged(); }

  if (editing) return <div className="space-y-2 rounded-xl bg-slate-100 p-4 dark:bg-slate-800">
    <input aria-label="Name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Name" className="w-full rounded-lg border bg-transparent px-2 py-1"/>
    <div className="grid grid-cols-2 gap-2">
      <input aria-label="Dose" value={form.dose} onChange={(event) => setForm({ ...form, dose: event.target.value })} placeholder="Dose" className="rounded-lg border bg-transparent px-2 py-1"/>
      <input aria-label="Route" value={form.route} onChange={(event) => setForm({ ...form, route: event.target.value })} placeholder="Route" className="rounded-lg border bg-transparent px-2 py-1"/>
      <input aria-label="Frequency" value={form.frequency} onChange={(event) => setForm({ ...form, frequency: event.target.value })} placeholder="Frequency" className="rounded-lg border bg-transparent px-2 py-1"/>
      <select aria-label="Status" value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })} className="rounded-lg border bg-transparent px-2 py-1"><option value="active">Active</option><option value="paused">Paused</option><option value="stopped">Stopped</option><option value="planned">Planned</option></select>
    </div>
    <input aria-label="Instructions" value={form.instructions} onChange={(event) => setForm({ ...form, instructions: event.target.value })} placeholder="Instructions" className="w-full rounded-lg border bg-transparent px-2 py-1"/>
    <div className="flex gap-2"><button type="button" onClick={save} disabled={busy} className="rounded-lg bg-emerald-500 px-3 py-1 text-xs font-black text-slate-950 disabled:opacity-50">{busy ? "Saving…" : "Save"}</button><button type="button" onClick={() => setEditing(false)} className="rounded-lg bg-slate-200 px-3 py-1 text-xs font-black dark:bg-slate-700">Cancel</button></div>
  </div>;

  return <div className="rounded-xl bg-slate-100 p-4 dark:bg-slate-800">
    <div className="flex items-start justify-between gap-2">
      <div><p className="font-black">{item.name}</p><span className="text-xs font-black uppercase text-emerald-600">{item.status}</span><p className="text-sm">{[item.dose, item.route, item.frequency].filter(Boolean).join(" · ")}</p></div>
      <div className="flex shrink-0 gap-1"><button type="button" onClick={() => setEditing(true)} aria-label={`Edit ${item.name}`} className="rounded-lg bg-slate-200 px-2 py-1 text-xs font-black dark:bg-slate-700">Edit</button><DeleteButton label={`Delete ${item.name}`} onDelete={remove}/></div>
    </div>
  </div>;
}

function HealthLabResultRow({ point, onChanged }) {
  const supabase = useMemo(() => createClient(), []);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ collectedOn: point.collected_on, valueNumeric: point.value_numeric ?? "", unit: point.unit || "", referenceLow: point.reference_low ?? "", referenceHigh: point.reference_high ?? "", flag: point.flag || "unknown" });

  async function save() {
    setBusy(true);
    const { error } = await supabase.from("health_lab_results").update({
      collected_on: form.collectedOn,
      value_numeric: form.valueNumeric === "" ? null : Number(form.valueNumeric),
      unit: form.unit.trim() || null,
      reference_low: form.referenceLow === "" ? null : Number(form.referenceLow),
      reference_high: form.referenceHigh === "" ? null : Number(form.referenceHigh),
      flag: form.flag,
    }).eq("id", point.id);
    setBusy(false);
    if (!error) { setEditing(false); await onChanged(); }
  }
  async function remove() { const { error } = await supabase.from("health_lab_results").delete().eq("id", point.id); if (!error) await onChanged(); }

  if (editing) return <div className="grid grid-cols-2 items-center gap-1 rounded-lg bg-slate-200 p-2 text-sm dark:bg-slate-700 sm:grid-cols-7">
    <input aria-label="Collection date" type="date" value={form.collectedOn} onChange={(event) => setForm({ ...form, collectedOn: event.target.value })} className="col-span-2 rounded border bg-transparent px-1 py-0.5 sm:col-span-1"/>
    <input aria-label="Value" value={form.valueNumeric} onChange={(event) => setForm({ ...form, valueNumeric: event.target.value })} placeholder="Value" className="rounded border bg-transparent px-1 py-0.5"/>
    <input aria-label="Unit" value={form.unit} onChange={(event) => setForm({ ...form, unit: event.target.value })} placeholder="Unit" className="rounded border bg-transparent px-1 py-0.5"/>
    <input aria-label="Reference low" value={form.referenceLow} onChange={(event) => setForm({ ...form, referenceLow: event.target.value })} placeholder="Ref low" className="rounded border bg-transparent px-1 py-0.5"/>
    <input aria-label="Reference high" value={form.referenceHigh} onChange={(event) => setForm({ ...form, referenceHigh: event.target.value })} placeholder="Ref high" className="rounded border bg-transparent px-1 py-0.5"/>
    <select aria-label="Flag" value={form.flag} onChange={(event) => setForm({ ...form, flag: event.target.value })} className="rounded border bg-transparent px-1 py-0.5"><option value="unknown">Unknown</option><option value="normal">Normal</option><option value="low">Low</option><option value="high">High</option><option value="critical">Critical</option></select>
    <div className="col-span-2 flex gap-1 sm:col-span-1"><button type="button" onClick={save} disabled={busy} className="rounded bg-emerald-500 px-2 py-0.5 text-xs font-black text-slate-950 disabled:opacity-50">{busy ? "…" : "Save"}</button><button type="button" onClick={() => setEditing(false)} className="rounded bg-slate-300 px-2 py-0.5 text-xs font-black dark:bg-slate-600">Cancel</button></div>
  </div>;

  return <div className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-2 py-1 text-xs dark:bg-slate-800/50">
    <span>{point.collected_on} — {point.value_numeric ?? point.value_text} {point.unit}</span>
    <div className="flex shrink-0 gap-1"><button type="button" onClick={() => setEditing(true)} aria-label={`Edit ${point.marker_name} result from ${point.collected_on}`} className="rounded bg-slate-200 px-2 py-0.5 font-black dark:bg-slate-700">Edit</button><DeleteButton label={`Delete ${point.marker_name} result from ${point.collected_on}`} onDelete={remove}/></div>
  </div>;
}

function HealthWorkoutCard({ workout, onChanged }) {
  const supabase = useMemo(() => createClient(), []);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    performedAt: workout.performed_at.slice(0, 10), workoutType: workout.workout_type,
    durationMinutes: workout.duration_minutes ?? "", perceivedExertion: workout.perceived_exertion ?? "",
    notes: workout.notes || "",
    exercises: (workout.details?.length ? workout.details : [{}]).map((row) => ({ exercise: row.exercise || "", sets: row.sets ?? "", reps: row.reps || "", weight: row.weight || "" })),
  });

  function updateExercise(index, key, value) { setForm((current) => ({ ...current, exercises: current.exercises.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: value } : row) })); }
  function addExercise() { setForm((current) => ({ ...current, exercises: [...current.exercises, { exercise: "", sets: "", reps: "", weight: "" }] })); }
  function removeExercise(index) { setForm((current) => ({ ...current, exercises: current.exercises.length > 1 ? current.exercises.filter((_, rowIndex) => rowIndex !== index) : current.exercises })); }

  async function save() {
    setBusy(true);
    const details = form.exercises.filter((row) => row.exercise.trim()).map((row) => ({ exercise: row.exercise.trim(), sets: row.sets ? Number(row.sets) : null, reps: row.reps.trim() || null, weight: row.weight.trim() || null }));
    const { error } = await supabase.from("health_workouts").update({
      performed_at: new Date(form.performedAt).toISOString(),
      workout_type: form.workoutType.trim() || "Workout",
      duration_minutes: form.durationMinutes ? Number(form.durationMinutes) : null,
      perceived_exertion: form.perceivedExertion ? Number(form.perceivedExertion) : null,
      notes: form.notes.trim() || null,
      details,
    }).eq("id", workout.id);
    setBusy(false);
    if (!error) { setEditing(false); await onChanged(); }
  }
  async function remove() { const { error } = await supabase.from("health_workouts").delete().eq("id", workout.id); if (!error) await onChanged(); }

  if (editing) return <div className="space-y-2 rounded-xl bg-slate-100 p-4 dark:bg-slate-800">
    <div className="grid grid-cols-2 gap-2">
      <input aria-label="Date" type="date" value={form.performedAt} onChange={(event) => setForm({ ...form, performedAt: event.target.value })} className="rounded-lg border bg-transparent px-2 py-1"/>
      <input aria-label="Workout type" value={form.workoutType} onChange={(event) => setForm({ ...form, workoutType: event.target.value })} placeholder="Workout type" className="rounded-lg border bg-transparent px-2 py-1"/>
      <input aria-label="Duration (minutes)" type="number" value={form.durationMinutes} onChange={(event) => setForm({ ...form, durationMinutes: event.target.value })} placeholder="Duration (min)" className="rounded-lg border bg-transparent px-2 py-1"/>
      <input aria-label="Perceived exertion" type="number" min="1" max="10" value={form.perceivedExertion} onChange={(event) => setForm({ ...form, perceivedExertion: event.target.value })} placeholder="RPE" className="rounded-lg border bg-transparent px-2 py-1"/>
    </div>
    <input aria-label="Notes" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Notes" className="w-full rounded-lg border bg-transparent px-2 py-1"/>
    <div className="space-y-1">
      {form.exercises.map((row, index) => <div key={index} className="grid grid-cols-12 gap-1">
        <input aria-label={`Exercise ${index + 1}`} value={row.exercise} onChange={(event) => updateExercise(index, "exercise", event.target.value)} placeholder="Exercise" className="col-span-5 rounded border bg-transparent px-1 py-0.5 text-sm"/>
        <input aria-label={`Sets ${index + 1}`} value={row.sets} onChange={(event) => updateExercise(index, "sets", event.target.value)} placeholder="Sets" className="col-span-2 rounded border bg-transparent px-1 py-0.5 text-sm"/>
        <input aria-label={`Reps ${index + 1}`} value={row.reps} onChange={(event) => updateExercise(index, "reps", event.target.value)} placeholder="Reps" className="col-span-2 rounded border bg-transparent px-1 py-0.5 text-sm"/>
        <input aria-label={`Weight ${index + 1}`} value={row.weight} onChange={(event) => updateExercise(index, "weight", event.target.value)} placeholder="Weight" className="col-span-2 rounded border bg-transparent px-1 py-0.5 text-sm"/>
        <button type="button" onClick={() => removeExercise(index)} aria-label={`Remove exercise ${index + 1}`} className="col-span-1 rounded bg-red-100 text-xs font-black text-red-700 dark:bg-red-950 dark:text-red-200">×</button>
      </div>)}
      <button type="button" onClick={addExercise} className="rounded-lg bg-slate-200 px-2 py-1 text-xs font-black dark:bg-slate-700">+ Add exercise</button>
    </div>
    <div className="flex gap-2"><button type="button" onClick={save} disabled={busy} className="rounded-lg bg-emerald-500 px-3 py-1 text-xs font-black text-slate-950 disabled:opacity-50">{busy ? "Saving…" : "Save"}</button><button type="button" onClick={() => setEditing(false)} className="rounded-lg bg-slate-200 px-3 py-1 text-xs font-black dark:bg-slate-700">Cancel</button></div>
  </div>;

  return <div className="rounded-xl bg-slate-100 p-4 dark:bg-slate-800">
    <div className="flex items-start justify-between gap-2">
      <div className="flex-1">
        <div className="flex justify-between"><p className="font-black">{workout.workout_type}</p><span className="text-xs text-slate-500 dark:text-slate-400">{workoutDateLabel(workout.performed_at)}</span></div>
        <p className="text-sm">{[workout.duration_minutes ? `${workout.duration_minutes} min` : null, workout.perceived_exertion ? `RPE ${workout.perceived_exertion}` : null].filter(Boolean).join(" · ")}</p>
        {(workout.details || []).length > 0 && <ul className="mt-2 space-y-1 text-sm">{workout.details.map((exercise, index) => <li key={index}>{[exercise.exercise, exercise.sets && exercise.reps ? `${exercise.sets}×${exercise.reps}` : exercise.reps, exercise.weight ? `@ ${exercise.weight}` : null].filter(Boolean).join(" — ")}</li>)}</ul>}
        {workout.notes && <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{workout.notes}</p>}
      </div>
      <div className="flex shrink-0 gap-1"><button type="button" onClick={() => setEditing(true)} aria-label={`Edit workout on ${workoutDateLabel(workout.performed_at)}`} className="rounded-lg bg-slate-200 px-2 py-1 text-xs font-black dark:bg-slate-700">Edit</button><DeleteButton label={`Delete workout on ${workoutDateLabel(workout.performed_at)}`} onDelete={remove}/></div>
    </div>
  </div>;
}

function HealthMeasurementCard({ measurement, onChanged }) {
  const supabase = useMemo(() => createClient(), []);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const type = MEASUREMENT_TYPE_BY_VALUE[measurement.measurement_type];
  const [form, setForm] = useState({
    measuredAt: measurement.measured_at.slice(0, 10), value: measurement.value_numeric ?? "",
    secondaryValue: measurement.secondary_value_numeric ?? "", context: measurement.context || "", notes: measurement.notes || "",
  });

  async function save() {
    setBusy(true);
    const { error } = await supabase.from("health_measurements").update({
      measured_at: new Date(form.measuredAt).toISOString(),
      value_numeric: form.value === "" ? null : Number(form.value),
      secondary_value_numeric: type?.secondaryLabel && form.secondaryValue !== "" ? Number(form.secondaryValue) : null,
      context: form.context.trim() || null,
      notes: form.notes.trim() || null,
    }).eq("id", measurement.id);
    setBusy(false);
    if (!error) { setEditing(false); await onChanged(); }
  }
  async function remove() { const { error } = await supabase.from("health_measurements").delete().eq("id", measurement.id); if (!error) await onChanged(); }

  if (editing) return <div className="space-y-2 rounded-xl bg-slate-100 p-4 dark:bg-slate-800">
    <div className="grid grid-cols-2 gap-2">
      <input aria-label="Date" type="date" value={form.measuredAt} onChange={(event) => setForm({ ...form, measuredAt: event.target.value })} className="rounded-lg border bg-transparent px-2 py-1"/>
      <input aria-label={type?.primaryLabel || "Value"} type="number" step="any" value={form.value} onChange={(event) => setForm({ ...form, value: event.target.value })} placeholder={type?.primaryLabel || "Value"} className="rounded-lg border bg-transparent px-2 py-1"/>
      {type?.secondaryLabel && <input aria-label={type.secondaryLabel} type="number" step="any" value={form.secondaryValue} onChange={(event) => setForm({ ...form, secondaryValue: event.target.value })} placeholder={type.secondaryLabel} className="rounded-lg border bg-transparent px-2 py-1"/>}
      <input aria-label="Context" value={form.context} onChange={(event) => setForm({ ...form, context: event.target.value })} placeholder="Context" className="rounded-lg border bg-transparent px-2 py-1"/>
    </div>
    <input aria-label="Notes" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Notes" className="w-full rounded-lg border bg-transparent px-2 py-1"/>
    <div className="flex gap-2"><button type="button" onClick={save} disabled={busy} className="rounded-lg bg-emerald-500 px-3 py-1 text-xs font-black text-slate-950 disabled:opacity-50">{busy ? "Saving…" : "Save"}</button><button type="button" onClick={() => setEditing(false)} className="rounded-lg bg-slate-200 px-3 py-1 text-xs font-black dark:bg-slate-700">Cancel</button></div>
  </div>;

  return <div className="rounded-xl bg-slate-100 p-4 dark:bg-slate-800">
    <div className="flex items-start justify-between gap-2">
      <div>
        <div className="flex items-baseline gap-2"><p className="font-black">{type?.label || measurement.measurement_type}</p><span className="text-xs text-slate-500 dark:text-slate-400">{workoutDateLabel(measurement.measured_at)}</span></div>
        <p className="text-sm font-bold">{measurement.value_numeric}{measurement.secondary_value_numeric != null ? `/${measurement.secondary_value_numeric}` : ""} {measurement.unit}</p>
        {measurement.context && <p className="text-xs text-slate-500 dark:text-slate-400">{measurement.context}</p>}
        {measurement.notes && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{measurement.notes}</p>}
      </div>
      <div className="flex shrink-0 gap-1"><button type="button" onClick={() => setEditing(true)} aria-label={`Edit ${type?.label || measurement.measurement_type} from ${workoutDateLabel(measurement.measured_at)}`} className="rounded-lg bg-slate-200 px-2 py-1 text-xs font-black dark:bg-slate-700">Edit</button><DeleteButton label={`Delete ${type?.label || measurement.measurement_type} from ${workoutDateLabel(measurement.measured_at)}`} onDelete={remove}/></div>
    </div>
  </div>;
}

function HealthProgramDayCard({ day, onChanged }) {
  const supabase = useMemo(() => createClient(), []);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    dayNumber: day.day_number, title: day.title,
    exercises: (day.exercises?.length ? day.exercises : [{}]).map((row) => ({ name: row.name || "", sets: row.sets || "", reps: row.reps || "", intensity: row.intensity || "", notes: row.notes || "" })),
  });

  function updateExercise(index, key, value) { setForm((current) => ({ ...current, exercises: current.exercises.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: value } : row) })); }
  function addExercise() { setForm((current) => ({ ...current, exercises: [...current.exercises, { name: "", sets: "", reps: "", intensity: "", notes: "" }] })); }
  function removeExercise(index) { setForm((current) => ({ ...current, exercises: current.exercises.length > 1 ? current.exercises.filter((_, rowIndex) => rowIndex !== index) : current.exercises })); }

  async function save() {
    setBusy(true);
    const exercises = form.exercises.filter((row) => row.name.trim()).map((row) => ({ name: row.name.trim(), sets: row.sets.trim() || null, reps: row.reps.trim() || null, intensity: row.intensity.trim() || null, notes: row.notes.trim() || null }));
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from("health_program_days").update({
      day_number: Number(form.dayNumber), title: form.title.trim(), exercises, updated_by: user.id,
    }).eq("id", day.id);
    setBusy(false);
    if (!error) { setEditing(false); await onChanged(); }
  }
  async function remove() { const { error } = await supabase.from("health_program_days").delete().eq("id", day.id); if (!error) await onChanged(); }

  if (editing) return <div className="space-y-2 rounded-xl bg-slate-100 p-4 dark:bg-slate-800">
    <div className="grid grid-cols-4 gap-2">
      <input aria-label="Day number" type="number" min="1" value={form.dayNumber} onChange={(event) => setForm({ ...form, dayNumber: event.target.value })} className="rounded-lg border bg-transparent px-2 py-1"/>
      <input aria-label="Day title" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Title" className="col-span-3 rounded-lg border bg-transparent px-2 py-1"/>
    </div>
    <div className="space-y-1">
      {form.exercises.map((row, index) => <div key={index} className="grid grid-cols-12 gap-1">
        <input aria-label={`Exercise ${index + 1}`} value={row.name} onChange={(event) => updateExercise(index, "name", event.target.value)} placeholder="Exercise" className="col-span-4 rounded border bg-transparent px-1 py-0.5 text-sm"/>
        <input aria-label={`Sets ${index + 1}`} value={row.sets} onChange={(event) => updateExercise(index, "sets", event.target.value)} placeholder="Sets" className="col-span-1 rounded border bg-transparent px-1 py-0.5 text-sm"/>
        <input aria-label={`Reps ${index + 1}`} value={row.reps} onChange={(event) => updateExercise(index, "reps", event.target.value)} placeholder="Reps" className="col-span-2 rounded border bg-transparent px-1 py-0.5 text-sm"/>
        <input aria-label={`Intensity ${index + 1}`} value={row.intensity} onChange={(event) => updateExercise(index, "intensity", event.target.value)} placeholder="RPE / %1RM" className="col-span-2 rounded border bg-transparent px-1 py-0.5 text-sm"/>
        <input aria-label={`Exercise notes ${index + 1}`} value={row.notes} onChange={(event) => updateExercise(index, "notes", event.target.value)} placeholder="Notes" className="col-span-2 rounded border bg-transparent px-1 py-0.5 text-sm"/>
        <button type="button" onClick={() => removeExercise(index)} aria-label={`Remove exercise ${index + 1}`} className="col-span-1 rounded bg-red-100 text-xs font-black text-red-700 dark:bg-red-950 dark:text-red-200">×</button>
      </div>)}
      <button type="button" onClick={addExercise} className="rounded-lg bg-slate-200 px-2 py-1 text-xs font-black dark:bg-slate-700">+ Add exercise</button>
    </div>
    <div className="flex gap-2"><button type="button" onClick={save} disabled={busy} className="rounded-lg bg-emerald-500 px-3 py-1 text-xs font-black text-slate-950 disabled:opacity-50">{busy ? "Saving…" : "Save"}</button><button type="button" onClick={() => setEditing(false)} className="rounded-lg bg-slate-200 px-3 py-1 text-xs font-black dark:bg-slate-700">Cancel</button></div>
  </div>;

  return <div className="rounded-xl bg-slate-100 p-4 dark:bg-slate-800">
    <div className="flex items-start justify-between gap-2">
      <p className="font-black">Day {day.day_number} — {day.title}</p>
      <div className="flex shrink-0 gap-1"><button type="button" onClick={() => setEditing(true)} aria-label={`Edit Day ${day.day_number}`} className="rounded-lg bg-slate-200 px-2 py-1 text-xs font-black dark:bg-slate-700">Edit</button><DeleteButton label={`Delete Day ${day.day_number}`} onDelete={remove}/></div>
    </div>
    {(day.exercises || []).length > 0 && <div className="mt-2 overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead><tr className="text-xs text-slate-500 dark:text-slate-400"><th className="pr-2 font-bold">Exercise</th><th className="pr-2 font-bold">Sets</th><th className="pr-2 font-bold">Reps</th><th className="pr-2 font-bold">Intensity</th></tr></thead>
        <tbody>{day.exercises.map((exercise, index) => <tr key={index} className="border-t border-slate-200 dark:border-slate-700"><td className="py-1 pr-2 font-bold">{exercise.name}</td><td className="py-1 pr-2">{exercise.sets}</td><td className="py-1 pr-2">{exercise.reps}</td><td className="py-1 pr-2">{exercise.intensity}</td></tr>)}</tbody>
      </table>
    </div>}
  </div>;
}

export default function HealthDashboard({ initialMembership }) {
  const supabase = useMemo(() => createClient(), []);
  const [workspaceId, setWorkspaceId] = useState(initialMembership?.workspace_id ?? null);
  const [activeTab, setActiveTab] = useState("Overview");
  const [loading, setLoading] = useState(Boolean(workspaceId));
  const [error, setError] = useState("");
  const [dependentName, setDependentName] = useState("");
  const [dependentRelationship, setDependentRelationship] = useState("");
  const [data, setData] = useState({ profiles: [], conditions: [], careTeam: [], labs: [], regimen: [], measurements: [], workouts: [], timeline: [], programs: [], programDays: [] });
  const [viewProfileId, setViewProfileId] = useState(null);
  const [currentUserEmail, setCurrentUserEmail] = useState(null);
  const [selectedProgramId, setSelectedProgramId] = useState(null);

  // Programs are shared workspace-wide reference material (not scoped to one profile, unlike
  // Labs/Regimen/Workouts) -- either household member can follow the same program. Defaults to the
  // first program once one exists.
  useEffect(() => {
    if (selectedProgramId || !data.programs.length) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate one-time default, guarded above so it never loops
    setSelectedProgramId(data.programs[0].id);
  }, [data.programs, selectedProgramId]);

  useEffect(() => { supabase.auth.getUser().then(({ data: authData }) => setCurrentUserEmail(authData?.user?.email ?? null)); }, [supabase]);

  // Every list below (Overview counts, Labs charts, Regimen, Workouts) is scoped to exactly one
  // profile at a time -- household members share this workspace but not every medication, lab
  // result or workout, so nothing here is ever shown mixed across people. Defaults to the signed-in
  // member's own profile once profiles load, falling back to the first profile if no email match.
  useEffect(() => {
    if (viewProfileId || !data.profiles.length) return;
    const own = currentUserEmail && data.profiles.find((profile) => profile.display_name === currentUserEmail);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate one-time default once profiles/email are known, guarded above so it never loops
    setViewProfileId((own || data.profiles[0]).id);
    // viewProfileId is intentionally omitted -- including it would refire this default the instant
    // it's set, fighting a manual selection from the "Viewing" switcher.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.profiles, currentUserEmail]);

  async function load(id = workspaceId) {
    if (!id) return;
    setError("");
    const tables = [
      ["profiles", "health_profiles", "display_name"], ["labs", "health_lab_results", "collected_on"],
      ["conditions", "health_conditions", "name"], ["careTeam", "health_care_team", "clinician_name"],
      ["regimen", "health_regimen_items", "name"], ["measurements", "health_measurements", "measured_at"],
      ["workouts", "health_workouts", "performed_at"], ["timeline", "health_clinical_timeline", "occurred_on"],
      ["programs", "health_programs", "name"], ["programDays", "health_program_days", "day_number"],
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

  const viewLabs = data.labs.filter((lab) => lab.profile_id === viewProfileId);
  const viewRegimen = data.regimen.filter((item) => item.profile_id === viewProfileId);
  const viewWorkouts = data.workouts.filter((workout) => workout.profile_id === viewProfileId);
  const viewMeasurements = data.measurements.filter((measurement) => measurement.profile_id === viewProfileId);
  const activeRegimen = viewRegimen.filter((item) => item.status === "active");
  const latestLabs = viewLabs.slice(0, 8);
  const viewingProfile = data.profiles.find((profile) => profile.id === viewProfileId);
  return <main className="min-h-screen bg-slate-100 p-4 text-slate-950 dark:bg-slate-950 dark:text-white sm:p-6">
    <div className="mx-auto max-w-7xl">
      <p className="text-xs font-black uppercase tracking-[.24em] text-amber-600 dark:text-amber-400">FORGE Application</p>
      <h1 className="text-3xl font-black">Health</h1>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Shared private health history, regimen, laboratory trends, peptides, and training.</p>
      <div className="mt-5 flex flex-wrap gap-2">{tabs.map((tab) => <button key={tab} onClick={() => setActiveTab(tab)} className={`rounded-xl px-4 py-2 text-sm font-black ${activeTab === tab ? "bg-amber-400 text-slate-950" : "bg-slate-200 dark:bg-slate-800"}`}>{tab}</button>)}</div>
      {data.profiles.length > 0 && <div className="mt-3 flex flex-wrap items-center gap-2"><span className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">Viewing:</span>{data.profiles.map((profile) => <button key={profile.id} onClick={() => setViewProfileId(profile.id)} className={`rounded-full px-3 py-1 text-xs font-black ${viewProfileId === profile.id ? "bg-amber-400 text-slate-950" : "bg-slate-200 dark:bg-slate-800"}`}>{profile.display_name}</button>)}</div>}
      {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 font-bold text-red-700 dark:bg-red-950 dark:text-red-200">{error}</p>}
      {loading ? <p className="mt-8 font-bold">Loading private health records…</p> : <div className="mt-6 grid gap-5 lg:grid-cols-2">
        {activeTab === "Overview" && <>
          <Card title="Household profiles"><div className="space-y-3">{data.profiles.map((profile) => <div key={profile.id} className="rounded-xl bg-slate-100 p-4 dark:bg-slate-800"><p className="font-black">{profile.display_name}</p><p className="text-xs text-slate-500 dark:text-slate-400">{profile.profile_type === "managed_dependent" ? `Managed ${profile.relationship || "dependent"}` : "Private household member"} · {data.conditions.filter((condition) => condition.profile_id === profile.id && condition.status === "active").length} active conditions · {activeRegimen.filter((item) => item.profile_id === profile.id).length} active regimen items</p></div>)}</div><form onSubmit={addDependent} className="mt-4 grid gap-2 sm:grid-cols-2"><input aria-label="Dependent full name" required value={dependentName} onChange={(event) => setDependentName(event.target.value)} placeholder="Dependent full name" className="rounded-xl border border-slate-300 bg-transparent px-3 py-2 dark:border-slate-600"/><input aria-label="Relationship" required value={dependentRelationship} onChange={(event) => setDependentRelationship(event.target.value)} placeholder="Relationship, such as mother" className="rounded-xl border border-slate-300 bg-transparent px-3 py-2 dark:border-slate-600"/><button className="rounded-xl bg-slate-950 px-4 py-2 font-black text-white dark:bg-amber-400 dark:text-slate-950 sm:col-span-2">Add managed dependent</button></form></Card>
          <Card title="Current regimen"><p className="text-3xl font-black text-emerald-600">{activeRegimen.length}</p><p className="text-sm text-slate-500">active prescriptions, supplements, and peptides for {viewingProfile?.display_name || "the selected person"}</p></Card>
          <Card title="Latest laboratory results">{latestLabs.length ? <div className="space-y-2">{latestLabs.map((lab) => <div key={lab.id} className="flex justify-between gap-4 border-b border-slate-200 py-2 dark:border-slate-700"><span className="font-bold">{lab.marker_name}</span><span className={lab.flag === "high" || lab.flag === "critical" ? "font-black text-red-600" : "font-black"}>{lab.value_numeric ?? lab.value_text} {lab.unit}</span></div>)}</div> : <p className="text-sm text-slate-500">No structured lab results yet for {viewingProfile?.display_name || "the selected person"}.</p>}</Card>
          <Card title="Activity"><div className="grid grid-cols-3 gap-3 text-center"><div><p className="text-2xl font-black">{data.measurements.filter((m) => m.profile_id === viewProfileId).length}</p><p className="text-xs">measurements</p></div><div><p className="text-2xl font-black">{viewWorkouts.length}</p><p className="text-xs">workouts</p></div><div><p className="text-2xl font-black">{data.timeline.filter((t) => t.profile_id === viewProfileId).length}</p><p className="text-xs">timeline events</p></div></div></Card>
        </>}
        {activeTab === "Labs" && (() => {
          const groupedViewLabs = groupLabsByMarker(viewLabs);
          const { narrow: narrowTier, wide: wideTier } = splitLabTiers(groupedViewLabs);
          const hasCombinableTrend = Object.values(groupedViewLabs).some((points) => points.length >= 2);
          return <>
            <HealthDocumentImporter workspaceId={workspaceId} profiles={data.profiles} defaultProfileId={viewProfileId} defaultCategory="lab_report" onConfirmed={() => load(workspaceId)}/>
            {viewLabs.length > 0 && <Card title={`Combined trends — ${viewingProfile?.display_name || ""}`}>
              {hasCombinableTrend ? <div className="space-y-4">
                <HealthLabCombinedTrendChart title="Narrow-range markers" groupedLabs={narrowTier}/>
                <HealthLabCombinedTrendChart title="Wide-range markers" groupedLabs={wideTier}/>
              </div> : <p className="text-sm text-slate-500">Once a marker has a second draw on file, its trend joins a combined chart here.</p>}
            </Card>}
            <Card title={`Laboratory history — ${viewingProfile?.display_name || ""}`}>{viewLabs.length ? <div className="space-y-4">{Object.entries(groupedViewLabs).map(([markerName, points]) => <div key={markerName}><HealthLabTrendChart markerName={markerName} points={points}/><div className="mt-1 space-y-1">{points.map((point) => <HealthLabResultRow key={point.id} point={point} onChanged={() => load(workspaceId)}/>)}</div></div>)}</div> : <p className="text-sm text-slate-500">Structured results and trend charts will appear here. The database preserves values, units, ranges, flags, dates, panels and source documents independently.</p>}</Card>
          </>;
        })()}
        {activeTab === "Regimen" && <><HealthDocumentImporter workspaceId={workspaceId} profiles={data.profiles} defaultProfileId={viewProfileId} defaultCategory="medication_label" onConfirmed={() => load(workspaceId)}/><HealthRegimenBulkForm workspaceId={workspaceId} profiles={data.profiles} defaultProfileId={viewProfileId} defaultCategory="prescription" onSaved={() => load(workspaceId)}/><Card title={`Prescriptions and supplements — ${viewingProfile?.display_name || ""}`}><div className="space-y-3">{viewRegimen.filter((x) => x.category !== "peptide").map((item) => <HealthRegimenItemCard key={item.id} item={item} onChanged={() => load(workspaceId)}/>)}{!viewRegimen.filter((x) => x.category !== "peptide").length && <p className="text-sm text-slate-500">No prescriptions or supplements logged yet for {viewingProfile?.display_name || "the selected person"}.</p>}</div></Card></>}
        {activeTab === "Peptides" && (() => {
          const viewPeptides = viewRegimen.filter((item) => item.category === "peptide");
          return <>
            <HealthRegimenBulkForm workspaceId={workspaceId} profiles={data.profiles} defaultProfileId={viewProfileId} defaultCategory="peptide" onSaved={() => load(workspaceId)}/>
            <Card title={`Peptides — ${viewingProfile?.display_name || ""}`}>
              <div className="space-y-3">
                {viewPeptides.map((item) => <HealthRegimenItemCard key={item.id} item={item} onChanged={() => load(workspaceId)}/>)}
                {!viewPeptides.length && <p className="text-sm text-slate-500">Track the prescribed or supervised product, concentration, dose, route, cycle, individual injections, injection site, missed doses and reactions.</p>}
              </div>
            </Card>
          </>;
        })()}
        {activeTab === "Workouts" && <><HealthWorkoutForm workspaceId={workspaceId} profiles={data.profiles} defaultProfileId={viewProfileId} onSaved={() => load(workspaceId)}/><Card title={`Workout history — ${viewingProfile?.display_name || ""}`}><div className="space-y-3">{viewWorkouts.map((workout) => <HealthWorkoutCard key={workout.id} workout={workout} onChanged={() => load(workspaceId)}/>)}{!viewWorkouts.length && <p className="text-sm text-slate-500">No workouts logged yet for {viewingProfile?.display_name || "the selected person"}.</p>}</div></Card></>}
        {activeTab === "Programs" && (() => {
          const programDaysForSelected = data.programDays.filter((day) => day.program_id === selectedProgramId).sort((a, b) => a.day_number - b.day_number);
          const selectedProgram = data.programs.find((program) => program.id === selectedProgramId);
          return <>
            <Card title="Programs">
              <div className="space-y-2">
                {data.programs.map((program) => <div key={program.id} className="flex items-center justify-between gap-2 rounded-xl bg-slate-100 p-3 dark:bg-slate-800">
                  <button type="button" onClick={() => setSelectedProgramId(program.id)} className={`text-left font-black ${selectedProgramId === program.id ? "text-amber-600 dark:text-amber-400" : ""}`}>{program.name}{program.source ? ` — ${program.source}` : ""}</button>
                  <DeleteButton label={`Delete ${program.name}`} onDelete={async () => { const { error } = await supabase.from("health_programs").delete().eq("id", program.id); if (!error) { if (selectedProgramId === program.id) setSelectedProgramId(null); await load(workspaceId); } }}/>
                </div>)}
                {!data.programs.length && <p className="text-sm text-slate-500">No programs yet. Add one below, then add its days.</p>}
              </div>
            </Card>
            <HealthProgramForm workspaceId={workspaceId} onSaved={async (id) => { await load(workspaceId); setSelectedProgramId(id); }}/>
            {selectedProgram && <>
              <Card title={`${selectedProgram.name}${selectedProgram.source ? ` — ${selectedProgram.source}` : ""}`}>
                {selectedProgram.notes && <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">{selectedProgram.notes}</p>}
                <div className="space-y-3">
                  {programDaysForSelected.map((day) => <HealthProgramDayCard key={day.id} day={day} onChanged={() => load(workspaceId)}/>)}
                  {!programDaysForSelected.length && <p className="text-sm text-slate-500">No days added yet.</p>}
                </div>
              </Card>
              <HealthProgramDayForm key={`${selectedProgram.id}-${(programDaysForSelected.at(-1)?.day_number || 0) + 1}`} workspaceId={workspaceId} programId={selectedProgram.id} nextDayNumber={(programDaysForSelected.at(-1)?.day_number || 0) + 1} onSaved={() => load(workspaceId)}/>
            </>}
          </>;
        })()}
        {activeTab === "Vitals" && (() => {
          const groupedVitals = groupMeasurementsByType(viewMeasurements);
          const typesPresent = MEASUREMENT_TYPES.filter((type) => groupedVitals[type.value]?.length);
          return <>
            <HealthMeasurementForm workspaceId={workspaceId} profiles={data.profiles} defaultProfileId={viewProfileId} onSaved={() => load(workspaceId)}/>
            {typesPresent.length > 0 && <Card title={`Vitals trends — ${viewingProfile?.display_name || ""}`}>
              <div className="space-y-4">{typesPresent.map((type) => <HealthVitalsTrendChart key={type.value} title={type.label} unit={type.unit} points={groupedVitals[type.value]} primaryLabel={type.primaryLabel} secondaryLabel={type.secondaryLabel}/>)}</div>
            </Card>}
            <Card title={`Vitals history — ${viewingProfile?.display_name || ""}`}>
              <div className="space-y-3">
                {viewMeasurements.map((measurement) => <HealthMeasurementCard key={measurement.id} measurement={measurement} onChanged={() => load(workspaceId)}/>)}
                {!viewMeasurements.length && <p className="text-sm text-slate-500">No vitals logged yet for {viewingProfile?.display_name || "the selected person"}. Log steps, blood pressure, heart rate, blood oxygen, sleep or weight above -- these same rows are where a Samsung Health export will land once that import exists.</p>}
              </div>
            </Card>
          </>;
        })()}
        {activeTab === "Timeline" && <Card title="Clinical timeline"><p className="text-sm text-slate-500">Physician visits, recommendations, insurance decisions and regimen changes are kept in date order without rewriting the original event.</p></Card>}
      </div>}
      <p className="mt-8 text-xs text-slate-500">FORGE Health organizes records and trends. It does not diagnose conditions or change treatment without clinician review.</p>
    </div>
  </main>;
}
