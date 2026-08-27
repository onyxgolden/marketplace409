"use client";

export default function RentalRecordBrowser({ title, records, selectedId, onSelect, getTitle, getSubtitle, getThumbnail, columns, children, emptyMessage, listSize = "compact" }) {
  const layoutClassName = listSize === "wide"
    ? "lg:grid-cols-[minmax(520px,1.4fr)_minmax(320px,1fr)]"
    : "lg:grid-cols-[minmax(260px,0.75fr)_minmax(0,1.5fr)]";
  return <div className={`mt-6 grid gap-5 ${layoutClassName}`} data-rental-record-browser data-list-size={listSize}>
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900 lg:sticky lg:top-6 lg:flex lg:max-h-[calc(100vh-3rem)] lg:flex-col">
      <div className="shrink-0 border-b border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-800"><h3 className="font-black text-slate-950 dark:text-white">{title}</h3><p className="text-xs text-slate-500 dark:text-slate-400">{records.length} record{records.length === 1 ? "" : "s"}</p></div>
      {records.length === 0 ? <p className="p-4 text-sm text-slate-500 dark:text-slate-400">{emptyMessage}</p> : columns ? <div className="lg:overflow-y-auto">
        <table className="w-full table-fixed text-left text-sm">
          <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800"><tr>{getThumbnail && <th className="w-20 px-3 py-2" aria-hidden="true" />}{columns.map((column) => <th key={column.header} className="px-2 py-2 text-xs font-black uppercase tracking-wide text-slate-500 first:pl-4 dark:text-slate-400">{column.header}</th>)}</tr></thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-700">{records.map((record) => {
            const active = record.id === selectedId;
            const thumbnail = getThumbnail?.(record);
            return <tr key={record.id} aria-current={active ? "true" : undefined} role="button" tabIndex={0}
              onClick={() => onSelect(record.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(record.id); } }}
              className={`cursor-pointer transition ${active ? "bg-sky-50 shadow-[inset_4px_0_0_#0369a1] dark:bg-sky-950/60 dark:shadow-[inset_4px_0_0_#38bdf8]" : "hover:bg-slate-50 dark:hover:bg-slate-800"}`}>
              {getThumbnail && <td className="w-20 px-3 py-3">{thumbnail
                ? <img src={thumbnail} alt="" className="h-14 w-14 min-h-14 min-w-14 rounded-lg object-cover" />
                : <span className="block h-14 w-14 min-h-14 min-w-14 rounded-lg bg-slate-100 dark:bg-slate-800" aria-hidden="true" />}</td>}
              {columns.map((column, index) => <td key={column.header} className={`px-2 py-3 align-top ${index === 0 && !getThumbnail ? "pl-4" : ""}`}>{column.render(record)}</td>)}
            </tr>;
          })}</tbody>
        </table>
      </div> : <div className="divide-y divide-slate-200 dark:divide-slate-700 lg:overflow-y-auto">{records.map((record) => {
        const active = record.id === selectedId;
        const thumbnail = getThumbnail?.(record);
        return <button key={record.id} type="button" aria-current={active ? "true" : undefined} onClick={() => onSelect(record.id)}
          className={`flex w-full items-center gap-3 px-4 py-4 text-left transition ${active ? "bg-sky-50 shadow-[inset_4px_0_0_#0369a1] dark:bg-sky-950/60 dark:shadow-[inset_4px_0_0_#38bdf8]" : "hover:bg-slate-50 dark:hover:bg-slate-800"}`}>
          {getThumbnail && (thumbnail
            ? <img src={thumbnail} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" />
            : <span className="h-10 w-10 shrink-0 rounded-lg bg-slate-100 dark:bg-slate-800" aria-hidden="true" />)}
          <span className="min-w-0"><strong className="block truncate text-sm text-slate-950 dark:text-white">{getTitle(record)}</strong><span className="mt-1 block truncate text-xs text-slate-500 dark:text-slate-400">{getSubtitle(record)}</span></span>
        </button>;
      })}</div>}
    </div>
    <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">{children}</div>
  </div>;
}
