import { useEffect, useRef, useState } from "react";
import { createPrintableChart, printChart } from "@/domains/chartBuilder";

// Chrome-free print view for /forge/charts (slice 4.3). Renders the static
// SVG from createPrintableChart — no toolbar, no inspector, no node handles,
// no grid controls — then opens the browser print dialog exactly once.
// afterprint returns the user to the builder.
export default function ChartPrintView({ doc, onClose }) {
  const [printable] = useState(() => {
    try {
      return { value: createPrintableChart(doc) };
    } catch (error) {
      return { error };
    }
  });
  const didPrint = useRef(false);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!printable.value || didPrint.current) return;
    didPrint.current = true;
    printChart(doc);
    const handleAfterPrint = () => onCloseRef.current?.();
    window.addEventListener("afterprint", handleAfterPrint);
    return () => window.removeEventListener("afterprint", handleAfterPrint);
  }, [doc, printable.value]);

  if (!printable.value) {
    const message =
      printable.error instanceof Error ? printable.error.message : "Could not prepare this chart for printing.";
    return (
      <div className="min-h-screen bg-white px-8 py-10">
        <p role="alert" className="text-sm text-red-700">{message}</p>
        <button
          type="button"
          className="mt-4 rounded border border-slate-300 px-3 py-1.5 text-sm"
          onClick={() => onCloseRef.current?.()}
        >
          Back to chart builder
        </button>
      </div>
    );
  }

  const { title, svg } = printable.value;
  const printedAt = new Date().toLocaleString();

  return (
    <div className="min-h-screen bg-white px-8 py-10 text-slate-900">
      <div className="mx-auto max-w-5xl">
        <h1 className="text-2xl font-bold">{title}</h1>
        <p className="mt-1 text-sm text-slate-500">Printed {printedAt}</p>
        <div
          className="mt-6 overflow-auto border border-slate-200"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
        <div className="mt-6 flex gap-2 print:hidden">
          <button
            type="button"
            className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50"
            onClick={() => onCloseRef.current?.()}
          >
            Back to chart builder
          </button>
        </div>
      </div>
    </div>
  );
}
