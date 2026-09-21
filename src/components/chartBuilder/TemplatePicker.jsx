"use client";

import {
  listChartTemplatesByType,
} from "@/domains/chartBuilder";

const BLURBS = {
  "org-classic-hierarchy": "Top-down reporting tree for the whole company.",
  "org-executive-tree": "C-suite tree with larger executive cards.",
  "org-department-columns": "One tidy tree per department, side by side.",
  "org-compact-tv-board": "Dense pill grid that reads on a big TV.",
  "workflow-left-to-right": "Straightforward left-to-right process steps.",
  "workflow-swimlane": "Steps grouped into department lanes.",
  "workflow-decision-tree": "Yes/no branches with a feedback loop.",
  "workflow-kanban-flow": "To-do / doing / done style columns.",
};

function MiniPreview({ template }) {
  const algo = template.layoutPreset?.algorithm;
  const color = template.defaultNodeStyle?.color ?? "#1f6feb";
  if (algo === "tidy-tree" || algo === "binary-tree") {
    return (
      <svg viewBox="0 0 120 70" className="h-16 w-full">
        <rect x="45" y="4" width="30" height="14" rx="3" fill={color} />
        <rect x="12" y="48" width="30" height="14" rx="3" fill={color} opacity="0.75" />
        <rect x="78" y="48" width="30" height="14" rx="3" fill={color} opacity="0.75" />
        <path d="M60 18 V33 M30 33 V48 M90 33 V48 M30 33 H90" stroke="#6b7280" fill="none" strokeWidth="2" />
      </svg>
    );
  }
  if (algo === "column-group") {
    return (
      <svg viewBox="0 0 120 70" className="h-16 w-full">
        {[8, 46, 84].map((x) => (
          <g key={x}>
            <rect x={x} y="6" width="28" height="12" rx="3" fill={color} />
            <rect x={x} y="44" width="28" height="12" rx="3" fill={color} opacity="0.7" />
            <path d={`M${x + 14} 18 V44`} stroke="#6b7280" strokeWidth="2" />
          </g>
        ))}
      </svg>
    );
  }
  if (algo === "compact-grid") {
    return (
      <svg viewBox="0 0 120 70" className="h-16 w-full">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <rect
            key={i}
            x={8 + (i % 3) * 38}
            y={8 + Math.floor(i / 3) * 26}
            width="32"
            height="18"
            rx="9"
            fill={color}
            opacity={i === 0 ? 1 : 0.7}
          />
        ))}
      </svg>
    );
  }
  if (algo === "swimlane") {
    return (
      <svg viewBox="0 0 120 70" className="h-16 w-full">
        <rect x="4" y="4" width="112" height="28" rx="4" fill="none" stroke="#9ca3af" strokeDasharray="4 3" />
        <rect x="4" y="38" width="112" height="28" rx="4" fill="none" stroke="#9ca3af" strokeDasharray="4 3" />
        <rect x="10" y="12" width="30" height="12" rx="3" fill={color} />
        <rect x="48" y="12" width="30" height="12" rx="3" fill={color} opacity="0.7" />
        <rect x="48" y="46" width="30" height="12" rx="3" fill={color} opacity="0.7" />
        <path d="M40 18 H48 M63 24 V46" stroke="#6b7280" strokeWidth="2" fill="none" />
      </svg>
    );
  }
  // layered / kanban-columns default: horizontal flow
  return (
    <svg viewBox="0 0 120 70" className="h-16 w-full">
      <rect x="6" y="26" width="26" height="18" rx="4" fill={color} />
      <rect x="47" y="26" width="26" height="18" rx="4" fill={color} opacity="0.8" />
      <rect x="88" y="26" width="26" height="18" rx="4" fill={color} opacity="0.6" />
      <path d="M32 35 H47 M73 35 H88" stroke="#6b7280" strokeWidth="2" />
      <path d="M44 31 L48 35 L44 39 M85 31 L89 35 L85 39" stroke="#6b7280" strokeWidth="2" fill="none" />
    </svg>
  );
}

export default function TemplatePicker({ onPick }) {
  const sections = [
    { title: "Organization charts", templates: listChartTemplatesByType("org") },
    { title: "Workflow charts", templates: listChartTemplatesByType("workflow") },
  ];
  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="text-2xl font-bold text-slate-900">New chart</h1>
      <p className="mt-1 text-sm text-slate-600">
        Pick a template to start. You can drag nodes around, reparent people by
        dropping them on a new supervisor, and change the slide background any time.
      </p>
      {sections.map((section) => (
        <div key={section.title} className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            {section.title}
          </h2>
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {section.templates.map((template) => (
              <button
                key={template.id}
                type="button"
                onClick={() => onPick(template)}
                className="group rounded-xl border border-slate-200 bg-white p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
              >
                <MiniPreview template={template} />
                <div className="mt-2 text-sm font-semibold text-slate-900">
                  {template.name}
                </div>
                <div className="mt-0.5 text-xs leading-snug text-slate-500">
                  {BLURBS[template.id] ?? ""}
                </div>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
