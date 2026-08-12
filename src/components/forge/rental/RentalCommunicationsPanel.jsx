"use client";
import{useCallback,useEffect,useState}from"react";
export default function RentalCommunicationsPanel(){const[notifications,setNotifications]=useState([]);const[error,setError]=useState("");
const load=useCallback(()=>fetch("/api/rental").then(async response=>{const body=await response.json();if(!response.ok)throw new Error(body.error);setNotifications(body.notifications||[]);}),[]);
useEffect(()=>{load().catch(reason=>setError(reason.message));},[load]);
return <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><p className="text-sm font-bold uppercase tracking-widest text-amber-700">Communications</p><h2 className="mt-2 text-2xl font-black">Notification outbox</h2>
<p className="mt-2 text-slate-600">Payment, maintenance, and document events are recorded here before delivery. Real email sending remains disabled until a provider and sender domain are approved.</p>
{error?<p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-red-800">{error}</p>:null}<div className="mt-6 space-y-3">{notifications.length===0?<p className="rounded-xl bg-slate-50 p-4 text-slate-600">No notifications queued.</p>:notifications.map(item=><article key={item.id} className="rounded-xl border p-4"><div className="flex flex-wrap justify-between gap-3"><strong>{item.subject}</strong><span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold uppercase text-amber-900">{item.status}</span></div><p className="mt-1 text-sm text-slate-500">To {item.recipient} · {item.notification_type.replaceAll("_"," ")}</p><p className="mt-3 text-sm text-slate-700">{item.body_text}</p></article>)}</div>
</section>;}
