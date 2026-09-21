"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";

// HOUSE PLANS (HP-L0) — docked reference panel shell for Room Designer.
//
// Reference-only terminology throughout: this panel is a "Reference library"
// showing "Suggested References". It never performs checks, never renders
// findings, and never claims anything about a design. The Hazards tab arrives
// with HP-L10; later slices fill the tab content (entity→topic suggestions in
// HP-L3, reference index/search/bookmarks in HP-L2, Regulatory Snapshot in
// HP-L4, Texas sources in HP-L6+). Until then every tab shows an honest
// empty state — no fake data and no placeholder links to real authorities.

// Exact wording from the spec (section G). Keep verbatim.
export const HOUSE_PLANS_DISCLAIMER =
  "REFERENCE LIBRARY — NOT A COMPLIANCE DETERMINATION. Verify requirements with the applicable authority and qualified professionals.";

// Exact first-use statement from the spec (section G). Keep verbatim.
export const HOUSE_PLANS_FIRST_USE =
  "HOUSE PLANS organizes regulatory resources and selected factual public-data references. FORGE does not interpret regulatory requirements, evaluate your design, or determine code compliance. Confirm jurisdiction and requirements with the appropriate authorities and professionals.";

const TABS = [
  { id: "project", label: "Project" },
  { id: "suggested", label: "Suggested" },
  { id: "browse", label: "Browse" },
  { id: "search", label: "Search" },
  { id: "saved", label: "Saved" },
];

function EmptyState({ title, children }) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-white">{title}</h3>
      <div className="space-y-2 text-xs leading-relaxed text-gray-400">{children}</div>
    </div>
  );
}

// HOUSE PLANS (HP-L2) — live reference browser.
//
// Fetches the caller's reference library once, when the Browse tab is first
// opened. Factual metadata only: title, section identifier, issuing
// authority/jurisdiction, edition/effective date, official URL, topic tags,
// provenance, retrieval/verification dates, jurisdiction state. Reference
// entries are links to official sources — FORGE never writes its own
// summaries of requirements, and an empty or failed load never invents
// entries or placeholder links.
function ReferenceCard({ reference }) {
  const details = [];
  if (reference.sectionIdentifier) details.push(`Section ${reference.sectionIdentifier}`);
  if (reference.jurisdiction) details.push(reference.jurisdiction);
  if (reference.edition) details.push(`${reference.edition} edition`);
  if (reference.effectiveDate) details.push(`Effective ${reference.effectiveDate}`);

  return (
    <div className="rounded border border-gray-800 bg-gray-900/60 p-2.5">
      <h4 className="text-xs font-semibold leading-snug text-white">{reference.title}</h4>
      {details.length > 0 && (
        <p className="mt-1 text-[11px] leading-relaxed text-gray-400">{details.join(" · ")}</p>
      )}
      <p className="mt-1 text-[11px] text-gray-400">
        Issued by <span className="text-gray-200">{reference.issuingAuthority}</span>
      </p>
      {reference.topicTags && reference.topicTags.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {reference.topicTags.map((tag) => (
            <span
              key={tag}
              className="rounded bg-gray-800 px-1.5 py-0.5 text-[10px] text-gray-300"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
      <div className="mt-1.5 space-y-0.5 text-[10px] text-gray-500">
        {reference.provenance && <p>Source: {reference.provenance}</p>}
        {reference.retrievalDate && <p>Retrieved {reference.retrievalDate}</p>}
        {reference.verificationDate && <p>Verified {reference.verificationDate}</p>}
        <p>Jurisdiction status: {reference.jurisdictionState}</p>
      </div>
      <a
        href={reference.officialUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-1.5 inline-block text-[11px] font-medium text-emerald-400 hover:text-emerald-300 hover:underline"
      >
        Official source ↗
      </a>
    </div>
  );
}

function BrowseReferences() {
  const [state, setState] = useState({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/forge/designer/house-plans/references");
        if (!res.ok) throw new Error(`Load failed (${res.status})`);
        const body = await res.json();
        if (cancelled) return;
        setState({ kind: "ready", references: body.references || [] });
      } catch (error) {
        if (!cancelled) setState({ kind: "error" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.kind === "loading") {
    return (
      <EmptyState title="Browse the reference library">
        <p>Loading the reference library…</p>
      </EmptyState>
    );
  }

  if (state.kind === "error") {
    return (
      <EmptyState title="Browse the reference library">
        <p>Couldn&apos;t load the reference library.</p>
        <p>
          Check your connection and reopen this tab. FORGE never invents
          reference entries — if the list can&apos;t load, nothing is shown
          rather than placeholder data.
        </p>
      </EmptyState>
    );
  }

  if (state.references.length === 0) {
    return (
      <EmptyState title="Browse the reference library">
        <p>The reference library is empty for now.</p>
        <p>
          Official Texas and municipal source entries arrive in later slices.
          Only official sources will be listed here — FORGE never writes its
          own summaries of requirements.
        </p>
      </EmptyState>
    );
  }

  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-white">Browse the reference library</h3>
      <p className="mb-3 text-xs leading-relaxed text-gray-400">
        Official reference links only. FORGE points to official sources; it
        does not interpret them.
      </p>
      <div className="space-y-2.5">
        {state.references.map((reference) => (
          <ReferenceCard key={reference.id} reference={reference} />
        ))}
      </div>
    </div>
  );
}

function TabContent({ tabId }) {
  if (tabId === "project") {
    return (
      <EmptyState title="Project references">
        <p>No project reference context yet.</p>
        <p>
          The pinned Regulatory Snapshot — jurisdiction, official sources, and
          their verification dates — arrives in a later slice. FORGE points to
          official sources; it does not evaluate or interpret them.
        </p>
      </EmptyState>
    );
  }
  if (tabId === "suggested") {
    return (
      <EmptyState title="Suggested References">
        <p>No suggestions yet.</p>
        <p>
          As you draw, placed objects will surface official reference links
          here — for example, a stair will suggest official stair references.
          Entity-to-topic associations arrive in a later slice (HP-L3).
        </p>
      </EmptyState>
    );
  }
  if (tabId === "browse") {
    return <BrowseReferences />;
  }
  if (tabId === "search") {
    return (
      <EmptyState title="Search references">
        <p>
          <input
            type="search"
            disabled
            placeholder="Search official sources…"
            aria-label="Search references (not yet available)"
            className="w-full rounded bg-gray-800 px-2 py-1.5 text-xs text-gray-500 placeholder:text-gray-600"
          />
        </p>
        <p>Search over the reference index arrives in a later slice (HP-L2).</p>
      </EmptyState>
    );
  }
  return (
    <EmptyState title="Saved references">
      <p>Nothing saved yet.</p>
      <p>Bookmarking references for this project arrives in a later slice (HP-L2).</p>
    </EmptyState>
  );
}

export default function HousePlansPanel({ onClose }) {
  const [activeTab, setActiveTab] = useState("project");
  const [showFirstUse, setShowFirstUse] = useState(true);

  return (
    <div className="flex h-full flex-col" data-testid="house-plans-panel">
      <div className="flex items-center justify-between border-b border-gray-800 px-3 py-2">
        <div>
          <h2 className="text-sm font-semibold text-white">HOUSE PLANS</h2>
          <p className="text-[11px] text-gray-500">Reference library</p>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            aria-label="Close House Plans panel"
            className="rounded p-1 text-gray-400 hover:bg-gray-800 hover:text-white"
          >
            <X size={16} />
          </button>
        )}
      </div>

      {showFirstUse && (
        <div className="border-b border-gray-800 bg-gray-900 px-3 py-2">
          <div className="flex items-start justify-between gap-2">
            <p className="text-[11px] leading-relaxed text-gray-400">{HOUSE_PLANS_FIRST_USE}</p>
            <button
              onClick={() => setShowFirstUse(false)}
              aria-label="Dismiss first-use notice"
              className="shrink-0 rounded p-0.5 text-gray-500 hover:bg-gray-800 hover:text-white"
            >
              <X size={13} />
            </button>
          </div>
        </div>
      )}

      <div role="tablist" aria-label="House Plans reference tabs" className="flex border-b border-gray-800">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 px-1 py-2 text-xs font-medium ${
              activeTab === tab.id
                ? "border-b-2 border-emerald-500 text-white"
                : "text-gray-400 hover:bg-gray-800 hover:text-gray-200"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <TabContent tabId={activeTab} />
      </div>

      <div className="border-t border-gray-800 bg-gray-900 px-3 py-2">
        <p className="text-[10px] font-semibold leading-relaxed tracking-wide text-amber-300/90">
          {HOUSE_PLANS_DISCLAIMER}
        </p>
      </div>
    </div>
  );
}
