"use client";
import { useState } from "react";
import { useStaleWhileRevalidate } from "@/hooks/useStaleWhileRevalidate";
import { ForgeErrorState, ForgeLoadingState } from "@/components/forge/ForgeStates";

async function fetchTenantDocuments() {
  const response = await fetch("/api/rental/documents");
  const body = await response.json();
  if (!response.ok) throw new Error(body.error);
  return { documents: body.documents || [], preparations: body.leasePreparations || [] };
}

export default function TenantDocumentsPanel() {
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  // Tenant documents: stale-while-revalidate under a tenant-scoped key. The cached
  // library renders instantly on return visits and stays visible while an
  // acknowledgement revalidates in the background.
  const { data, error: loadError, isLoading, isRefreshing, refresh } = useStaleWhileRevalidate(
    "rental:tenant-documents", fetchTenantDocuments, { ttlMs: 60_000 });
  const documents = data?.documents || [];
  const preparations = data?.preparations || [];
  const hasContent = documents.length > 0 || preparations.length > 0;

  async function acknowledge(documentId) {
    setError(""); setMessage("");
    try {
      const response = await fetch("/api/rental/documents", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation: "acknowledge-document", documentId }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      await refresh();
      setMessage("Document receipt acknowledged.");
    } catch (reason) { setError(reason.message); }
  }

  return <section className="rounded-2xl border bg-white p-6 shadow-sm"><p className="text-sm font-bold uppercase tracking-widest text-amber-700">Documents</p><h2 className="mt-2 text-xl font-black">Lease files and notices</h2>
    <p className="mt-2 text-sm text-slate-600">Acknowledging confirms that you received access to a document. It is not an electronic signature and does not mean that you agree with its contents.</p>{message ? <p className="mt-3 rounded-xl bg-emerald-50 p-3 text-emerald-800">{message}</p> : null}
    {error ? <p role="alert" className="mt-3 text-red-700">{error}</p> : null}
    {!data && isLoading ? <div className="mt-4"><ForgeLoadingState label="Loading documents…" /></div> : null}
    {!data && loadError ? <div className="mt-4"><ForgeErrorState title="Unable to load documents." detail={loadError} onRetry={refresh} /></div> : null}
    {data && !hasContent ? <p className="mt-3 text-sm text-slate-500">No documents have been published to your portal.</p> : null}
    {data && hasContent ? <>
      {(isRefreshing || loadError) ? <p role="status" className="mt-3 text-xs font-bold text-slate-400">{loadError ? "Could not refresh — showing your last saved documents." : "Updating…"}</p> : null}
      <div className="mt-4 space-y-3">{documents.map((document) => { const acknowledged = document.acknowledgements?.length > 0; return <div key={document.id} className="flex flex-wrap items-center justify-between gap-4 rounded-xl border p-4"><div><strong>{document.title}</strong><p className="text-sm capitalize text-slate-500">{document.category} · {document.original_filename}</p>{acknowledged ? <p className="mt-1 text-sm font-bold text-emerald-700">Receipt acknowledged</p> : null}</div><div className="flex gap-2"><a href={document.download_url} target="_blank" rel="noreferrer" className="rounded-lg border px-4 py-2 text-sm font-bold">View</a>{!acknowledged ? <button onClick={() => acknowledge(document.id)} className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-bold text-white">Acknowledge receipt</button> : null}</div></div>; })}</div>
      {preparations.map((p) => { const version = p.versions?.find((v) => v.version_number === p.approved_version); return version ? <article key={p.id} className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-4"><strong>{p.title} · Review version {version.version_number}</strong><p className="mt-1 text-sm text-blue-900">Approved for review only. This is not an electronic signature or an executed lease.</p><dl className="mt-3 grid gap-2 text-sm md:grid-cols-2">{Object.entries(version.terms || {}).filter(([, value]) => value).map(([key, value]) => <div key={key}><dt className="font-bold capitalize">{key.replaceAll(/([A-Z])/g, " $1")}</dt><dd>{value}</dd></div>)}</dl></article> : null; })}
    </> : null}
  </section>;
}
