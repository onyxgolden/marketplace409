"use client";

export default function RentalRecordBrowser({ title, records, selectedId, onSelect, getTitle, getSubtitle, children, emptyMessage }) {
  return <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(260px,0.75fr)_minmax(0,1.5fr)]" data-rental-record-browser>
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="border-b border-slate-200 bg-slate-50 px-4 py-3"><h3 className="font-black">{title}</h3><p className="text-xs text-slate-500">{records.length} record{records.length === 1 ? "" : "s"}</p></div>
      {records.length === 0 ? <p className="p-4 text-sm text-slate-500">{emptyMessage}</p> : <div className="divide-y divide-slate-200">{records.map((record) => {
        const active = record.id === selectedId;
        return <button key={record.id} type="button" aria-current={active ? "true" : undefined} onClick={() => onSelect(record.id)}
          className={`w-full px-4 py-4 text-left transition ${active ? "bg-sky-50 shadow-[inset_4px_0_0_#0369a1]" : "hover:bg-slate-50"}`}>
          <strong className="block text-sm text-slate-950">{getTitle(record)}</strong><span className="mt-1 block text-xs text-slate-500">{getSubtitle(record)}</span>
        </button>;
      })}</div>}
    </div>
    <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5">{children}</div>
  </div>;
}
