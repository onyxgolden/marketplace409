"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { findOrgChart } from "@/domains/roomDesigner/designerDocument";
import { descendantsOf } from "@/domains/roomDesigner/orgChartLayout";

const inputClass =
  "mt-1 block w-full rounded bg-gray-800 px-2 py-1.5 text-sm text-white placeholder:text-gray-600 outline-none focus:ring-2 focus:ring-emerald-500";

/**
 * Right-rail panel for Phase 3 people org charts. Two modes:
 * - tool mode (no chart selected): how-to + the design's charts, click to edit.
 * - editor mode (a chart is selected): rename the chart, add people with
 *   name/title/department, assign managers (reporting lines), remove people.
 *
 * Text stays TV-readable: labels text-xs, inputs text-sm, buttons py-2.
 */
export default function OrgChartPanel({ state, dispatch }) {
  const { design, selection } = state;
  const chart =
    selection?.kind === "orgchart" ? findOrgChart(design, selection.id) : null;
  if (!chart) {
    return <OrgChartToolPanel design={design} dispatch={dispatch} />;
  }
  return <OrgChartEditor chart={chart} dispatch={dispatch} />;
}

function OrgChartToolPanel({ design, dispatch }) {
  const charts = design.orgCharts || [];
  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold text-white">Org chart</h2>
      <p className="mb-3 text-xs text-gray-400">
        Click the plan to place a people org chart. Then add people with
        names, titles, and departments, and assign managers to draw the
        reporting lines.
      </p>
      {charts.length === 0 ? (
        <p className="text-xs text-gray-500">No org charts yet — click the plan to place one.</p>
      ) : (
        <div>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
            Charts in this design
          </h3>
          <ul className="space-y-1">
            {charts.map((c) => (
              <li key={c.id}>
                <button
                  onClick={() => dispatch({ type: "SELECT", selection: { kind: "orgchart", id: c.id } })}
                  className="flex w-full items-center justify-between rounded bg-gray-800 px-2 py-2 text-left text-sm text-gray-200 hover:bg-gray-700"
                >
                  <span className="truncate font-medium">{c.name}</span>
                  <span className="ml-2 shrink-0 text-xs text-gray-500">
                    {(c.nodes || []).length} {(c.nodes || []).length === 1 ? "person" : "people"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** People this person may report to: everyone except themselves and their own reports. */
function managerOptions(chart, personId) {
  const excluded = descendantsOf(chart.nodes, personId);
  excluded.add(personId);
  return (chart.nodes || []).filter((p) => !excluded.has(p.id));
}

function ManagerSelect({ chart, personId, value, onChange, id }) {
  return (
    <select
      id={id}
      value={value || ""}
      onChange={(e) => onChange(e.target.value || null)}
      className={inputClass}
    >
      <option value="">Top level (no manager)</option>
      {managerOptions(chart, personId).map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  );
}

function OrgChartEditor({ chart, dispatch }) {
  const [draft, setDraft] = useState({ name: "", title: "", department: "", managerId: "" });
  const people = chart.nodes || [];

  const addDraftPerson = () => {
    if (!draft.name.trim()) return;
    dispatch({
      type: "ADD_PERSON",
      chartId: chart.id,
      person: {
        name: draft.name.trim(),
        title: draft.title.trim(),
        department: draft.department.trim(),
        managerId: draft.managerId || null,
      },
    });
    setDraft({ name: "", title: "", department: "", managerId: "" });
  };

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white">Org chart</h2>
        <button
          onClick={() => dispatch({ type: "DELETE_SELECTION" })}
          className="flex items-center gap-1 rounded bg-gray-800 px-2 py-1.5 text-xs text-red-300 hover:bg-gray-700"
          title="Delete this org chart"
        >
          <Trash2 size={13} /> Delete chart
        </button>
      </div>

      <label className="block text-xs text-gray-400">
        Chart name
        <input
          type="text"
          value={chart.name}
          onChange={(e) => dispatch({ type: "RENAME_ORG_CHART", chartId: chart.id, name: e.target.value })}
          className={inputClass}
        />
      </label>

      <h3 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-gray-500">
        People ({people.length})
      </h3>
      <ul className="space-y-2">
        {people.map((person) => (
          <li key={person.id} className="rounded border border-gray-700 bg-gray-800/60 p-2">
            <div className="grid grid-cols-2 gap-1">
              <label className="block text-xs text-gray-400">
                Name
                <input
                  type="text"
                  value={person.name}
                  onChange={(e) =>
                    dispatch({
                      type: "UPDATE_PERSON",
                      chartId: chart.id,
                      personId: person.id,
                      fields: { name: e.target.value },
                    })
                  }
                  className={inputClass}
                />
              </label>
              <label className="block text-xs text-gray-400">
                Title / role
                <input
                  type="text"
                  value={person.title || ""}
                  placeholder="e.g. Project manager"
                  onChange={(e) =>
                    dispatch({
                      type: "UPDATE_PERSON",
                      chartId: chart.id,
                      personId: person.id,
                      fields: { title: e.target.value },
                    })
                  }
                  className={inputClass}
                />
              </label>
            </div>
            <div className="mt-1 grid grid-cols-2 gap-1">
              <label className="block text-xs text-gray-400">
                Department
                <input
                  type="text"
                  value={person.department || ""}
                  placeholder="e.g. Operations"
                  onChange={(e) =>
                    dispatch({
                      type: "UPDATE_PERSON",
                      chartId: chart.id,
                      personId: person.id,
                      fields: { department: e.target.value },
                    })
                  }
                  className={inputClass}
                />
              </label>
              <label className="block text-xs text-gray-400">
                Reports to
                <ManagerSelect
                  chart={chart}
                  personId={person.id}
                  value={person.managerId}
                  id={`manager-${person.id}`}
                  onChange={(managerId) =>
                    dispatch({ type: "SET_PERSON_MANAGER", chartId: chart.id, personId: person.id, managerId })
                  }
                />
              </label>
            </div>
            <button
              onClick={() => dispatch({ type: "DELETE_PERSON", chartId: chart.id, personId: person.id })}
              className="mt-1.5 flex items-center gap-1 rounded px-1 py-1 text-xs text-red-300/80 hover:bg-gray-700 hover:text-red-300"
              title="Remove this person (their reports move up to their manager)"
            >
              <Trash2 size={12} /> Remove
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-4 rounded border border-gray-700 p-2">
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Add person</h3>
        <label className="block text-xs text-gray-400">
          Name
          <input
            type="text"
            value={draft.name}
            placeholder="e.g. Jason Morgan"
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            className={inputClass}
          />
        </label>
        <div className="mt-1 grid grid-cols-2 gap-1">
          <label className="block text-xs text-gray-400">
            Title / role
            <input
              type="text"
              value={draft.title}
              placeholder="e.g. Owner"
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              className={inputClass}
            />
          </label>
          <label className="block text-xs text-gray-400">
            Department
            <input
              type="text"
              value={draft.department}
              placeholder="e.g. Executive"
              onChange={(e) => setDraft({ ...draft, department: e.target.value })}
              className={inputClass}
            />
          </label>
        </div>
        <label className="mt-1 block text-xs text-gray-400">
          Reports to
          <select
            value={draft.managerId}
            onChange={(e) => setDraft({ ...draft, managerId: e.target.value })}
            className={inputClass}
          >
            <option value="">Top level (no manager)</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={addDraftPerson}
          disabled={!draft.name.trim()}
          className="mt-2 w-full rounded bg-emerald-600 px-2 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Add person
        </button>
      </div>
      <p className="mt-2 text-[11px] text-gray-500">
        Tip: drag the chart on the plan to move the whole diagram. Removing a
        person moves their reports up to that person&apos;s manager.
      </p>
    </div>
  );
}
