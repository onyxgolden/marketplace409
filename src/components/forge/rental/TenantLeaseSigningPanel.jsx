"use client";import{useState}from"react";
// Same term labels RentalLeasePreparationPanel.jsx (the owner-side editor) uses, so a tenant reads
// the exact same field names the owner filled in -- never a re-derived or re-worded copy of them.
const fields=[['landlordName','Landlord/legal owner'],['tenantNames','Tenant names'],['propertyAddress','Rental property address'],['leaseStart','Lease start'],['leaseEnd','Lease end'],['monthlyRent','Monthly rent'],['dueDay','Rent due day'],['securityDeposit','Security deposit'],['lateFeeTerms','Late-fee terms'],['utilities','Utilities responsibility'],['pets','Pet terms'],['maintenance','Maintenance responsibilities'],['specialProvisions','Special provisions']];
const dateTime=new Intl.DateTimeFormat("en-US",{month:"short",day:"numeric",year:"numeric",hour:"numeric",minute:"2-digit"});
export default function TenantLeaseSigningPanel({rentals,onSigned}){
  const pending=rentals.filter(r=>r.leaseSigning);
  if(pending.length===0)return null;
  return <section className="rounded-2xl border bg-white p-6 shadow-sm"><p className="text-sm font-bold uppercase tracking-widest text-amber-700">Lease review</p><h2 className="mt-2 text-xl font-black">Sign your lease</h2>
    <div className="mt-4 space-y-6">{pending.map(rental=><LeaseSigningCard key={rental.lease.id} rental={rental} onSigned={onSigned}/>)}</div>
  </section>;
}
function LeaseSigningCard({rental,onSigned}){
  const{lease,unit,leaseSigning}=rental;
  const[expanded,setExpanded]=useState(!leaseSigning.signedByMe);
  const[busy,setBusy]=useState(false);
  const[error,setError]=useState("");
  const signedCount=leaseSigning.signatures.length;
  async function sign(event){
    event.preventDefault();setBusy(true);setError("");
    try{
      const formData=new FormData(event.currentTarget);
      const response=await fetch("/api/rental/portal",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({
        operation:"sign-lease",leaseId:lease.id,preparationId:leaseSigning.preparationId,versionNumber:leaseSigning.versionNumber,
        signerName:formData.get("signerName"),
      })});
      const body=await response.json();if(!response.ok)throw new Error(body.error);
      await onSigned();
    }catch(reason){setError(reason.message);}finally{setBusy(false);}
  }
  return <article className="rounded-xl border p-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><strong>{unit?.label||"Rental home"}</strong><p className="text-sm text-slate-500">Lease {lease.startDate}{lease.endDate?` through ${lease.endDate}`:" — current"} · version {leaseSigning.versionNumber}</p></div>
      <div className="text-right text-sm">
        {leaseSigning.signedByMe?<span className="font-bold text-emerald-700">You signed {dateTime.format(new Date(leaseSigning.mySignedAt))}</span>:<span className="font-bold text-amber-700">Your signature is needed</span>}
        <p className="text-slate-500">{signedCount} of {leaseSigning.totalTenants} tenant{leaseSigning.totalTenants===1?"":"s"} signed</p>
      </div>
    </div>
    <button type="button" onClick={()=>setExpanded(current=>!current)} className="mt-3 text-sm font-bold text-sky-700 underline-offset-2 hover:underline">{expanded?"Hide terms":"Review terms"}</button>
    {expanded?<div className="mt-4 space-y-4">
      <dl className="grid gap-3 sm:grid-cols-2">{fields.map(([key,label])=>{const value=leaseSigning.terms?.[key];if(!value)return null;return <div key={key}><dt className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</dt><dd className="text-sm text-slate-800">{value}</dd></div>;})}</dl>
      {leaseSigning.signatures.length>0?<div className="border-t pt-3 text-sm text-slate-600"><p className="font-bold text-slate-700">Signed so far</p>{leaseSigning.signatures.map(s=><p key={s.tenantId}>{s.displayName} — {dateTime.format(new Date(s.signedAt))}</p>)}</div>:null}
      {leaseSigning.signedByMe?null:<form onSubmit={sign} className="space-y-3 rounded-xl border border-dashed border-slate-300 p-4">
        <p className="text-sm text-slate-700">By typing your full legal name below and checking the box, you are signing this lease electronically. This carries the same legal effect as a handwritten signature.</p>
        <label className="block text-sm font-bold">Type your full legal name<input name="signerName" required minLength={2} className="mt-1 w-full rounded-lg border p-3 font-normal"/></label>
        <label className="flex gap-3 text-sm"><input name="acknowledged" type="checkbox" required/><span>I have read and agree to the terms of Lease Preparation Version {leaseSigning.versionNumber}, and I consent to sign electronically.</span></label>
        {error?<p role="alert" className="text-sm font-bold text-rose-700">{error}</p>:null}
        <button disabled={busy} className="rounded-xl bg-slate-950 px-5 py-3 font-bold text-white disabled:opacity-50">{busy?"Signing…":"Sign lease"}</button>
      </form>}
    </div>:null}
  </article>;
}
