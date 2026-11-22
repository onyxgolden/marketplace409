// Shared field grid for a hierarchy (client/site/project) create/edit
// draft -- the exact markup PlannerHierarchyManager's own form uses,
// extracted so PlannerAddHierarchyButtons' create-only dialog on
// /forge/work renders byte-identical fields, labels, and validation
// surface instead of a second, drifting copy.
"use client";

import {
  CLIENT_STATUSES,
  PROJECT_STATUSES,
  SITE_STATUSES,
  SITE_TYPES,
} from "@/domains/forge-shared-hierarchy/hierarchy.js";

const input = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm";
const label = "block text-xs font-medium text-slate-600 mb-1";

const STATUS_LABELS = {
  active: "Active",
  inactive: "Inactive",
  archived: "Archived",
  planned: "Planned",
  on_hold: "On hold",
  complete: "Complete",
};

export function statusLabel(status) {
  return STATUS_LABELS[status] || status;
}

/** parents: [{ id, label }] -- the parent client (for a site) or
 *  parent site (for a project) options. Empty/ignored for a client. */
export default function HierarchyRecordFields({ entity, draft, parents, onChange, idPrefix = "hierarchy-form" }) {
  const statuses = entity === "client" ? CLIENT_STATUSES : entity === "site" ? SITE_STATUSES : PROJECT_STATUSES;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {entity !== "client" && (
        <div className="sm:col-span-2">
          <label className={label} htmlFor={`${idPrefix}-parent`}>
            {entity === "site" ? "Parent client" : "Parent site"}
          </label>
          <select
            id={`${idPrefix}-parent`}
            className={input}
            value={draft.parentId}
            onChange={(event) => onChange("parentId", event.target.value)}
          >
            <option value="">{entity === "site" ? "Choose a client…" : "Choose a site…"}</option>
            {(parents || []).map((parent) => (
              <option key={parent.id} value={parent.id}>{parent.label}</option>
            ))}
          </select>
        </div>
      )}
      <div>
        <label className={label} htmlFor={`${idPrefix}-name`}>Name</label>
        <input
          id={`${idPrefix}-name`}
          className={input}
          value={draft.name}
          onChange={(event) => onChange("name", event.target.value)}
        />
      </div>
      {entity === "client" && (
        <div>
          <label className={label} htmlFor={`${idPrefix}-external-reference`}>External reference</label>
          <input
            id={`${idPrefix}-external-reference`}
            className={input}
            value={draft.externalReference}
            onChange={(event) => onChange("externalReference", event.target.value)}
          />
        </div>
      )}
      {entity === "site" && (
        <div>
          <label className={label} htmlFor={`${idPrefix}-site-type`}>Site type</label>
          <select
            id={`${idPrefix}-site-type`}
            className={input}
            value={draft.siteType}
            onChange={(event) => onChange("siteType", event.target.value)}
          >
            <option value="">Choose a type…</option>
            {SITE_TYPES.map((type) => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
        </div>
      )}
      {entity === "project" && (
        <div>
          <label className={label} htmlFor={`${idPrefix}-project-code`}>Project code</label>
          <input id={`${idPrefix}-project-code`} className={input} value={draft.projectCode} onChange={(event) => onChange("projectCode", event.target.value)} />
        </div>
      )}
      {entity === "client" && (
        <div className="sm:col-span-2">
          <label className={label} htmlFor={`${idPrefix}-notes`}>Notes</label>
          <textarea
            id={`${idPrefix}-notes`}
            className={input}
            rows={2}
            value={draft.notes}
            onChange={(event) => onChange("notes", event.target.value)}
          />
        </div>
      )}
      {entity === "site" && (
        <>
          <div>
            <label className={label} htmlFor={`${idPrefix}-address-line1`}>Address line 1</label>
            <input id={`${idPrefix}-address-line1`} className={input} value={draft.addressLine1} onChange={(event) => onChange("addressLine1", event.target.value)} />
          </div>
          <div>
            <label className={label} htmlFor={`${idPrefix}-address-line2`}>Address line 2</label>
            <input id={`${idPrefix}-address-line2`} className={input} value={draft.addressLine2} onChange={(event) => onChange("addressLine2", event.target.value)} />
          </div>
          <div>
            <label className={label} htmlFor={`${idPrefix}-city`}>City</label>
            <input id={`${idPrefix}-city`} className={input} value={draft.city} onChange={(event) => onChange("city", event.target.value)} />
          </div>
          <div>
            <label className={label} htmlFor={`${idPrefix}-region`}>Region</label>
            <input id={`${idPrefix}-region`} className={input} value={draft.region} onChange={(event) => onChange("region", event.target.value)} />
          </div>
          <div>
            <label className={label} htmlFor={`${idPrefix}-postal-code`}>Postal code</label>
            <input id={`${idPrefix}-postal-code`} className={input} value={draft.postalCode} onChange={(event) => onChange("postalCode", event.target.value)} />
          </div>
          <div>
            <label className={label} htmlFor={`${idPrefix}-country-code`}>Country code</label>
            <input id={`${idPrefix}-country-code`} className={input} value={draft.countryCode} onChange={(event) => onChange("countryCode", event.target.value)} placeholder="US" />
          </div>
        </>
      )}
      {entity === "project" && (
        <>
          <div className="sm:col-span-2">
            <label className={label} htmlFor={`${idPrefix}-description`}>Description</label>
            <textarea
              id={`${idPrefix}-description`}
              className={input}
              rows={2}
              value={draft.description}
              onChange={(event) => onChange("description", event.target.value)}
            />
          </div>
          <div>
            <label className={label} htmlFor={`${idPrefix}-project-type`}>Project type</label>
            <input id={`${idPrefix}-project-type`} className={input} value={draft.projectType} onChange={(event) => onChange("projectType", event.target.value)} />
          </div>
          <div>
            <label className={label} htmlFor={`${idPrefix}-planned-start`}>Planned start</label>
            <input id={`${idPrefix}-planned-start`} type="date" className={input} value={draft.plannedStart} onChange={(event) => onChange("plannedStart", event.target.value)} />
          </div>
          <div>
            <label className={label} htmlFor={`${idPrefix}-planned-finish`}>Planned finish</label>
            <input id={`${idPrefix}-planned-finish`} type="date" className={input} value={draft.plannedFinish} onChange={(event) => onChange("plannedFinish", event.target.value)} />
          </div>
        </>
      )}
      <div>
        <label className={label} htmlFor={`${idPrefix}-status`}>Status</label>
        <select
          id={`${idPrefix}-status`}
          className={input}
          value={draft.status}
          onChange={(event) => onChange("status", event.target.value)}
        >
          {statuses.map((status) => (
            <option key={status} value={status}>{statusLabel(status)}</option>
          ))}
        </select>
      </div>
    </div>
  );
}
