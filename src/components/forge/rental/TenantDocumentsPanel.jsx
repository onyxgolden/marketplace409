"use client";
import { useCallback,useEffect,useState } from "react";
export default function TenantDocumentsPanel(){const [documents,setDocuments]=useState([]);const [error,setError]=useState("");
  const load=useCallback(()=>fetch("/api/rental/documents").then(async response=>{const body=await response.json();if(!response.ok)throw new Error(body.error);setDocuments(body.documents||[]);}),[]);
  useEffect(()=>{load().catch(reason=>setError(reason.message));},[load]);
  return <section className="rounded-2xl border bg-white p-6 shadow-sm"><p className="text-sm font-bold uppercase tracking-widest text-amber-700">Documents</p><h2 className="mt-2 text-xl font-black">Lease files and notices</h2>
    {error?<p role="alert" className="mt-3 text-red-700">{error}</p>:documents.length===0?<p className="mt-3 text-sm text-slate-500">No documents have been published to your portal.</p>:<div className="mt-4 space-y-3">{documents.map(document=><div key={document.id} className="flex items-center justify-between gap-4 rounded-xl border p-4"><div><strong>{document.title}</strong><p className="text-sm capitalize text-slate-500">{document.category} · {document.original_filename}</p></div><a href={document.download_url} target="_blank" rel="noreferrer" className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-bold text-white">View</a></div>)}</div>}
  </section>;}
