"use client";

import { useState } from "react";

const btn =
  "px-3 py-1.5 rounded-lg text-xs font-bold text-white disabled:opacity-50";
const btnGreen = btn + " bg-green-700 hover:bg-green-600";
const btnRed = btn + " bg-red-700 hover:bg-red-600";
const btnGray = btn + " bg-gray-700 hover:bg-gray-600";
const btnAmber = btn + " bg-amber-600 hover:bg-amber-500";

function ActionButtons({ lenderId, status, identityReviewStatus, versionId, requestType, onDone }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  // DSCR-R1-002: a removal request is a different operation than a term edit —
  // approving it soft-removes the listing WITHOUT applying the payload.
  const isRemoval = requestType === "removal_request";
  // DSCR-R2-001: publish fails closed at the RPC unless identity was confirmed
  // through approve_submission. A rejected initial submission (identity
  // 'pending') can never be published — it must go through approval. Only
  // offer the button when the republish path is actually available.
  const canRepublish =
    status === "unpublished" && identityReviewStatus === "identity-confirmed";

  async function act(action) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/dscr-lenders/admin/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          lender_id: lenderId,
          version_id: versionId ?? undefined,
          note: note || undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg({ ok: false, text: body.error || "Transition failed." });
        return;
      }
      setMsg({ ok: true, text: `Applied: ${action}.` });
      onDone();
    } catch {
      setMsg({ ok: false, text: "Transition failed. Try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2">
      <div className="flex flex-wrap gap-2">
        {status === "pending_review" && !versionId && (
          <>
            <button disabled={busy} onClick={() => act("approve_submission")} className={btnGreen}>
              Approve &amp; publish
            </button>
            <button disabled={busy} onClick={() => act("reject_submission")} className={btnRed}>
              Reject
            </button>
          </>
        )}
        {versionId && (
          <>
            <button disabled={busy} onClick={() => act("approve_version")} className={btnGreen}>
              {isRemoval ? "Approve removal" : "Approve version"}
            </button>
            <button disabled={busy} onClick={() => act("reject_version")} className={btnRed}>
              {isRemoval ? "Reject removal" : "Reject version"}
            </button>
          </>
        )}
        {status === "published" && (
          <>
            <button disabled={busy} onClick={() => act("unpublish")} className={btnAmber}>
              Unpublish
            </button>
            <button disabled={busy} onClick={() => act("reconfirm")} className={btnGray}>
              Reconfirm terms
            </button>
            <button disabled={busy} onClick={() => act("remove")} className={btnRed}>
              Remove (soft)
            </button>
          </>
        )}
        {status === "unpublished" && (
          <>
            {canRepublish ? (
              <button disabled={busy} onClick={() => act("publish")} className={btnGreen}>
                Publish
              </button>
            ) : (
              <span className="text-xs text-gray-500 italic px-1 py-1.5">
                Cannot publish: identity not confirmed. Rejected submissions
                must go through approval, not publish.
              </span>
            )}
            <button disabled={busy} onClick={() => act("remove")} className={btnRed}>
              Remove (soft)
            </button>
          </>
        )}
      </div>
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Review note (optional)"
        maxLength={1000}
        className="mt-2 w-full border border-gray-300 rounded-lg px-2 py-1 text-xs"
        aria-label="Review note"
      />
      {msg && (
        <p
          className={`mt-1 text-xs ${msg.ok ? "text-green-700" : "text-red-700"}`}
          role={msg.ok ? "status" : "alert"}
        >
          {msg.text}
        </p>
      )}
    </div>
  );
}

function PayloadView({ payload }) {
  if (!payload || typeof payload !== "object") return null;
  const entries = Object.entries(payload).filter(
    ([, v]) => v !== null && v !== "" && !(Array.isArray(v) && v.length === 0)
  );
  return (
    <dl className="mt-2 text-xs grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1">
      {entries.map(([k, v]) => (
        <div key={k} className="flex gap-2">
          <dt className="font-semibold text-gray-600 shrink-0">{k}:</dt>
          <dd className="text-gray-900 break-words">
            {Array.isArray(v) ? v.join(", ") : String(v)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export default function DscrAdminQueue({ initialQueue }) {
  const [queue, setQueue] = useState(initialQueue);

  async function refresh() {
    try {
      const res = await fetch("/api/dscr-lenders/admin/queue");
      if (res.ok) setQueue(await res.json());
    } catch {
      /* keep current view on refresh failure */
    }
  }

  return (
    <div className="mt-6 space-y-8">
      <section>
        <h2 className="text-xl font-extrabold">
          Pending submissions ({queue.pending_submissions.length})
        </h2>
        {queue.pending_submissions.length === 0 && (
          <p className="text-sm text-gray-500 mt-2">Nothing waiting.</p>
        )}
        <div className="grid gap-4 mt-3">
          {queue.pending_submissions.map((l) => (
            <div key={l.id} className="bg-white rounded-2xl shadow p-5">
              <p className="font-bold">
                {l.company_name}{" "}
                <span className="text-xs font-normal text-gray-500">
                  NMLS {l.nmls_number} · {l.identity_review_status}
                </span>
              </p>
              <p className="text-xs text-gray-500">
                Submitted {new Date(l.created_at).toLocaleString()}
              </p>
              <ActionButtons lenderId={l.id} status={l.status} identityReviewStatus={l.identity_review_status} onDone={refresh} />
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-xl font-extrabold">
          Pending staged edits ({queue.pending_versions.length})
        </h2>
        {queue.pending_versions.length === 0 && (
          <p className="text-sm text-gray-500 mt-2">Nothing waiting.</p>
        )}
        <div className="grid gap-4 mt-3">
          {queue.pending_versions.map((v) => (
            <div key={v.id} className="bg-white rounded-2xl shadow p-5">
              <p className="font-bold">
                {v.dscr_lenders?.company_name ?? v.lender_id}{" "}
                <span className="text-xs font-normal text-gray-500">
                  version #{v.version_number} · staged{" "}
                  {new Date(v.created_at).toLocaleString()}
                </span>
              </p>
              {v.request_type === "removal_request" ? (
                <p className="mt-2 text-xs font-bold text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2" role="alert">
                  REMOVAL REQUEST — the provider asked to be removed from the
                  directory. Approving unpublishes this listing WITHOUT
                  changing its terms. Rejecting leaves it live.
                </p>
              ) : (
                <PayloadView payload={v.payload} />
              )}
              <ActionButtons
                lenderId={v.lender_id}
                status="published"
                versionId={v.id}
                requestType={v.request_type}
                onDone={refresh}
              />
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-xl font-extrabold">
          All listings ({queue.listings.length})
        </h2>
        <div className="grid gap-4 mt-3">
          {queue.listings.map((l) => (
            <div key={l.id} className="bg-white rounded-2xl shadow p-5">
              <p className="font-bold">
                {l.company_name}{" "}
                <span className="text-xs font-normal text-gray-500">
                  NMLS {l.nmls_number} · {l.status} · {l.identity_review_status}
                  {l.abuse_report_count > 0 &&
                    ` · ${l.abuse_report_count} abuse report(s)`}
                </span>
              </p>
              {l.last_directory_reviewed_at && (
                <p className="text-xs text-gray-500">
                  Last reviewed{" "}
                  {new Date(l.last_directory_reviewed_at).toLocaleDateString()}
                </p>
              )}
              <ActionButtons lenderId={l.id} status={l.status} identityReviewStatus={l.identity_review_status} onDone={refresh} />
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-xl font-extrabold">Recent audit (append-only)</h2>
        <div className="mt-3 bg-white rounded-2xl shadow p-5 text-xs">
          {queue.recent_audit.length === 0 && (
            <p className="text-gray-500">No audit events yet.</p>
          )}
          <ul className="space-y-1">
            {queue.recent_audit.map((a) => (
              <li key={a.id} className="text-gray-700">
                <span className="font-semibold">{a.action}</span>{" "}
                <span className="text-gray-500">
                  {new Date(a.created_at).toLocaleString()}
                </span>
                {a.note && <span> — {a.note}</span>}
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
