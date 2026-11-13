"use client";

// SaaS 30-day trial — platform-owner console (client).
// Server-side identity + platform-owner check happen on the page;
// every mutation here goes through the owner-only API routes, which
// re-check through their RPCs. Trial/manual access is never presented
// as proof of payment. Every mutation needs a reason + confirmation;
// each mutation carries a request id so a safe retry reuses it instead
// of starting a second trial, and the submit button stays disabled
// while a request is in flight.
import { useCallback, useEffect, useRef, useState } from "react";

const APPS = [
  { key: "planner", name: "Planner" },
  { key: "capture", name: "Capture" },
];

function formatDate(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

function remainingText(endsAt, nowMs) {
  if (!endsAt) return "No end date.";
  const ms = new Date(endsAt).getTime() - nowMs;
  if (ms <= 0) return "Ended.";
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  return `${days} day${days === 1 ? "" : "s"}, ${hours} hour${hours === 1 ? "" : "s"} left.`;
}

export default function TrialAdminPanel() {
  const [search, setSearch] = useState("");
  const [workspaces, setWorkspaces] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [overview, setOverview] = useState(null);
  const [listError, setListError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [notice, setNotice] = useState("");
  const [loadingList, setLoadingList] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [reasons, setReasons] = useState({});
  const [confirmAction, setConfirmAction] = useState(null);
  const [pending, setPending] = useState(false);
  // Frozen at mount so rendering stays pure; re-select a workspace to
  // refresh the remaining-time display.
  const [nowMs] = useState(() => Date.now());
  const requestIdRef = useRef(null);

  const loadList = useCallback(async (term) => {
    setLoadingList(true);
    setListError("");
    try {
      const res = await fetch(`/api/forge/platform/trials?search=${encodeURIComponent(term)}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Unable to load workspaces.");
      setWorkspaces(body.workspaces ?? []);
    } catch (error) {
      setListError(error.message);
    } finally {
      setLoadingList(false);
    }
  }, []);

  const loadOverview = useCallback(async (ownerId) => {
    setLoadingDetail(true);
    setDetailError("");
    try {
      const res = await fetch(`/api/forge/platform/trials?workspace=${encodeURIComponent(ownerId)}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Unable to load this workspace.");
      setOverview(body);
    } catch (error) {
      setDetailError(error.message);
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- initial workspace list fetch when the panel mounts; later refreshes are user-triggered.
  useEffect(() => { loadList(""); }, [loadList]);

  function selectWorkspace(ownerId) {
    setSelectedId(ownerId);
    setOverview(null);
    loadOverview(ownerId);
  }

  function newRequestId() {
    if (!requestIdRef.current) requestIdRef.current = crypto.randomUUID();
    return requestIdRef.current;
  }

  async function runAction(action, appKey) {
    const trimmed = (reasons[appKey] ?? "").trim();
    if (!trimmed) {
      setDetailError("A reason is required for this change.");
      return;
    }
    setPending(true);
    setDetailError("");
    setNotice("");
    try {
      const res = await fetch(`/api/forge/platform/trials/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ owner_id: selectedId, app_key: appKey, reason: trimmed, request_id: newRequestId() }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Unable to complete the request.");
      requestIdRef.current = null;
      setReasons((prev) => ({ ...prev, [appKey]: "" }));
      setConfirmAction(null);
      setNotice(
        action === "grant"
          ? `A 30-day trial for ${appKey} starts now.`
          : action === "renew"
            ? `The ${appKey} trial was renewed for another 30 days.`
            : `The ${appKey} trial was converted to paid/manual access. The workspace data is unchanged.`,
      );
      await loadOverview(selectedId);
    } catch (error) {
      setDetailError(error.message);
    } finally {
      setPending(false);
    }
  }

  function entitlementFor(appKey) {
    return overview?.entitlements?.find((e) => e.app_key === appKey) ?? null;
  }
  function availabilityFor(appKey) {
    return overview?.availability?.find((a) => a.app_key === appKey) ?? null;
  }
  function trialsFor(appKey) {
    return (overview?.trials ?? []).filter((t) => t.app_key === appKey);
  }

  return (
    <section>
      <h2>Find a workspace</h2>
      <div>
        <label htmlFor="trial-search">Workspace name</label>{" "}
        <input
          id="trial-search"
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") loadList(search); }}
          placeholder="Type a workspace name"
        />{" "}
        <button type="button" onClick={() => loadList(search)} disabled={loadingList}>
          {loadingList ? "Searching…" : "Search"}
        </button>
      </div>
      {listError ? <p role="alert">{listError}</p> : null}
      <ul>
        {workspaces.map((w) => (
          <li key={w.owner_id}>
            <button type="button" onClick={() => selectWorkspace(w.owner_id)} disabled={pending}>
              {w.display_name} — {w.status}
            </button>
          </li>
        ))}
      </ul>
      {workspaces.length === 0 && !loadingList ? <p>No workspaces found.</p> : null}

      {selectedId && overview ? (
        <div>
          <h2>{overview.display_name}</h2>
          <p>Status: {overview.status}</p>
          {notice ? <p role="status">{notice}</p> : null}
          {detailError ? <p role="alert">{detailError}</p> : null}
          {loadingDetail ? <p>Loading…</p> : null}

          {APPS.map(({ key, name }) => {
            const ent = entitlementFor(key);
            const avail = availabilityFor(key);
            const trials = trialsFor(key);
            const isTrial = ent?.source === "owner_trial";
            const expired = isTrial && ent?.ends_at && new Date(ent.ends_at).getTime() <= nowMs;
            const canGrant = ent?.status === "pending" && avail?.enabled;
            const canRenew = isTrial && expired;
            const canConvert = isTrial && (ent?.status === "active" || ent?.status === "expired");
            return (
              <section key={key}>
                <h3>{name}</h3>
                <p>
                  Access: {ent?.status ?? "—"}
                  {ent?.source ? ` (${ent.source === "owner_trial" ? "trial" : ent.source === "owner_manual" ? "manual" : ent.source})` : ""}
                </p>
                {isTrial ? (
                  <p>
                    Trial ends {formatDate(ent.ends_at)} — {remainingText(ent.ends_at, nowMs)}
                  </p>
                ) : null}
                {!avail?.enabled ? <p>{avail?.reason ?? "Trials aren't available for this app right now."}</p> : null}
                {trials.length > 0 ? (
                  <ul>
                    {trials.map((t) => (
                      <li key={t.id}>
                        {t.grant_kind === "initial" ? "First trial" : "Renewal"}: {formatDate(t.starts_at)} to {formatDate(t.ends_at)}
                        {t.grant_reason ? ` — ${t.grant_reason}` : ""}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>No trial yet for this app.</p>
                )}

                <label htmlFor={`trial-reason-${key}`}>Reason for the change</label>{" "}
                <input
                  id={`trial-reason-${key}`}
                  type="text"
                  value={reasons[key] ?? ""}
                  onChange={(event) => setReasons((prev) => ({ ...prev, [key]: event.target.value }))}
                  placeholder="Why is this trial being granted?"
                  maxLength={500}
                />

                {canGrant ? (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      if (!(reasons[key] ?? "").trim()) { setDetailError("A reason is required for this change."); return; }
                      setConfirmAction({ action: "grant", appKey: key });
                    }}
                  >
                    {pending ? "Working…" : `Grant a 30-day ${name} trial`}
                  </button>
                ) : null}
                {canRenew ? (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      if (!(reasons[key] ?? "").trim()) { setDetailError("A reason is required for this change."); return; }
                      setConfirmAction({ action: "renew", appKey: key });
                    }}
                  >
                    {pending ? "Working…" : `Renew the ${name} trial for 30 days`}
                  </button>
                ) : null}
                {canConvert ? (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      if (!(reasons[key] ?? "").trim()) { setDetailError("A reason is required for this change."); return; }
                      setConfirmAction({ action: "convert", appKey: key });
                    }}
                  >
                    {pending ? "Working…" : "Convert to paid/manual access"}
                  </button>
                ) : null}
                {confirmAction?.appKey === key ? (
                  <p>
                    {confirmAction.action === "grant"
                      ? `Grant a 30-day ${name} trial to ${overview.display_name}?`
                      : confirmAction.action === "renew"
                        ? `Renew the ${name} trial for ${overview.display_name} for another 30 days?`
                        : `Convert the ${name} trial for ${overview.display_name} to paid/manual access? The data stays exactly as it is.`}{" "}
                    <button type="button" disabled={pending} onClick={() => runAction(confirmAction.action, key)}>
                      Yes, do it
                    </button>{" "}
                    <button type="button" disabled={pending} onClick={() => setConfirmAction(null)}>
                      Cancel
                    </button>
                  </p>
                ) : null}
              </section>
            );
          })}

          <h3>History</h3>
          {(overview.audit ?? []).length === 0 ? (
            <p>No trial changes yet for this workspace.</p>
          ) : (
            <ul>
              {(overview.audit ?? []).map((a) => (
                <li key={a.id}>
                  {a.event} — {a.app_key} — {formatDate(a.created_at)}
                  {a.reason ? ` — ${a.reason}` : ""}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}
