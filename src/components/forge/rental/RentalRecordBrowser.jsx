"use client";
import { CARD_REGION_ATTRIBUTE } from "./CardContextMenu";
import { ColumnFilterInput, ColumnFilterTitle, ColumnSortButton, useColumnFilters } from "./ColumnFilter";

export default function RentalRecordBrowser({ title, records, selectedId, onSelect, getTitle, getSubtitle, getThumbnail, columns, children, emptyMessage, listSize = "compact", onRowContextMenu = null }) {
  // No detail child (e.g. the Tenants index): the list takes the full width.
  // With a detail child the list/detail split applies.
  const hasDetail = Boolean(children);
  const layoutClassName = !hasDetail
    ? ""
    : listSize === "wide"
      ? "lg:grid-cols-[minmax(520px,1.4fr)_minmax(280px,0.9fr)]"
      : "lg:grid-cols-[minmax(260px,0.75fr)_minmax(0,1.5fr)]";
  // Column-title filters (tables only; card lists have no columns). The
  // filter applies to the displayed rows; selection + detail stay owned by
  // the calling panel, so a filtered-out selected record keeps its detail.
  const columnFilters = useColumnFilters();
  const visibleRecords = columns ? columnFilters.apply(records, columns) : records;
  return <div className={`mt-6 grid gap-4 ${layoutClassName}`} data-rental-record-browser data-list-size={listSize}>
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900 lg:sticky lg:top-6 lg:flex lg:max-h-[calc(100vh-3rem)] lg:flex-col">
      <div className="shrink-0 border-b border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-800"><h3 className="font-black text-slate-950 dark:text-white">{title}</h3><p className="text-xs text-slate-500 dark:text-slate-400">{columns && columnFilters.activeCount > 0 ? `${visibleRecords.length} of ${records.length} records` : `${records.length} record${records.length === 1 ? "" : "s"}`}</p>{columns && columnFilters.activeCount > 0 && <button type="button" onClick={columnFilters.clearAll} className="mt-1 text-xs font-black text-sky-700 underline hover:text-sky-900 dark:text-sky-400 dark:hover:text-sky-200">Clear column filters</button>}</div>
      {records.length === 0 ? <p className="p-4 text-sm text-slate-500 dark:text-slate-400">{emptyMessage}</p> : columns ? visibleRecords.length === 0 ? <div className="p-4"><p className="text-sm text-slate-500 dark:text-slate-400">No records match these column filters.</p><button type="button" onClick={columnFilters.clearAll} className="mt-2 text-sm font-black text-sky-700 underline hover:text-sky-900 dark:text-sky-400 dark:hover:text-sky-200">Clear column filters</button></div> : <div className="lg:overflow-y-auto">
        <table className="w-full table-fixed text-left text-sm">
          <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800"><tr>{getThumbnail && <th className="w-16 px-3 py-2" aria-hidden="true" />}{columns.map((column) => <th key={column.header} style={column.width ? { width: column.width } : undefined} className={`px-2 py-2 text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400 ${column.align === "right" ? "text-right" : "text-left"}`}>{column.filterText ? <span className="inline-flex items-center gap-1"><ColumnFilterTitle label={column.header} active={String(columnFilters.filters[column.header] ?? "").trim() !== ""} open={columnFilters.openKey === column.header} onToggle={() => columnFilters.toggle(column.header)} /><ColumnSortButton label={column.header} direction={columnFilters.sort?.key === column.header ? columnFilters.sort.direction : null} onToggle={() => columnFilters.toggleSort(column.header)} /></span> : column.header}</th>)}</tr>{columnFilters.openKey && <tr>{getThumbnail && <td className="px-3 py-1" aria-hidden="true" />}{columns.map((column) => <td key={column.header} className="px-2 py-1">{column.header === columnFilters.openKey ? <ColumnFilterInput label={column.header} value={columnFilters.filters[column.header] ?? ""} onChange={(value) => columnFilters.setFilter(column.header, value)} onClear={() => columnFilters.clearFilter(column.header)} /> : null}</td>)}</tr>}</thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-700">{visibleRecords.map((record, rowIndex) => {
            const active = record.id === selectedId;
            const thumbnail = getThumbnail?.(record);
            // Zebra striping (Rentec parity): every other row gets a faint wash so dense
            // tables stay scannable. The selected row's highlight always wins.
            const zebraClass = active ? "" : rowIndex % 2 === 1 ? "bg-slate-100/70 dark:bg-slate-800/40" : "";
            const rowMenuProps = onRowContextMenu ? { [CARD_REGION_ATTRIBUTE]: "", onContextMenu: (event) => onRowContextMenu(event, record) } : {};
            return <tr key={record.id} aria-current={active ? "true" : undefined} role="button" tabIndex={0}
              {...rowMenuProps}
              onClick={() => onSelect(record.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(record.id); } }}
              className={`cursor-pointer transition ${zebraClass} ${active ? "bg-sky-50 shadow-[inset_4px_0_0_#0369a1] dark:bg-sky-950/60 dark:shadow-[inset_4px_0_0_#38bdf8]" : "hover:bg-slate-100 dark:hover:bg-slate-800"}`}>
              {getThumbnail && <td className="w-16 px-3 py-2">{thumbnail
                ? <img src={thumbnail} alt="" className="h-10 w-10 min-h-10 min-w-10 rounded-lg object-cover" />
                : <span className="block h-10 w-10 min-h-10 min-w-10 rounded-lg bg-slate-100 dark:bg-slate-800" aria-hidden="true" />}</td>}
              {columns.map((column, index) => <td key={column.header} className={`px-2 py-2 align-top text-slate-800 dark:text-slate-200 ${column.align === "right" ? "text-right tabular-nums" : ""} ${index === 0 && !getThumbnail ? "pl-4" : ""}`}>{column.render(record)}</td>)}
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
    <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">{children}</div>
  </div>;
}
