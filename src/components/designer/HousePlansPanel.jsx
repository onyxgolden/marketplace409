"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bookmark, X } from "lucide-react";
import { readDraft } from "./designerDraft";
import {
  SOURCE_TYPE_LABELS,
  sourceTypeForUrl,
} from "@/lib/housePlans/texasSourcesSeed";
import {
  extractPlacedEntities,
  matchReferencesByTopics,
  topicsForEntities,
} from "@/lib/housePlans/suggestedTopics";
import {
  isBookmarked,
  readBookmarks,
  toggleBookmark,
} from "@/lib/housePlans/savedBookmarks";
import { jurisdictionDisplayLabel } from "@/lib/housePlans/jurisdictionResolution";

// HOUSE PLANS (HP-L0) — docked reference panel shell for Room Designer.
//
// Reference-only terminology throughout: this panel is a "Reference library"
// showing "Sources by topic". It never performs checks, never renders
// findings, and never claims anything about a design. HP-L6 fills the tabs:
// entity→topic suggestions (Suggested), reference index/search/bookmarks
// (Browse/Search/Saved), and the pinned Regulatory Snapshot count (Project).
// Every tab keeps an honest empty state — no fake data and no placeholder
// links to real authorities.
//
// HP-L6 language rules (architecture review): Suggested mappings are
// strictly entity → topic, never entity → requirement. The UI never says
// "Applicable sources", "Required references", "Compliance checklist",
// "Code violations", or "Missing requirements". The seed is a curated
// "official source index" of "Texas reference sources" — never "Texas
// building requirements" or "complete Texas regulations".

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

// HP-L6 — source-type badge. The type comes from the curated seed index
// (sourceTypeForUrl); unlisted URLs get no badge rather than a guessed one.
// Statutes, agency resources, and municipal references stay visually
// distinct.
function SourceTypeBadge({ officialUrl }) {
  const sourceType = sourceTypeForUrl(officialUrl);
  if (!sourceType) return null;
  return (
    <span className="rounded bg-indigo-950 px-1.5 py-0.5 text-[10px] font-medium text-indigo-300">
      {SOURCE_TYPE_LABELS[sourceType] || sourceType}
    </span>
  );
}

// HOUSE PLANS (HP-L2) — live reference browser.
//
// Fetches the caller's reference library once, when a tab that needs it is
// first opened. Factual metadata only: title, section identifier, issuing
// authority/jurisdiction, edition/effective date, official URL, topic tags,
// provenance, retrieval/verification dates, jurisdiction state. Reference
// entries are links to official sources — FORGE never writes its own
// summaries of requirements, and an empty or failed load never invents
// entries or placeholder links.
function ReferenceCard({ reference, bookmarked, onToggleBookmark }) {
  const details = [];
  if (reference.sectionIdentifier) details.push(`Section ${reference.sectionIdentifier}`);
  if (reference.jurisdiction) details.push(reference.jurisdiction);
  if (reference.edition) details.push(`${reference.edition} edition`);
  if (reference.effectiveDate) details.push(`Effective ${reference.effectiveDate}`);

  return (
    <div className="rounded border border-gray-800 bg-gray-900/60 p-2.5">
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-xs font-semibold leading-snug text-white">{reference.title}</h4>
        {onToggleBookmark && (
          <button
            onClick={() => onToggleBookmark(reference.id)}
            aria-label={bookmarked ? "Remove bookmark" : "Bookmark this reference"}
            aria-pressed={!!bookmarked}
            className={`shrink-0 rounded p-1 ${
              bookmarked
                ? "text-amber-300 hover:bg-gray-800"
                : "text-gray-500 hover:bg-gray-800 hover:text-gray-200"
            }`}
          >
            <Bookmark size={14} fill={bookmarked ? "currentColor" : "none"} />
          </button>
        )}
      </div>
      <div className="mt-1">
        <SourceTypeBadge officialUrl={reference.officialUrl} />
      </div>
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

function ReferenceList({ references, bookmarkedIds, onToggleBookmark, emptyTitle, emptyBody }) {
  if (!references || references.length === 0) {
    return (
      <EmptyState title={emptyTitle}>
        <p>{emptyBody}</p>
      </EmptyState>
    );
  }
  return (
    <div className="space-y-2.5">
      {references.map((reference) => (
        <ReferenceCard
          key={reference.id}
          reference={reference}
          bookmarked={bookmarkedIds.includes(reference.id)}
          onToggleBookmark={onToggleBookmark}
        />
      ))}
    </div>
  );
}

// HP-L2: the reference library loads lazily on the first opening of any tab
// that needs it, and the loaded result is preserved at panel scope. Tab
// components mount and unmount as the user switches tabs, so keeping this
// state in the panel (not in the tab components) is what makes "load once"
// actually hold.
function useReferenceLibrary() {
  const [library, setLibrary] = useState({ status: "idle" });
  const statusRef = useRef("idle");
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const ensureLibrary = useCallback(() => {
    const current = statusRef.current;
    if (current === "loading" || current === "ready") return;
    statusRef.current = "loading";
    setLibrary({ status: "loading" });
    (async () => {
      try {
        const res = await fetch("/api/forge/designer/house-plans/references");
        if (!res.ok) throw new Error(`Load failed (${res.status})`);
        const body = await res.json();
        const next = { status: "ready", references: body.references || [] };
        statusRef.current = "ready";
        if (mountedRef.current) setLibrary(next);
      } catch (error) {
        statusRef.current = "error";
        if (mountedRef.current) setLibrary({ status: "error" });
      }
    })();
  }, []);

  return { library, ensureLibrary };
}

// HP-L4: regulatory snapshots list + pinning. GET lists newest-first
// (read-only); POST captures a new immutable snapshot of the current
// library. Snapshots are append-only by API design.
function useSnapshots() {
  const [snapshots, setSnapshots] = useState({ status: "idle" });
  const statusRef = useRef("idle");
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadSnapshots = useCallback(async () => {
    statusRef.current = "loading";
    setSnapshots({ status: "loading" });
    try {
      const res = await fetch("/api/forge/designer/house-plans/snapshots");
      if (!res.ok) throw new Error(`Load failed (${res.status})`);
      const body = await res.json();
      if (mountedRef.current) {
        statusRef.current = "ready";
        setSnapshots({ status: "ready", items: body.snapshots || [] });
      }
    } catch (error) {
      if (mountedRef.current) {
        statusRef.current = "error";
        setSnapshots({ status: "error" });
      }
    }
  }, []);

  const ensureSnapshots = useCallback(() => {
    if (statusRef.current === "idle") loadSnapshots();
  }, [loadSnapshots]);

  const pinSnapshot = useCallback(async () => {
    statusRef.current = "loading";
    setSnapshots({ status: "loading" });
    try {
      const res = await fetch("/api/forge/designer/house-plans/snapshots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Pin failed (${res.status})`);
      await loadSnapshots();
      return { ok: true, created: body.created };
    } catch (error) {
      if (mountedRef.current) {
        statusRef.current = "error";
        setSnapshots({ status: "error", message: error.message });
      }
      return { ok: false, message: error.message };
    }
  }, [loadSnapshots]);

  return { snapshots, ensureSnapshots, pinSnapshot };
}

function BrowseReferences({ library, onFirstOpen, bookmarkedIds, onToggleBookmark }) {
  useEffect(() => {
    onFirstOpen();
  }, [onFirstOpen]);

  if (library.status === "idle" || library.status === "loading") {
    return (
      <EmptyState title="Browse the reference library">
        <p>Loading the reference library…</p>
      </EmptyState>
    );
  }

  if (library.status === "error") {
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

  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-white">Browse the reference library</h3>
      <p className="mb-3 text-xs leading-relaxed text-gray-400">
        Official reference links only. FORGE points to official sources; it
        does not interpret them.
      </p>
      <ReferenceList
        references={library.references}
        bookmarkedIds={bookmarkedIds}
        onToggleBookmark={onToggleBookmark}
        emptyTitle="Browse the reference library"
        emptyBody="The reference library is empty for now. Only official sources will be listed here — FORGE never writes its own summaries of requirements."
      />
    </div>
  );
}

// HP-L6 — Suggested: placed drawing objects → topic tags → official
// reference links. Strictly entity → topic; the mapping never encodes
// regulatory applicability, and the UI never claims a source applies to
// the project.
function SuggestedReferences({ projectId, library, onFirstOpen, bookmarkedIds, onToggleBookmark }) {
  useEffect(() => {
    onFirstOpen();
  }, [onFirstOpen]);

  const draft = projectId ? readDraft(projectId) : null;
  const entities = extractPlacedEntities(draft?.envelope);
  const topics = topicsForEntities(entities);

  if (!projectId) {
    return (
      <EmptyState title="Sources by topic">
        <p>No project connected.</p>
        <p>No suggestions yet.</p>
        <p>
          As you draw, placed objects surface official reference links here
          by topic — for example, a window suggests official window
          references. FORGE points to official sources; it does not evaluate
          or interpret them.
        </p>
      </EmptyState>
    );
  }

  if (library.status === "idle" || library.status === "loading") {
    return (
      <EmptyState title="Sources by topic">
        <p>Loading the reference library…</p>
      </EmptyState>
    );
  }

  if (library.status === "error") {
    return (
      <EmptyState title="Sources by topic">
        <p>Couldn&apos;t load the reference library.</p>
        <p>Check your connection and reopen this tab.</p>
      </EmptyState>
    );
  }

  if (entities.length === 0) {
    return (
      <EmptyState title="Sources by topic">
        <p>No suggestions yet.</p>
        <p>
          As you draw, placed objects will surface official reference links
          here by topic — for example, a window suggests official window
          references.
        </p>
      </EmptyState>
    );
  }

  const matches = matchReferencesByTopics(library.references, topics);

  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-white">Sources by topic</h3>
      <p className="mb-3 text-xs leading-relaxed text-gray-400">
        Placed objects surface official reference links by topic
        {topics.length > 0 && <> ({topics.join(", ")})</>}. FORGE points to
        official sources; it does not interpret them.
      </p>
      <ReferenceList
        references={matches}
        bookmarkedIds={bookmarkedIds}
        onToggleBookmark={onToggleBookmark}
        emptyTitle="Sources by topic"
        emptyBody="No reference links match the placed objects yet. The reference library only lists official sources — FORGE never invents entries."
      />
    </div>
  );
}

// HP-L6 — Search: client-side filter over the loaded reference index
// (title / issuing authority / topic tags).
function SearchReferences({ library, onFirstOpen, bookmarkedIds, onToggleBookmark }) {
  const [query, setQuery] = useState("");

  useEffect(() => {
    onFirstOpen();
  }, [onFirstOpen]);

  if (library.status === "idle" || library.status === "loading") {
    return (
      <EmptyState title="Search references">
        <p>Loading the reference library…</p>
      </EmptyState>
    );
  }

  if (library.status === "error") {
    return (
      <EmptyState title="Search references">
        <p>Couldn&apos;t load the reference library.</p>
        <p>Check your connection and reopen this tab.</p>
      </EmptyState>
    );
  }

  const needle = query.trim().toLowerCase();
  const results =
    needle.length === 0
      ? library.references
      : library.references.filter((reference) => {
          const haystack = [
            reference.title,
            reference.issuingAuthority,
            reference.jurisdiction,
            ...(reference.topicTags || []),
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          return haystack.includes(needle);
        });

  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-white">Search references</h3>
      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search official sources…"
        aria-label="Search references"
        className="mb-3 w-full rounded bg-gray-800 px-2 py-1.5 text-xs text-gray-200 placeholder:text-gray-500"
      />
      <ReferenceList
        references={results}
        bookmarkedIds={bookmarkedIds}
        onToggleBookmark={onToggleBookmark}
        emptyTitle="Search references"
        emptyBody={
          library.references.length === 0
            ? "The reference library is empty for now."
            : "No references match that search. Try a topic such as windstorm, windows, or building-codes."
        }
      />
    </div>
  );
}

// HP-L6 — Saved: per-project bookmarks in localStorage. A bookmark is a user
// preference ("revisit this official source"), not regulatory evidence —
// bookmarks never enter the snapshots table.
function SavedReferences({ projectId, library, onFirstOpen, bookmarkedIds, onToggleBookmark }) {
  useEffect(() => {
    onFirstOpen();
  }, [onFirstOpen]);

  if (library.status === "idle" || library.status === "loading") {
    return (
      <EmptyState title="Saved references">
        <p>Loading the reference library…</p>
      </EmptyState>
    );
  }

  if (library.status === "error") {
    return (
      <EmptyState title="Saved references">
        <p>Couldn&apos;t load the reference library.</p>
        <p>Check your connection and reopen this tab.</p>
      </EmptyState>
    );
  }

  const saved = library.references.filter((reference) =>
    bookmarkedIds.includes(reference.id)
  );

  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-white">Saved references</h3>
      <p className="mb-3 text-xs leading-relaxed text-gray-400">
        Bookmarks live in this browser, per project. They are a reading
        convenience — not project records.
      </p>
      <ReferenceList
        references={saved}
        bookmarkedIds={bookmarkedIds}
        onToggleBookmark={onToggleBookmark}
        emptyTitle="Saved references"
        emptyBody="Nothing saved yet. Use the bookmark control on any reference card to keep it here."
      />
    </div>
  );
}

// HP-L6 — Project: jurisdiction facts (when provided) plus the pinned
// Regulatory Snapshot list and a pin control. Snapshots are immutable and
// append-only by API design.
function ProjectReferences({ jurisdiction, snapshots, onFirstOpen, onPinSnapshot }) {
  const [pinMessage, setPinMessage] = useState(null);

  useEffect(() => {
    onFirstOpen();
  }, [onFirstOpen]);

  const handlePin = async () => {
    setPinMessage(null);
    const result = await onPinSnapshot();
    if (result.ok) {
      setPinMessage(
        result.created
          ? "Snapshot pinned."
          : "Library unchanged — the latest snapshot already covers it."
      );
    } else {
      setPinMessage(result.message || "Couldn't pin a snapshot.");
    }
  };

  const items = snapshots.status === "ready" ? snapshots.items : [];

  return (
    <div className="space-y-4">
      <div>
        <h3 className="mb-2 text-sm font-semibold text-white">Project jurisdiction</h3>
        {jurisdiction ? (
          <div className="space-y-1 text-xs leading-relaxed text-gray-400">
            <p className="text-gray-200">{jurisdictionDisplayLabel(jurisdiction)}</p>
            <p>Status: {jurisdiction.jurisdictionState}</p>
            {jurisdiction.provenance && <p>Source: {jurisdiction.provenance}</p>}
          </div>
        ) : (
          <div className="space-y-2 text-xs leading-relaxed text-gray-400">
            <p>No project reference context yet.</p>
            <p>
              Jurisdiction facts for this project will appear here once a
              project location is connected. FORGE records what official
              sources report; it never interprets which requirements apply.
            </p>
          </div>
        )}
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">Regulatory snapshots</h3>
          <button
            onClick={handlePin}
            disabled={snapshots.status === "loading"}
            className="rounded bg-emerald-700 px-2 py-1 text-[11px] font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
          >
            Pin current library
          </button>
        </div>
        {pinMessage && (
          <p className="mb-2 text-[11px] text-gray-400">{pinMessage}</p>
        )}
        {snapshots.status === "idle" || snapshots.status === "loading" ? (
          <p className="text-xs text-gray-400">Loading snapshots…</p>
        ) : snapshots.status === "error" ? (
          <div className="space-y-2 text-xs leading-relaxed text-gray-400">
            <p>Couldn&apos;t load the snapshots.</p>
            {snapshots.message && <p>{snapshots.message}</p>}
          </div>
        ) : items.length === 0 ? (
          <div className="space-y-2 text-xs leading-relaxed text-gray-400">
            <p>No snapshots pinned yet.</p>
            <p>
              A snapshot pins the reference library — which official
              sources, with their verification dates — at a point in time.
              Snapshots are never edited or deleted.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-gray-400">
              {items.length} pinned snapshot{items.length === 1 ? "" : "s"}.
            </p>
            {items.map((snapshot) => (
              <div
                key={snapshot.id}
                className="rounded border border-gray-800 bg-gray-900/60 p-2.5"
              >
                <p className="text-xs font-semibold text-white">
                  {snapshot.label || "Untitled snapshot"}
                </p>
                <p className="mt-1 text-[11px] text-gray-400">
                  {snapshot.sourceCount} source{snapshot.sourceCount === 1 ? "" : "s"} ·{" "}
                  {snapshot.capturedAt
                    ? new Date(snapshot.capturedAt).toLocaleString()
                    : "date unknown"}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TabContent({
  tabId,
  projectId,
  jurisdiction,
  library,
  snapshots,
  bookmarkedIds,
  onEnsureLibrary,
  onEnsureSnapshots,
  onPinSnapshot,
  onToggleBookmark,
}) {
  if (tabId === "project") {
    return (
      <ProjectReferences
        jurisdiction={jurisdiction}
        snapshots={snapshots}
        onFirstOpen={onEnsureSnapshots}
        onPinSnapshot={onPinSnapshot}
      />
    );
  }
  if (tabId === "suggested") {
    return (
      <SuggestedReferences
        projectId={projectId}
        library={library}
        onFirstOpen={onEnsureLibrary}
        bookmarkedIds={bookmarkedIds}
        onToggleBookmark={onToggleBookmark}
      />
    );
  }
  if (tabId === "browse") {
    return (
      <BrowseReferences
        library={library}
        onFirstOpen={onEnsureLibrary}
        bookmarkedIds={bookmarkedIds}
        onToggleBookmark={onToggleBookmark}
      />
    );
  }
  if (tabId === "search") {
    return (
      <SearchReferences
        library={library}
        onFirstOpen={onEnsureLibrary}
        bookmarkedIds={bookmarkedIds}
        onToggleBookmark={onToggleBookmark}
      />
    );
  }
  return (
    <SavedReferences
      projectId={projectId}
      library={library}
      onFirstOpen={onEnsureLibrary}
      bookmarkedIds={bookmarkedIds}
      onToggleBookmark={onToggleBookmark}
    />
  );
}

export default function HousePlansPanel({ onClose, projectId, jurisdiction }) {
  const [activeTab, setActiveTab] = useState("project");
  const [showFirstUse, setShowFirstUse] = useState(true);
  const { library, ensureLibrary } = useReferenceLibrary();
  const { snapshots, ensureSnapshots, pinSnapshot } = useSnapshots();
  const [bookmarkedIds, setBookmarkedIds] = useState(() => readBookmarks(projectId));

  const handleToggleBookmark = useCallback(
    (referenceId) => {
      setBookmarkedIds(toggleBookmark(projectId, referenceId));
    },
    [projectId]
  );

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
        <TabContent
          tabId={activeTab}
          projectId={projectId}
          jurisdiction={jurisdiction}
          library={library}
          snapshots={snapshots}
          bookmarkedIds={bookmarkedIds}
          onEnsureLibrary={ensureLibrary}
          onEnsureSnapshots={ensureSnapshots}
          onPinSnapshot={pinSnapshot}
          onToggleBookmark={handleToggleBookmark}
        />
      </div>

      <div className="border-t border-gray-800 bg-gray-900 px-3 py-2">
        <p className="text-[10px] font-semibold leading-relaxed tracking-wide text-amber-300/90">
          {HOUSE_PLANS_DISCLAIMER}
        </p>
      </div>
    </div>
  );
}
