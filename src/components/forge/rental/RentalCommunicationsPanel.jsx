"use client";
import { useCallback, useEffect, useState } from "react";
import RentalRecordBrowser from "./RentalRecordBrowser";
import { goldControlClassName } from "@/components/forge/forgeMetallicTheme";

const label = value => value?.replaceAll("_", " ") || "—";
const identity = value => value;
const emptyReadiness = { resendConfigured: false, workerConfigured: false, domainConfigured: false, verifiedDomain: null };

export default function RentalCommunicationsPanel({ initialData = null, dataScope = identity, initialEmailSettings }) {
  const [data, setData] = useState(initialData || { notifications: [], charges: [] });
  const [selectedId, setSelectedId] = useState("");
  const [showQueue, setShowQueue] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [emailState, setEmailState] = useState(initialEmailSettings || { settings: null, readiness: emptyReadiness });
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const load = useCallback(() => fetch("/api/rental").then(async response => {
    const body = await response.json(); if (!response.ok) throw new Error(body.error);
    const scoped = dataScope(body); setData({ ...scoped, charges: scoped.openCharges || [] });
  }), [dataScope]);
  const loadSettings = useCallback(() => fetch("/api/rental/email-settings").then(async response => {
    const body = await response.json(); if (!response.ok) throw new Error(body.error);
    setEmailState({ settings: body.settings, readiness: body.readiness });
  }), []);
  useEffect(() => { if (!initialData) load().catch(reason => setError(reason.message)); }, [initialData, load]);
  useEffect(() => { if (initialEmailSettings === undefined) loadSettings().catch(reason => setError(reason.message)); }, [initialEmailSettings, loadSettings]);

  const activeId = data.notifications.some(item => item.id === selectedId) ? selectedId : data.notifications[0]?.id || "";
  const selected = data.notifications.find(item => item.id === activeId);
  const active = emailState.settings?.status === "active";

  async function post(payload, text) {
    setError(""); const response = await fetch("/api/rental", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const body = await response.json(); if (!response.ok) throw new Error(body.error); setMessage(text); await load();
  }
  async function queue(event) {
    event.preventDefault(); const element = event.currentTarget, form = new FormData(element);
    try { await post({ operation: "queue-rent-reminder", chargeId: form.get("chargeId"), notificationType: form.get("notificationType"), scheduledFor: new Date(form.get("scheduledFor")).toISOString(), maxAttempts: Number(form.get("maxAttempts")) }, "Reminder queued for owner-controlled delivery."); element.reset(); setShowQueue(false); }
    catch (reason) { setError(reason.message); }
  }
  async function saveSettings(event) {
    event.preventDefault(); setError(""); const form = new FormData(event.currentTarget);
    const payload = { senderName: form.get("senderName"), senderEmail: form.get("senderEmail"), status: form.get("status"), transactionalEnabled: form.get("transactionalEnabled") === "on", remindersEnabled: form.get("remindersEnabled") === "on" };
    try { const response = await fetch("/api/rental/email-settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }); const body = await response.json(); if (!response.ok) throw new Error(body.error); setEmailState({ settings: body.settings, readiness: body.readiness }); setMessage(payload.status === "active" ? "Rental email delivery activated." : "Rental email settings saved without activating delivery."); }
    catch (reason) { setError(reason.message); }
  }

  return <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-black uppercase tracking-[0.2em] text-sky-700 dark:text-sky-400">Communications</p><h2 className="mt-1 text-3xl font-black tracking-tight text-slate-950 dark:text-white">Notification outbox</h2><p className="mt-2 text-sm text-slate-600 dark:text-slate-400">Review queued messages and bounded retries. Email delivery is {active ? "active" : "not active"}.</p></div><div className="flex gap-2"><button type="button" onClick={() => { setShowSettings(value => !value); setShowQueue(false); }} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">{showSettings ? "Close settings" : "Email settings"}</button><button type="button" onClick={() => { setShowQueue(value => !value); setShowSettings(false); }} className={`rounded-xl px-4 py-2 text-sm font-bold transition ${goldControlClassName}`}>{showQueue ? "Cancel reminder" : "Queue reminder"}</button></div></div>
    {error ? <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-800 dark:bg-red-950/40 dark:text-red-300">{error}</p> : null}{message ? <p role="status" className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm font-bold text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">{message}</p> : null}
    {showSettings ? <EmailSettingsForm emailState={emailState} onSubmit={saveSettings} /> : null}
    {showQueue ? <form aria-label="Queue rent reminder" onSubmit={queue} className="mt-6 grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-5 dark:border-slate-700 dark:bg-slate-950/40 md:grid-cols-2"><select name="chargeId" required className="rounded-xl border border-slate-300 bg-white p-3 dark:border-slate-600 dark:bg-slate-900 dark:text-white"><option value="">Select open charge</option>{data.charges.map(item => <option key={item.id} value={item.id}>{item.period} · due {item.due_date}</option>)}</select><select name="notificationType" className="rounded-xl border border-slate-300 bg-white p-3 dark:border-slate-600 dark:bg-slate-900 dark:text-white"><option value="rent_reminder">Upcoming reminder</option><option value="balance_overdue">Overdue balance</option></select><input aria-label="Schedule time" name="scheduledFor" type="datetime-local" required className="rounded-xl border border-slate-300 bg-white p-3 dark:border-slate-600 dark:bg-slate-900 dark:text-white"/><label className="text-sm font-bold text-slate-900 dark:text-white">Maximum attempts<input name="maxAttempts" type="number" min="1" max="5" defaultValue="3" className="mt-1 w-full rounded-xl border border-slate-300 bg-white p-3 font-normal dark:border-slate-600 dark:bg-slate-900 dark:text-white"/></label><button className={`rounded-xl px-4 py-3 text-sm font-bold transition md:col-span-2 ${goldControlClassName}`}>Queue reminder for review</button></form> : null}
    <div className="mt-6"><RentalRecordBrowser title="Communications" records={data.notifications} selectedId={activeId} onSelect={setSelectedId} getTitle={item => item.subject} getSubtitle={item => `${label(item.status)} · ${label(item.notification_type)}`} emptyMessage="No notifications queued.">{!selected ? <p className="text-sm text-slate-500 dark:text-slate-400">No tenant communication requires review.</p> : <div><p className="text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">Selected communication</p><h3 className="mt-2 text-xl font-black text-slate-950 dark:text-white">{selected.subject}</h3><dl className="mt-5 grid gap-4 sm:grid-cols-2"><Fact term="Status" value={label(selected.status)}/><Fact term="Type" value={label(selected.notification_type)}/><Fact term="Recipient" value={selected.recipient}/><Fact term="Scheduled" value={selected.scheduled_for ? new Date(selected.scheduled_for).toLocaleString() : "—"}/><Fact term="Attempts" value={`${selected.attempt_count || 0} of ${selected.max_attempts || 0}`}/><Fact term="Channel" value={label(selected.channel || "email")}/></dl><div className="mt-5 rounded-xl bg-slate-50 p-4 text-sm text-slate-700 dark:bg-slate-950/40 dark:text-slate-300">{selected.body_text}</div>{selected.failure_message ? <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950/40 dark:text-red-300">{selected.failure_message}</p> : null}{["queued", "failed"].includes(selected.status) ? <button onClick={() => post({ operation: "cancel-rent-notification", notificationId: selected.id }, "Queued communication cancelled.").catch(reason => setError(reason.message))} className="mt-5 rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">Cancel communication</button> : null}</div>}</RentalRecordBrowser></div>
    {!active ? <p className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">Nothing is sent until the approved email provider, sender domain, and delivery control are activated.</p> : <p className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200">Email delivery is active. Only queued communications allowed by the selected controls are eligible for delivery.</p>}
  </section>;
}

export function EmailSettingsForm({ emailState, onSubmit }) {
  const settings = emailState.settings || {}, readiness = emailState.readiness || emptyReadiness;
  const ready = readiness.resendConfigured && readiness.workerConfigured && readiness.domainConfigured;
  const selectedStatus = ["active", "paused"].includes(settings.status) ? settings.status : "draft";
  return <form key={`${settings.updated_at || "new"}-${ready}`} aria-label="Rental email settings" onSubmit={onSubmit} className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-5 dark:border-slate-700 dark:bg-slate-950/40"><div className="grid gap-3 md:grid-cols-3"><Readiness label="Resend API" ready={readiness.resendConfigured}/><Readiness label="Delivery worker" ready={readiness.workerConfigured}/><Readiness label={readiness.verifiedDomain || "Verified domain"} ready={readiness.domainConfigured}/></div><div className="mt-5 grid gap-4 md:grid-cols-2"><label className="text-sm font-bold text-slate-900 dark:text-white">Sender name<input name="senderName" required defaultValue={settings.sender_name || "FORGE Rentals"} className="mt-1 w-full rounded-xl border border-slate-300 bg-white p-3 font-normal dark:border-slate-600 dark:bg-slate-900 dark:text-white"/></label><label className="text-sm font-bold text-slate-900 dark:text-white">Sender email<input name="senderEmail" type="email" required defaultValue={settings.sender_email || "rentals@mail.409marketplace.online"} className="mt-1 w-full rounded-xl border border-slate-300 bg-white p-3 font-normal dark:border-slate-600 dark:bg-slate-900 dark:text-white"/></label><label className="text-sm font-bold text-slate-900 dark:text-white">Delivery status<select name="status" defaultValue={selectedStatus} className="mt-1 w-full rounded-xl border border-slate-300 bg-white p-3 font-normal dark:border-slate-600 dark:bg-slate-900 dark:text-white"><option value="draft">Draft — cannot send</option><option value="paused">Paused — cannot send</option><option value="active" disabled={!ready}>Active — may deliver eligible messages</option></select></label><div className="grid content-center gap-2 text-sm text-slate-700 dark:text-slate-300"><label><input name="transactionalEnabled" type="checkbox" defaultChecked={settings.transactional_enabled ?? true} className="mr-2"/>Allow required transactional email</label><label><input name="remindersEnabled" type="checkbox" defaultChecked={settings.reminders_enabled ?? false} className="mr-2"/>Allow optional rent reminders</label></div></div>{!ready ? <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">Activation stays locked until all server and domain checks are ready. You can safely save these settings as a draft.</p> : null}<button className={`mt-5 rounded-xl px-4 py-3 text-sm font-bold transition ${goldControlClassName}`}>Save email settings</button></form>;
}
function Readiness({ label, ready }) { return <div className={`rounded-xl border p-3 text-sm font-bold ${ready ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200" : "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200"}`}>{ready ? "Ready" : "Needs setup"} · {label}</div>; }
function Fact({ term, value }) { return <div><dt className="text-xs font-bold uppercase text-slate-500 dark:text-slate-400">{term}</dt><dd className="mt-1 break-words font-bold capitalize text-slate-900 dark:text-white">{value || "—"}</dd></div>; }
