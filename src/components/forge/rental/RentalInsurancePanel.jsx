export default function RentalInsurancePanel() {
  return <section className="rounded-2xl border bg-white p-7"><p className="text-sm font-bold uppercase tracking-widest text-amber-700">Texas compliance</p>
    <h2 className="mt-2 text-2xl font-black">Renters insurance</h2><p className="mt-2 max-w-2xl text-slate-600">Kent Avenue requires renters insurance under the lease. FORGE will verify continuing coverage while allowing the tenant to use any qualifying insurer.</p>
    <div className="mt-6 grid gap-4 md:grid-cols-2"><article className="rounded-xl border p-5"><h3 className="font-black">External provider links</h3><p className="mt-2 text-sm text-slate-600">FORGE only links tenants to independent providers. FORGE does not quote, bind, sell, service, or collect premiums. A referral-fee disclosure appears beside any compensated link.</p></article>
      <article className="rounded-xl border p-5"><h3 className="font-black">Coverage verification</h3><p className="mt-2 text-sm text-slate-600">Carrier-neutral verification integration pending. Policy evidence and expiration tracking are ready in the data model.</p></article></div>
    <article className="mt-4 rounded-xl border border-violet-200 bg-violet-50 p-5"><h3 className="font-black">Dog liability coverage</h3>
      <p className="mt-2 text-sm text-slate-700">When required by the landlord’s insurer for a pet, verify bodily injury, property damage, absence of the applicable breed exclusion, policy limits, and landlord/additional-insured evidence.</p>
      <p className="mt-2 text-sm font-bold text-violet-900">Assistance-animal requests always pause this workflow for documented human review.</p></article>
    <article className="mt-4 rounded-xl border p-5"><h3 className="font-black">Pet approval and monthly fees</h3>
      <p className="mt-2 text-sm text-slate-700">Every pet must be approved individually by the landlord. Each approved pet receives its own recurring monthly fee, approval evidence, and effective dates.</p></article>
    <div className="mt-5 rounded-xl bg-amber-50 p-4 text-sm text-amber-900"><strong>Launch control:</strong> lease requirement confirmed. Verify the actual clause, required liability limit, and Texas referral rules before activating any compensated outbound link. Premiums always go directly to the insurance provider.</div>
  </section>;
}
