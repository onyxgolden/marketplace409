export const HVAC_WORKFLOW_CHOICES =
  Object.freeze([
    Object.freeze({
      id: "service",
      label:
        "Inspection or service",
      explanation:
        "Record inspection findings, routine service, invoice details, and any work completed without replacing the entire system.",
    }),
    Object.freeze({
      id: "component",
      label:
        "Component repair or replacement",
      explanation:
        "Record work on a compressor, motor, coil, capacitor, control, refrigerant circuit, or another replaceable component.",
    }),
    Object.freeze({
      id: "failure",
      label:
        "Complete system failure",
      explanation:
        "Document that the selected system failed while preserving its identity, components, evidence, and prior service history.",
    }),
    Object.freeze({
      id: "replacement",
      label:
        "Complete system replacement",
      explanation:
        "Preserve the former system as replaced and create a separate active system linked to it through one approved transition.",
    }),
    Object.freeze({
      id: "evidence",
      label:
        "Property evidence",
      explanation:
        "Review preserved invoices, service photographs, extraction provenance, approval state, and the HVAC records linked to each item.",
    }),
  ]);

export function getHVACWorkflowChoice(
  workflowId,
) {
  return (
    HVAC_WORKFLOW_CHOICES.find(
      ({ id }) =>
        id === workflowId,
    ) || null
  );
}

export function PropertyHVACWorkflowHeader({
  workflowId,
  showGuidance = true,
  onBack = () => {},
}) {
  const choice =
    getHVACWorkflowChoice(
      workflowId,
    );

  if (!choice) {
    return null;
  }

  return (
    <div
      data-property-hvac-workflow-header
      className="flex flex-wrap items-start justify-between gap-4"
    >
      <div>
        <div className="text-xs font-black uppercase tracking-wide text-sky-700 dark:text-sky-400">
          HVAC Workflow
        </div>

        <h5 className="mt-1 text-xl font-black text-slate-950 dark:text-slate-50">
          {choice.label}
        </h5>

        {showGuidance && (
          <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-slate-600 dark:text-slate-300">
            {choice.explanation}
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={onBack}
        className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-black text-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700"
      >
        Back
      </button>
    </div>
  );
}

export default function PropertyHVACWorkflowChooser({
  showGuidance = true,
  onToggleGuidance = () => {},
  onChoose = () => {},
}) {
  return (
    <section
      data-property-hvac-workflow-chooser
      className="mt-6 max-w-3xl"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h5 className="text-base font-black text-slate-950 dark:text-slate-50">
          What do you want to do?
        </h5>

        <button
          type="button"
          aria-pressed={
            showGuidance
          }
          onClick={
            onToggleGuidance
          }
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-black text-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700"
        >
          Guidance{" "}
          {showGuidance
            ? "on"
            : "off"}
        </button>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {HVAC_WORKFLOW_CHOICES.map(
          (choice) => (
            <button
              key={choice.id}
              type="button"
              onClick={() =>
                onChoose(
                  choice.id,
                )
              }
              className="rounded-xl border border-slate-200 bg-white p-4 text-left text-sm font-black text-slate-900 shadow-sm transition hover:border-sky-400 hover:bg-sky-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-50 dark:hover:border-sky-500 dark:hover:bg-slate-800"
            >
              {choice.label}
            </button>
          ),
        )}
      </div>
    </section>
  );
}
