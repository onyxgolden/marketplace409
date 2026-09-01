"use client";
import { useState } from "react";

export default function PrivateFinancingBorrowerInvite({ accountId, onInvited }) {
  const [form,setForm]=useState({fullName:"",email:"",role:"primary_borrower"});
  const [ack,setAck]=useState(false),[confirm,setConfirm]=useState(""),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
  const submit=async(event)=>{event.preventDefault();if(!ack||confirm!=="INVITE"||busy)return;setBusy(true);setMessage("");try{const response=await fetch(`/api/private-financing/accounts/${accountId}/borrowers/invite`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(form)});const payload=await response.json();if(!response.ok)throw new Error(payload.error||"Unable to invite borrower.");setMessage(`Invitation sent to ${payload.invitation.email}.`);setForm({fullName:"",email:"",role:"primary_borrower"});setAck(false);setConfirm("");onInvited?.();}catch(error){setMessage(error.message);}finally{setBusy(false);}};
  return <section aria-labelledby="pf-invite-heading" className="rounded-2xl border border-slate-200 p-5 text-slate-950 dark:border-slate-700 dark:text-slate-100">
    <h3 id="pf-invite-heading" className="text-lg font-black">Invite a borrower</h3>
    <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Creates access only to this financing account. The recipient must sign in with the exact invited email.</p>
    <form onSubmit={submit} className="mt-4 grid gap-3 sm:grid-cols-2">
      <label className="text-sm font-bold">Full name<input aria-label="Borrower full name" required value={form.fullName} onChange={e=>setForm({...form,fullName:e.target.value})} className="mt-1 w-full rounded-lg border p-2 text-slate-950"/></label>
      <label className="text-sm font-bold">Email<input aria-label="Borrower email" required type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})} className="mt-1 w-full rounded-lg border p-2 text-slate-950"/></label>
      <label className="text-sm font-bold">Role<select aria-label="Borrower role" value={form.role} onChange={e=>setForm({...form,role:e.target.value})} className="mt-1 w-full rounded-lg border bg-white p-2 text-slate-950 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"><option value="primary_borrower">Primary borrower</option><option value="co_borrower">Co-borrower</option><option value="guarantor">Guarantor</option></select></label>
      <div className="space-y-2 text-sm"><label className="flex gap-2"><input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)}/>I verified this recipient and understand this creates account access.</label><label className="font-bold">Type INVITE to confirm<input aria-label="Type INVITE to confirm" value={confirm} onChange={e=>setConfirm(e.target.value)} className="mt-1 w-full rounded-lg border p-2 text-slate-950"/></label></div>
      <button disabled={!ack||confirm!=="INVITE"||busy} className="rounded-xl bg-sky-700 px-4 py-2 font-bold text-white disabled:opacity-40">{busy?"Sending…":"Send invitation"}</button>
      {message?<p role="status" className="text-sm font-bold">{message}</p>:null}
    </form>
  </section>;
}
