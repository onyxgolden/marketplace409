// External Accounts Register — owner-only panel.
//
// Client behavior: list/search/filter, create + edit (optimistic
// concurrency via version), logical delete with restore, permanent
// erase only after a delete, work threads, the idempotent seed
// (preview then apply), and the status-report section. Every save,
// delete, restore, and reconcile shows a plain-words confirmation
// naming the provider. Nothing here ever asks for or displays a
// secret: the credential location is a pointer, never a password,
// key, or token.
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

const API_BASE = "/api/forge/platform/external-accounts";

const PLAN_STATUSES = [
  ["unknown", "Unknown"],
  ["free", "Free"],
  ["paid", "Paid"],
  ["trial", "Trial"],
  ["not_applicable", "Not applicable"],
];
const API_STATUSES = [
  ["unknown", "Unknown"],
  ["integrated", "Integrated with FORGE"],
  ["not_integrated", "Not integrated"],
  ["not_applicable", "Not applicable"],
];
const RECORD_STATUSES = [
  ["confirmed_account", "Confirmed account"],
  ["unverified_lead", "Unverified lead"],
  ["evaluating_service", "Evaluating"],
  ["local_tool", "Local tool (no signup)"],
  ["no_account_required", "No account needed"],
  ["closed", "Closed"],
];
const SETUP_STATUSES = [
  ["unknown", "Unknown"],
  ["not_started", "Not started"],
  ["in_progress", "In progress"],
  ["blocked", "Blocked"],
  ["ready", "Ready"],
  ["not_applicable", "Not applicable"],
  ["retired", "Retired"],
];
const SOURCE_KINDS = [
  ["manual", "Entered by hand"],
  ["reconstructed_inventory", "Reconstructed inventory"],
  ["email_crosscheck", "Found in email"],
];
const THREAD_STATES = [
  ["open", "Open"],
  ["blocked", "Blocked"],
  ["waiting", "Waiting"],
  ["complete", "Complete"],
  ["abandoned", "Abandoned"],
];
const STILL_NEEDED = [
  ["", "Undecided"],
  ["yes", "Yes"],
  ["no", "No"],
];

const EMPTY_FORM = {
  provider_name: "",
  purpose: "",
  associated_app: "FORGE",
  work_thread_label: "",
  account_email: "",
  plan_status: "unknown",
  billing_arrangement: "",
  api_integration_status: "unknown",
  still_needed: "",
  credential_location: "",
  record_status: "unverified_lead",
  setup_status: "unknown",
  source_kind: "manual",
  source_reference: "",
  notes: "",
};

function toForm(account) {
  return {
    provider_name: account.provider_name ?? "",
    purpose: account.purpose ?? "",
    associated_app: account.associated_app ?? "FORGE",
    work_thread_label: account.work_thread_label ?? "",
    account_email: account.account_email ?? "",
    plan_status: account.plan_status ?? "unknown",
    billing_arrangement: account.billing_arrangement ?? "",
    api_integration_status: account.api_integration_status ?? "unknown",
    still_needed:
      account.still_needed === true ? "yes" : account.still_needed === false ? "no" : "",
    credential_location: account.credential_location ?? "",
    record_status: account.record_status ?? "unverified_lead",
    setup_status: account.setup_status ?? "unknown",
    source_kind: account.source_kind ?? "manual",
    source_reference: account.source_reference ?? "",
    notes: account.notes ?? "",
  };
}

function toPayload(form) {
  const payload = { ...form };
  payload.still_needed =
    form.still_needed === "yes" ? true : form.still_needed === "no" ? false : null;
  for (const key of ["work_thread_label", "account_email", "billing_arrangement", "credential_location", "source_reference", "notes"]) {
    if (payload[key] === "") payload[key] = null;
  }
  return payload;
}

function labelFor(options, value) {
  return options.find(([v]) => v === value)?.[1] ?? value;
}

async function callApi(path, { method = "GET", body } = {}) {
  const response = await fetch(path, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Something went wrong. Try again.");
  }
  return data;
}

function newRequestId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `seed-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

export default function ExternalAccountsPanel() {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showDeleted, setShowDeleted] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [confirmErase, setConfirmErase] = useState(null);
  const [seedPreview, setSeedPreview] = useState(null);
  const [seedBusy, setSeedBusy] = useState(false);
  const [reportSection, setReportSection] = useState(null);
  const [reportBusy, setReportBusy] = useState(false);
  const [threadForm, setThreadForm] = useState({ title: "", next_action: "", owner: "", next_review_on: "", state: "open" });

  const loadAccounts = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await callApi(`${API_BASE}?include_deleted=${showDeleted ? "1" : "0"}`);
      setAccounts(data.accounts ?? []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [showDeleted]);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return accounts.filter((account) => {
      if (statusFilter !== "all" && account.record_status !== statusFilter) return false;
      if (!needle) return true;
      return [account.provider_name, account.purpose, account.associated_app, account.work_thread_label]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(needle));
    });
  }, [accounts, search, statusFilter]);

  const counts = useMemo(() => {
    const live = accounts.filter((a) => !a.deleted_at);
    return {
      total: live.length,
      unverified: live.filter((a) => a.record_status === "unverified_lead").length,
      blocked: live.filter((a) => a.setup_status === "blocked").length,
      inProgress: live.filter((a) => a.setup_status === "in_progress").length,
      neededNotIntegrated: live.filter(
        (a) => a.still_needed === true && a.api_integration_status === "not_integrated",
      ).length,
      deleted: accounts.filter((a) => a.deleted_at).length,
    };
  }, [accounts]);

  const selected = accounts.find((a) => a.id === selectedId) ?? null;

  function openDetail(account) {
    setSelectedId(account.id);
    setDetail(null);
    setForm(toForm(account));
    setEditing(false);
    setCreating(false);
    setNotice("");
    callApi(`${API_BASE}/${account.id}`)
      .then((data) => setDetail(data))
      .catch((err) => setError(err.message));
  }

  function startCreate() {
    setSelectedId(null);
    setDetail(null);
    setForm(EMPTY_FORM);
    setEditing(false);
    setCreating(true);
    setNotice("");
  }

  function setField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function saveForm(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      if (creating) {
        const data = await callApi(API_BASE, { method: "POST", body: { payload: toPayload(form) } });
        setNotice(data.message ?? `Saved ${form.provider_name}.`);
        setCreating(false);
      } else {
        const data = await callApi(`${API_BASE}/${selectedId}`, {
          method: "PATCH",
          body: { payload: toPayload(form), expected_version: selected?.version },
        });
        setNotice(data.message ?? `Saved ${form.provider_name}.`);
        setEditing(false);
      }
      await loadAccounts();
      if (selectedId) {
        const data = await callApi(`${API_BASE}/${selectedId}`);
        setDetail(data);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function deleteAccount(account, permanent) {
    setError("");
    try {
      const path = permanent ? `${API_BASE}/${account.id}?permanent=1` : `${API_BASE}/${account.id}`;
      const data = await callApi(path, { method: "DELETE" });
      setNotice(data.message ?? "Deleted.");
      setConfirmDelete(null);
      setConfirmErase(null);
      if (selectedId === account.id) {
        setSelectedId(null);
        setDetail(null);
      }
      await loadAccounts();
    } catch (err) {
      setError(err.message);
    }
  }

  async function restoreAccount(account) {
    setError("");
    try {
      const data = await callApi(`${API_BASE}/${account.id}/restore`, { method: "POST", body: {} });
      setNotice(data.message ?? "Restored.");
      await loadAccounts();
    } catch (err) {
      setError(err.message);
    }
  }

  async function addThread(event) {
    event.preventDefault();
    setError("");
    try {
      const data = await callApi(`${API_BASE}/${selectedId}/threads`, {
        method: "POST",
        body: { payload: threadForm },
      });
      setNotice(data.message ?? "Thread added.");
      setThreadForm({ title: "", next_action: "", owner: "", next_review_on: "", state: "open" });
      const refreshed = await callApi(`${API_BASE}/${selectedId}`);
      setDetail(refreshed);
    } catch (err) {
      setError(err.message);
    }
  }

  async function setThreadState(threadId, state) {
    setError("");
    try {
      const data = await callApi(`${API_BASE}/threads/${threadId}`, {
        method: "PATCH",
        body: { state },
      });
      setNotice(data.message ?? `Thread moved to ${state}.`);
      const refreshed = await callApi(`${API_BASE}/${selectedId}`);
      setDetail(refreshed);
    } catch (err) {
      setError(err.message);
    }
  }

  async function previewSeed() {
    setSeedBusy(true);
    setError("");
    try {
      const data = await callApi(`${API_BASE}/seed`, { method: "POST", body: { action: "preview" } });
      setSeedPreview(data.preview ?? null);
      setNotice("Seed preview ready — nothing was added yet.");
    } catch (err) {
      setError(err.message);
    } finally {
      setSeedBusy(false);
    }
  }

  async function applySeed() {
    setSeedBusy(true);
    setError("");
    try {
      const data = await callApi(`${API_BASE}/seed`, {
        method: "POST",
        body: { action: "apply", request_id: newRequestId() },
      });
      setNotice(data.message ?? "Seed applied.");
      setSeedPreview(null);
      await loadAccounts();
    } catch (err) {
      setError(err.message);
    } finally {
      setSeedBusy(false);
    }
  }

  async function generateReport() {
    setReportBusy(true);
    setError("");
    try {
      const data = await callApi(`${API_BASE}/report`);
      setReportSection(data.section ?? null);
      setNotice("Report section generated.");
    } catch (err) {
      setError(err.message);
    } finally {
      setReportBusy(false);
    }
  }

  return (
    <div>
      {notice ? (
        <p role="status" className="mt-2 rounded border border-green-700 bg-green-50 p-2 text-sm">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 rounded border border-red-700 bg-red-50 p-2 text-sm">
          {error}
        </p>
      ) : null}

      <section className="mt-4">
        <h2>Accounts</h2>
        <p className="text-sm">
          {counts.total} accounts · {counts.unverified} unverified leads · {counts.blocked} blocked ·{" "}
          {counts.inProgress} in progress · {counts.neededNotIntegrated} needed but not integrated
          {counts.deleted > 0 ? ` · ${counts.deleted} deleted` : ""}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <label className="text-sm">
            Search{" "}
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Provider, purpose, or app"
              className="rounded border px-2 py-1"
            />
          </label>
          <label className="text-sm">
            Status{" "}
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="rounded border px-2 py-1"
            >
              <option value="all">All</option>
              {RECORD_STATUSES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <input
              type="checkbox"
              checked={showDeleted}
              onChange={(event) => setShowDeleted(event.target.checked)}
            />{" "}
            Show deleted
          </label>
          <button type="button" onClick={startCreate} className="rounded border px-3 py-1 font-bold">
            Add account
          </button>
        </div>

        {loading ? (
          <p className="mt-2 text-sm">Loading accounts…</p>
        ) : filtered.length === 0 ? (
          <p className="mt-2 text-sm">
            No accounts match. Add one, or run the seed below to load the reconstructed inventory.
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {filtered.map((account) => (
              <li key={account.id} className="rounded border p-2">
                <button
                  type="button"
                  onClick={() => openDetail(account)}
                  className="text-left font-bold underline"
                >
                  {account.provider_name}
                  {account.deleted_at ? " (deleted)" : ""}
                </button>
                <p className="text-sm">
                  {account.purpose} · {account.associated_app} ·{" "}
                  {labelFor(RECORD_STATUSES, account.record_status)} ·{" "}
                  {labelFor(SETUP_STATUSES, account.setup_status)}
                </p>
                {account.work_thread_label ? (
                  <p className="text-sm">Work: {account.work_thread_label}</p>
                ) : null}
                {account.deleted_at ? (
                  <button
                    type="button"
                    onClick={() => restoreAccount(account)}
                    className="mt-1 rounded border px-2 py-1 text-sm"
                  >
                    Restore {account.provider_name}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {creating || (selected && (editing || detail)) ? (
        <section className="mt-4 rounded border p-3">
          <h2>{creating ? "Add account" : selected.provider_name}</h2>
          {creating || editing ? (
            <form onSubmit={saveForm} className="mt-2 space-y-2">
              <label className="block text-sm">
                Provider name{" "}
                <input
                  required
                  value={form.provider_name}
                  onChange={(event) => setField("provider_name", event.target.value)}
                  className="w-full rounded border px-2 py-1"
                />
              </label>
              <label className="block text-sm">
                Purpose{" "}
                <input
                  required
                  value={form.purpose}
                  onChange={(event) => setField("purpose", event.target.value)}
                  className="w-full rounded border px-2 py-1"
                />
              </label>
              <label className="block text-sm">
                App it serves{" "}
                <input
                  required
                  value={form.associated_app}
                  onChange={(event) => setField("associated_app", event.target.value)}
                  className="w-full rounded border px-2 py-1"
                />
              </label>
              <label className="block text-sm">
                Work thread{" "}
                <input
                  value={form.work_thread_label}
                  onChange={(event) => setField("work_thread_label", event.target.value)}
                  placeholder="e.g. Property Risk Radar"
                  className="w-full rounded border px-2 py-1"
                />
              </label>
              <label className="block text-sm">
                Account email{" "}
                <input
                  type="email"
                  value={form.account_email}
                  onChange={(event) => setField("account_email", event.target.value)}
                  placeholder="Only if you know it — never guess"
                  className="w-full rounded border px-2 py-1"
                />
              </label>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <label className="block text-sm">
                  Plan{" "}
                  <select
                    value={form.plan_status}
                    onChange={(event) => setField("plan_status", event.target.value)}
                    className="w-full rounded border px-2 py-1"
                  >
                    {PLAN_STATUSES.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm">
                  FORGE integration{" "}
                  <select
                    value={form.api_integration_status}
                    onChange={(event) => setField("api_integration_status", event.target.value)}
                    className="w-full rounded border px-2 py-1"
                  >
                    {API_STATUSES.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm">
                  Still needed{" "}
                  <select
                    value={form.still_needed}
                    onChange={(event) => setField("still_needed", event.target.value)}
                    className="w-full rounded border px-2 py-1"
                  >
                    {STILL_NEEDED.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm">
                  Record status{" "}
                  <select
                    value={form.record_status}
                    onChange={(event) => setField("record_status", event.target.value)}
                    className="w-full rounded border px-2 py-1"
                  >
                    {RECORD_STATUSES.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm">
                  Setup status{" "}
                  <select
                    value={form.setup_status}
                    onChange={(event) => setField("setup_status", event.target.value)}
                    className="w-full rounded border px-2 py-1"
                  >
                    {SETUP_STATUSES.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm">
                  Source{" "}
                  <select
                    value={form.source_kind}
                    onChange={(event) => setField("source_kind", event.target.value)}
                    className="w-full rounded border px-2 py-1"
                  >
                    {SOURCE_KINDS.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="block text-sm">
                Billing arrangement{" "}
                <input
                  value={form.billing_arrangement}
                  onChange={(event) => setField("billing_arrangement", event.target.value)}
                  placeholder="e.g. Free, or who pays — never a card number"
                  className="w-full rounded border px-2 py-1"
                />
              </label>
              <label className="block text-sm">
                Credential location{" "}
                <input
                  value={form.credential_location}
                  onChange={(event) => setField("credential_location", event.target.value)}
                  placeholder="e.g. 1Password → FORGE — a pointer, never the password or key"
                  className="w-full rounded border px-2 py-1"
                />
              </label>
              <label className="block text-sm">
                Source reference{" "}
                <input
                  value={form.source_reference}
                  onChange={(event) => setField("source_reference", event.target.value)}
                  placeholder="Where this came from — spreadsheet row, email, brief"
                  className="w-full rounded border px-2 py-1"
                />
              </label>
              <label className="block text-sm">
                Notes{" "}
                <textarea
                  value={form.notes}
                  onChange={(event) => setField("notes", event.target.value)}
                  rows={3}
                  className="w-full rounded border px-2 py-1"
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded border px-3 py-1 font-bold"
                >
                  {saving ? "Saving…" : creating ? "Add account" : "Save changes"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCreating(false);
                    setEditing(false);
                    if (selected) setForm(toForm(selected));
                  }}
                  className="rounded border px-3 py-1"
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <div className="mt-2 space-y-1 text-sm">
              <p>
                {selected.purpose} · {selected.associated_app}
              </p>
              <p>
                {labelFor(RECORD_STATUSES, selected.record_status)} ·{" "}
                {labelFor(SETUP_STATUSES, selected.setup_status)} ·{" "}
                {labelFor(PLAN_STATUSES, selected.plan_status)} ·{" "}
                {labelFor(API_STATUSES, selected.api_integration_status)}
              </p>
              {selected.account_email ? <p>Email: {selected.account_email}</p> : null}
              {selected.credential_location ? <p>Login lives at: {selected.credential_location}</p> : null}
              {selected.source_reference ? <p>Source: {selected.source_reference}</p> : null}
              {selected.notes ? <p>Notes: {selected.notes}</p> : null}
              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="rounded border px-3 py-1 font-bold"
                >
                  Edit {selected.provider_name}
                </button>
                {selected.deleted_at ? (
                  <>
                    <button
                      type="button"
                      onClick={() => restoreAccount(selected)}
                      className="rounded border px-3 py-1"
                    >
                      Restore {selected.provider_name}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmErase(selected)}
                      className="rounded border px-3 py-1"
                    >
                      Erase {selected.provider_name} permanently
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(selected)}
                    className="rounded border px-3 py-1"
                  >
                    Delete {selected.provider_name}
                  </button>
                )}
              </div>

              {confirmDelete ? (
                <div role="alertdialog" aria-label="Confirm delete" className="mt-2 rounded border border-red-700 p-2">
                  <p>
                    Delete {confirmDelete.provider_name}? The account and its threads move to the
                    deleted list. You can restore it later.
                  </p>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => deleteAccount(confirmDelete, false)}
                      className="rounded border px-3 py-1 font-bold"
                    >
                      Yes, delete {confirmDelete.provider_name}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(null)}
                      className="rounded border px-3 py-1"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : null}
              {confirmErase ? (
                <div role="alertdialog" aria-label="Confirm permanent erase" className="mt-2 rounded border border-red-700 p-2">
                  <p>
                    Erase {confirmErase.provider_name} permanently? This cannot be undone — the
                    account, its threads, and its history are gone for good.
                  </p>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => deleteAccount(confirmErase, true)}
                      className="rounded border px-3 py-1 font-bold"
                    >
                      Yes, erase {confirmErase.provider_name} forever
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmErase(null)}
                      className="rounded border px-3 py-1"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : null}

              <h3 className="pt-2 font-bold">Work threads</h3>
              {detail ? (
                detail.threads?.length ? (
                  <ul className="space-y-1">
                    {detail.threads.map((thread) => (
                      <li key={thread.id} className="rounded border p-2">
                        <p className="font-bold">{thread.title}</p>
                        <p>
                          {labelFor(THREAD_STATES, thread.state)}
                          {thread.next_action ? ` — next: ${thread.next_action}` : ""}
                          {thread.owner ? ` (${thread.owner})` : ""}
                        </p>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {THREAD_STATES.map(([value, label]) =>
                            value === thread.state ? null : (
                              <button
                                key={value}
                                type="button"
                                onClick={() => setThreadState(thread.id, value)}
                                className="rounded border px-2 py-1 text-xs"
                              >
                                Mark {label.toLowerCase()}
                              </button>
                            ),
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>No threads yet.</p>
                )
              ) : (
                <p>Loading threads…</p>
              )}
              <form onSubmit={addThread} className="mt-2 space-y-2">
                <label className="block text-sm">
                  New thread title{" "}
                  <input
                    required
                    value={threadForm.title}
                    onChange={(event) => setThreadForm((p) => ({ ...p, title: event.target.value }))}
                    className="w-full rounded border px-2 py-1"
                  />
                </label>
                <label className="block text-sm">
                  Next action{" "}
                  <input
                    value={threadForm.next_action}
                    onChange={(event) => setThreadForm((p) => ({ ...p, next_action: event.target.value }))}
                    className="w-full rounded border px-2 py-1"
                  />
                </label>
                <button type="submit" className="rounded border px-3 py-1">
                  Add thread
                </button>
              </form>
            </div>
          )}
        </section>
      ) : null}

      <section className="mt-4">
        <h2>Seed the reconstructed inventory</h2>
        <p className="text-sm">
          Loads the 139 accounts from the spreadsheet, the scope brief, and the Gmail cross-check.
          Running it twice adds nothing new — accounts you edited are never overwritten.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={previewSeed}
            disabled={seedBusy}
            className="rounded border px-3 py-1"
          >
            Preview seed
          </button>
          <button
            type="button"
            onClick={applySeed}
            disabled={seedBusy}
            className="rounded border px-3 py-1 font-bold"
          >
            Apply seed
          </button>
        </div>
        {seedPreview ? (
          <p className="mt-2 text-sm">
            Preview: {seedPreview.creates ?? 0} to add · {seedPreview.matches ?? 0} already there ·{" "}
            {seedPreview.conflicts ?? 0} conflicts.
          </p>
        ) : null}
      </section>

      <section className="mt-4">
        <h2>Status report section</h2>
        <p className="text-sm">
          The “External accounts and dependent work” section every FORGE status report carries.
          It never includes account emails or credential locations.
        </p>
        <button
          type="button"
          onClick={generateReport}
          disabled={reportBusy}
          className="mt-2 rounded border px-3 py-1"
        >
          Generate report section
        </button>
        {reportSection ? (
          <div className="mt-2 rounded border p-2 text-sm">
            <p>{reportSection.summary}</p>
            <p className="mt-1 font-bold">
              Property Risk Radar:{" "}
              {reportSection.radar.status === "open_not_built"
                ? `open, not built — ${reportSection.radar.prospective_source_count} prospective sources, ${reportSection.radar.open_thread_count} open threads`
                : reportSection.radar.status}
            </p>
            {reportSection.follow_ups?.length ? (
              <ul className="mt-1 list-disc pl-5">
                {reportSection.follow_ups.slice(0, 10).map((item, index) => (
                  <li key={index}>{item.text}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-1">No follow-ups outstanding.</p>
            )}
          </div>
        ) : null}
      </section>
    </div>
  );
}
