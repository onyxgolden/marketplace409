// Dismissible narrow-viewport honesty banner for the chart builder. The
// chart builder is a precision-pointer canvas tool (drag nodes, rubber-band
// select, fine inspector edits) that silently fights a phone screen — this
// says so up front instead of leaving a silent dead end. md:hidden keeps it
// off desktop viewports; the parent owns the dismissed state.
export default function ChartBuilderSmallScreenNotice({ onDismiss }) {
  return (
    <div
      data-testid="chart-builder-small-screen-notice"
      className="border-b border-amber-200 bg-amber-50 px-4 py-3 md:hidden"
      role="note"
    >
      <p className="text-sm font-bold text-amber-900">
        Chart Builder works best on a larger screen.
      </p>
      <p className="mt-1 text-sm text-amber-800">
        Arranging chart nodes needs a precise pointer — dragging and selecting on a
        phone is cramped. Your saved charts are safe; continue on a desktop for the
        full editor.
      </p>
      <button
        type="button"
        onClick={onDismiss}
        className="mt-2 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-sm font-bold text-amber-900"
      >
        Keep exploring on this device
      </button>
    </div>
  );
}
