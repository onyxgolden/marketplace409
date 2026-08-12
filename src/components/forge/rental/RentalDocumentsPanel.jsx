"use client";
import { useCallback, useEffect, useState } from "react";
export default function RentalDocumentsPanel(){
  const [documents,setDocuments]=useState([]);const [schedules,setSchedules]=useState([]);const [error,setError]=useState("");const [message,setMessage]=useState("");
  const load=useCallback(()=>Promise.all([fetch("/api/rental/documents"),fetch("/api/rental")]).then(async([documentResponse,rentalResponse])=>{
    const documentBody=await documentResponse.json();const rentalBody=await rentalResponse.json();
    if(!documentResponse.ok)throw new Error(documentBody.error);if(!rentalResponse.ok)throw new Error(rentalBody.error);
    setDocuments(documentBody.documents||[]);setSchedules(rentalBody.schedules||[]);
  }),[]);
  useEffect(()=>{load().catch(reason=>setError(reason.message));},[load]);
  async function upload(event){event.preventDefault();setError("");setMessage("");const form=new FormData(event.currentTarget);
    form.set("tenantVisible",form.get("tenantVisible")==="on"?"true":"false");
    try{const response=await fetch("/api/rental/documents",{method:"POST",body:form});const body=await response.json();if(!response.ok)throw new Error(body.error);
      event.currentTarget.reset();await load();setMessage("Document uploaded and access settings saved.");}catch(reason){setError(reason.message);}}
  return <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><p className="text-sm font-bold uppercase tracking-widest text-amber-700">Document library</p>
    <h2 className="mt-2 text-2xl font-black">Lease documents and notices</h2><p className="mt-2 text-slate-600">Upload a private record and explicitly choose whether the tenant can access it.</p>
    {error?<p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-red-800">{error}</p>:null}{message?<p className="mt-4 rounded-xl bg-emerald-50 p-3 text-emerald-800">{message}</p>:null}
    <form onSubmit={upload} className="mt-6 grid gap-4 md:grid-cols-2"><label className="text-sm font-bold">Lease<select name="leaseId" required className="mt-1 w-full rounded-lg border p-3 font-normal"><option value="">Select a lease</option>{schedules.map(schedule=><option key={schedule.id} value={schedule.lease_id}>{schedule.lease_id}</option>)}</select></label>
      <label className="text-sm font-bold">Category<select name="category" required defaultValue="lease" className="mt-1 w-full rounded-lg border p-3 font-normal"><option value="lease">Lease</option><option value="addendum">Addendum</option><option value="notice">Notice</option><option value="inspection">Inspection</option><option value="receipt">Receipt</option><option value="other">Other</option></select></label>
      <label className="text-sm font-bold">Document title<input name="title" required className="mt-1 w-full rounded-lg border p-3 font-normal" placeholder="Signed residential lease"/></label>
      <label className="text-sm font-bold">File<input name="file" type="file" required accept=".pdf,.jpg,.jpeg,.png,.txt" className="mt-1 block w-full rounded-lg border p-3 font-normal"/></label>
      <label className="flex items-center gap-3 rounded-lg bg-blue-50 p-4 text-sm font-bold md:col-span-2"><input type="checkbox" name="tenantVisible"/> Publish this document to the tenant portal</label>
      <button className="rounded-lg bg-slate-950 px-5 py-3 font-bold text-white md:col-span-2">Upload document</button></form>
    <div className="mt-8 border-t pt-6"><h3 className="font-black">Saved documents</h3>{documents.length===0?<p className="mt-2 text-sm text-slate-500">No rental documents uploaded.</p>:documents.map(document=><div key={document.id} className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4"><div><strong>{document.title}</strong><p className="text-sm capitalize text-slate-500">{document.category} · {document.tenant_visible?"Visible to tenant":"Private to landlord"}</p><p className="mt-1 text-sm font-bold text-slate-700">{document.acknowledgements?.length||0} tenant acknowledgement{document.acknowledgements?.length===1?"":"s"}</p>{document.acknowledgements?.map(item=><p key={item.tenant_id} className="text-xs text-slate-500">Tenant {item.tenant_id} · {new Date(item.acknowledged_at).toLocaleString()}</p>)}</div><a href={document.download_url} target="_blank" rel="noreferrer" className="font-bold text-blue-700 underline">Open document</a></div>)}</div>
  </section>;
}
