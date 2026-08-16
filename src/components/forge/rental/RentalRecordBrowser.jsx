"use client";

export default function RentalRecordBrowser({ title, records, selectedId, onSelect, getTitle, getSubtitle, getThumbnail, children, emptyMessage }) {
  return <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(260px,0.75fr)_minmax(0,1.5fr)]" data-rental-record-browser>
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white lg:sticky lg:top-6 lg:flex lg:max-h-[calc(100vh-3rem)] lg:flex-col">
      <div className="shrink-0 border-b border-slate-200 bg-slate-50 px-4 py-3"><h3 className="font-black">{title}</h3><p className="text-xs text-slate-500">{records.length} record{records.length === 1 ? "" : "s"}</p></div>
      {records.length === 0 ? <p className="p-4 text-sm text-slate-500">{emptyMessage}</p> : <div className="divide-y divide-slate-200 lg:overflow-y-auto">{records.map((record) => {
        const active = record.id === selectedId;
        const thumbnail = getThumbnail?.(record);
        return <button key={record.id} type="button" aria-current={active ? "true" : undefined} onClick={() => onSelect(record.id)}
          className={`flex w-full items-center gap-3 px-4 py-4 text-left transition ${active ? "bg-sky-50 shadow-[inset_4px_0_0_#0369a1]" : "hover:bg-slate-50"}`}>
          {getThumbnail && (thumbnail
            ? <img src={thumbnail} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" />
            : <span className="h-10 w-10 shrink-0 rounded-lg bg-slate-100" aria-hidden="true" />)}
          <span className="min-w-0"><strong className="block truncate text-sm text-slate-950">{getTitle(record)}</strong><span className="mt-1 block truncate text-xs text-slate-500">{getSubtitle(record)}</span></span>
        </button>;
      })}</div>}
    </div>
    <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5">{children}</div>
  </div>;
}
