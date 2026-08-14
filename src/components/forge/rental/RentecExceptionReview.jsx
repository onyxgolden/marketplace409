function Group({ title, rows = [] }) {
  return <div className="rounded-xl border p-4">
    <h4 className="font-black">{title}</h4>
    {rows.length ? <div className="mt-3 space-y-2">{rows.map((row) => <div key={row.label} className="flex justify-between gap-4 text-sm"><span>{row.label}</span><strong>{row.count}</strong></div>)}</div> : <p className="mt-3 text-sm text-slate-500">No exceptions in this group.</p>}
  </div>;
}

export default function RentecExceptionReview({ review }) {
  if (!review) return null;
  return <details className="rounded-xl border bg-slate-50 p-4">
    <summary className="cursor-pointer font-black">Review transaction exceptions by group</summary>
    <p className="mt-3 text-sm text-slate-600">Grouped totals only. Tenant names, transaction descriptions, and individual amounts are hidden.</p>
    <div className="mt-4 grid gap-4 lg:grid-cols-3">
      <Group title="API-only by year" rows={review.apiOnlyByYear}/>
      <Group title="API-only by property" rows={review.apiOnlyByProperty}/>
      <Group title="API-only by category" rows={review.apiOnlyByCategory}/>
      <Group title="Probable matches by year" rows={review.probableByYear}/>
      <Group title="Probable matches by category" rows={review.probableByCategory}/>
      <Group title="Conflict amount variance" rows={review.conflictVarianceBands}/>
      <Group title="Legacy-only by year" rows={review.legacyOnlyByYear}/>
      <Group title="Legacy-only by property" rows={review.legacyOnlyByProperty}/>
      <Group title="Legacy-only by category" rows={review.legacyOnlyByCategory}/>
    </div>
  </details>;
}
