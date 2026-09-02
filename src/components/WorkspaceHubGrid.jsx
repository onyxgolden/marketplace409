"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Building2, Code2, GanttChart, Hammer, HeartPulse, Star, Store } from "lucide-react";

const ICONS = { Store, Building2, Hammer, GanttChart, Code2, HeartPulse };

function FavoriteStar({ workspaceId, isFavorite, saving, onToggle }) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onToggle(workspaceId, isFavorite);
      }}
      disabled={saving}
      aria-pressed={isFavorite}
      aria-label={isFavorite ? "Remove as favorite workspace" : "Set as favorite workspace"}
      title={isFavorite ? "Your favorite -- opens automatically" : "Set as favorite"}
      className="rounded-lg p-1 text-slate-400 transition hover:text-amber-500 disabled:opacity-50 dark:text-slate-500"
    >
      <Star aria-hidden="true" className="h-5 w-5" fill={isFavorite ? "currentColor" : "none"} color={isFavorite ? "#f59e0b" : "currentColor"} />
    </button>
  );
}

function Tile({ workspace, stat, isFavorite, saving, onToggleFavorite }) {
  const Icon = ICONS[workspace.iconName];
  return (
    <Link
      href={workspace.href}
      className="group relative flex flex-col rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 shadow-sm transition hover:-translate-y-0.5 hover:border-amber-400 hover:shadow-lg"
    >
      <div className="absolute right-3 top-3">
        <FavoriteStar workspaceId={workspace.id} isFavorite={isFavorite} saving={saving} onToggle={onToggleFavorite} />
      </div>

      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-slate-950 dark:bg-amber-400 text-white dark:text-slate-950">
        <Icon aria-hidden="true" className="h-6 w-6" />
      </div>
      <div className="text-xl font-black dark:text-white">{workspace.name}</div>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{workspace.description}</p>
      <div className="mt-4 flex items-center justify-between text-sm font-bold text-slate-500 dark:text-slate-400">
        <span>{stat}</span>
        <ArrowRight aria-hidden="true" className="h-4 w-4 text-slate-400 transition group-hover:translate-x-1 group-hover:text-amber-500" />
      </div>
    </Link>
  );
}

export default function WorkspaceHubGrid({ workspaces, stats, healthShortcut, initialFavoriteWorkspaceId }) {
  const [favoriteWorkspaceId, setFavoriteWorkspaceId] = useState(initialFavoriteWorkspaceId);
  const [saving, setSaving] = useState(false);

  async function toggleFavorite(workspaceId, wasFavorite) {
    const nextFavoriteWorkspaceId = wasFavorite ? null : workspaceId;
    setSaving(true);
    const previous = favoriteWorkspaceId;
    setFavoriteWorkspaceId(nextFavoriteWorkspaceId);
    try {
      const response = await fetch("/api/preferences/favorite-workspace", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ favoriteWorkspaceId: nextFavoriteWorkspaceId }),
      });
      if (!response.ok) setFavoriteWorkspaceId(previous);
    } catch {
      setFavoriteWorkspaceId(previous);
    } finally {
      setSaving(false);
    }
  }

  const allTiles = healthShortcut ? [...workspaces, healthShortcut] : workspaces;

  return (
    <div className="grid w-full max-w-4xl gap-5 sm:grid-cols-2">
      {allTiles.map((workspace) => (
        <Tile
          key={workspace.id}
          workspace={workspace}
          stat={workspace.id === healthShortcut?.id ? "Private" : stats[workspace.id]}
          isFavorite={favoriteWorkspaceId === workspace.id}
          saving={saving}
          onToggleFavorite={toggleFavorite}
        />
      ))}
    </div>
  );
}
