"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";

import {
  COMMAND_PALETTE_OPEN_EVENT,
  getCommandPaletteActions,
  filterCommandPaletteActions,
  openCommandPalette,
} from "@/lib/commandPalette/registry";
import "@/lib/commandPalette/forgeCommands";

function isMac() {
  if (typeof navigator === "undefined") return false;
  return /mac/i.test(navigator.platform ?? "") || /mac/i.test(navigator.userAgent ?? "");
}

// Visible trigger for the palette -- the touch/mouse path, since there is no
// keyboard on a phone. Fires the same open event the Cmd/Ctrl+K binding uses,
// so any number of triggers can coexist with a single host.
export function CommandPaletteTrigger({ expanded = false, tone = "dark", className = "" }) {
  const dark = tone !== "light";
  const shortcut = isMac() ? "⌘K" : "Ctrl K";
  return (
    <button
      type="button"
      onClick={openCommandPalette}
      aria-label={`Open command palette (${shortcut})`}
      title={expanded ? undefined : "Command palette"}
      className={[
        "group relative flex items-center transition",
        expanded ? "min-h-12 w-full gap-3 px-3 text-sm font-black" : "h-11 w-11 justify-center",
        dark
          ? "rounded-xl border border-white/10 bg-white/5 text-slate-200 hover:border-white/25 hover:bg-white/10 hover:text-white"
          : "rounded-xl border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800",
        className,
      ].join(" ")}
    >
      <Search aria-hidden="true" className="h-5 w-5 shrink-0" />
      {expanded ? (
        <>
          <span className="truncate">Commands</span>
          <kbd
            aria-hidden="true"
            className={
              dark
                ? "ml-auto rounded-md border border-white/15 bg-black/30 px-1.5 py-0.5 text-[10px] font-black text-slate-300"
                : "ml-auto rounded-md border border-slate-300 bg-slate-100 px-1.5 py-0.5 text-[10px] font-black text-slate-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400"
            }
          >
            {shortcut}
          </kbd>
        </>
      ) : (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 -translate-y-1/2 whitespace-nowrap rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white opacity-0 shadow-xl transition group-hover:opacity-100 group-focus-visible:opacity-100"
        >
          Command palette ({shortcut})
        </span>
      )}
    </button>
  );
}

function groupResults(results) {
  // Groups in first-appearance order: [{ name, items: [{ action, flatIndex }] }]
  const groups = [];
  const byName = new Map();
  results.forEach((action, flatIndex) => {
    const name = action.group || "Actions";
    if (!byName.has(name)) {
      const group = { name, items: [] };
      byName.set(name, group);
      groups.push(group);
    }
    byName.get(name).items.push({ action, flatIndex });
  });
  return groups;
}

// The dialog is a separate component -- and only mounted while open -- so the
// host itself never calls useRouter(). Shells (and their tests) can render
// the host with a minimal next/navigation mock; the router is only resolved
// when the user actually opens the palette.
function CommandPaletteDialog({ onClose }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef(null);
  const optionRefs = useRef([]);

  const results = useMemo(() => filterCommandPaletteActions(getCommandPaletteActions(), query), [query]);

  // Clamp the highlight instead of resetting it in an effect: the list only
  // shrinks while open when the query changes, and the query handler below
  // resets to the top row at the same time.
  const safeActiveIndex = results.length === 0 ? 0 : Math.min(activeIndex, results.length - 1);

  // Focus the search field on mount; lock body scroll until unmount.
  useEffect(() => {
    inputRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  // Keep the highlighted row visible while arrowing through a long list.
  // (Optional-chained: jsdom and some embeds don't implement scrollIntoView.)
  useEffect(() => {
    optionRefs.current[safeActiveIndex]?.scrollIntoView?.({ block: "nearest" });
  }, [safeActiveIndex]);

  function activate(action) {
    if (!action) return;
    onClose();
    if (typeof action.run === "function") {
      action.run();
      return;
    }
    router.push(action.href);
  }

  function onDialogKeyDown(event) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex(results.length === 0 ? 0 : (safeActiveIndex + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex(results.length === 0 ? 0 : (safeActiveIndex - 1 + results.length) % results.length);
    } else if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(results.length - 1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      activate(results[safeActiveIndex]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  }

  const groups = groupResults(results);
  const activeId = results[safeActiveIndex] ? `forge-command-palette-option-${safeActiveIndex}` : undefined;

  // Rendered in a portal (same as the Designer's dialogs): immune to any
  // stacking context or overflow clipping an ancestor shell might introduce.
  return createPortal(
    <div
      className="fixed inset-0 z-[100] bg-slate-950/60 p-4 backdrop-blur-[2px]"
      onClick={onClose}
      data-testid="command-palette-backdrop"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={onDialogKeyDown}
        className="mx-auto mt-[10vh] flex max-h-[75vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
      >
        <div className="flex items-center gap-3 border-b border-slate-200 px-4 dark:border-slate-700">
          <Search aria-hidden="true" className="h-5 w-5 shrink-0 text-slate-400" />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls="forge-command-palette-listbox"
            aria-activedescendant={activeId}
            aria-label="Search commands"
            placeholder="Type a command or search…"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            className="h-14 w-full bg-transparent text-base font-bold text-slate-950 outline-none placeholder:font-medium placeholder:text-slate-400 dark:text-white"
            data-testid="command-palette-input"
          />
          <kbd
            aria-hidden="true"
            className="shrink-0 rounded-md border border-slate-300 bg-slate-100 px-1.5 py-0.5 text-[10px] font-black text-slate-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400"
          >
            esc
          </kbd>
        </div>

        <ul
          role="listbox"
          id="forge-command-palette-listbox"
          aria-label="Matching commands"
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2"
          data-testid="command-palette-listbox"
        >
          {results.length === 0 ? (
            <li role="presentation" className="px-4 py-10 text-center">
              <p className="text-sm font-black text-slate-700 dark:text-slate-200">No commands match “{query}”.</p>
              <p className="mt-1 text-xs font-bold text-slate-500 dark:text-slate-400">
                Try a different search — actions, reports, and places are all indexed.
              </p>
            </li>
          ) : (
            groups.map((group) => (
              <li key={group.name} role="presentation">
                <p
                  aria-hidden="true"
                  className="px-3 pb-1 pt-3 text-[10px] font-black uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500"
                >
                  {group.name}
                </p>
                <ul role="presentation" className="space-y-0.5">
                  {group.items.map(({ action, flatIndex }) => {
                    const active = flatIndex === safeActiveIndex;
                    return (
                      <li
                        key={action.id}
                        role="option"
                        id={`forge-command-palette-option-${flatIndex}`}
                        aria-selected={active}
                        data-active={active ? "true" : "false"}
                        data-testid={`command-palette-option-${action.id}`}
                        ref={(element) => {
                          optionRefs.current[flatIndex] = element;
                        }}
                        onClick={() => activate(action)}
                        onMouseMove={() => {
                          if (!active) setActiveIndex(flatIndex);
                        }}
                        className={[
                          "flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5",
                          active
                            ? "bg-amber-400 text-slate-950 shadow"
                            : "text-slate-800 hover:bg-slate-100 dark:text-slate-100 dark:hover:bg-white/10",
                        ].join(" ")}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-black">{action.title}</span>
                          {action.hint ? (
                            <span
                              className={
                                active
                                  ? "block truncate text-xs font-bold text-slate-800"
                                  : "block truncate text-xs font-bold text-slate-500 dark:text-slate-400"
                              }
                            >
                              {action.hint}
                            </span>
                          ) : null}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))
          )}
        </ul>

        <div
          aria-hidden="true"
          className="flex items-center gap-4 border-t border-slate-200 px-4 py-2.5 text-[11px] font-bold text-slate-500 dark:border-slate-700 dark:text-slate-400"
        >
          <span>
            <kbd className="rounded border border-slate-300 bg-slate-100 px-1 dark:border-slate-600 dark:bg-slate-800">↑↓</kbd> navigate
          </span>
          <span>
            <kbd className="rounded border border-slate-300 bg-slate-100 px-1 dark:border-slate-600 dark:bg-slate-800">↵</kbd> select
          </span>
          <span>
            <kbd className="rounded border border-slate-300 bg-slate-100 px-1 dark:border-slate-600 dark:bg-slate-800">esc</kbd> close
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default function CommandPaletteHost() {
  const [open, setOpen] = useState(false);
  const returnFocusRef = useRef(null);
  const openRef = useRef(false);

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  function requestOpen() {
    if (openRef.current) return;
    returnFocusRef.current = document.activeElement;
    setOpen(true);
  }

  function close() {
    setOpen(false);
    const target = returnFocusRef.current;
    if (target && document.contains(target) && typeof target.focus === "function") {
      target.focus();
    }
  }

  // Global keybinding: Cmd+K (Mac) / Ctrl+K toggles the palette.
  // preventDefault stops the browser from stealing it (address-bar focus).
  // The shortcut never fires from inside a text-entry control: editors and
  // inputs may bind Ctrl/Cmd+K themselves (e.g. insert-link), so the palette
  // yields to them. While the palette is already open it owns the keyboard,
  // so the toggle-close still works from its own search input.
  function isEditableTarget(target) {
    return (
      target instanceof HTMLElement &&
      (target.isContentEditable ||
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT")
    );
  }
  useEffect(() => {
    function onKeyDown(event) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        if (!openRef.current && isEditableTarget(event.target)) return;
        event.preventDefault();
        if (openRef.current) {
          close();
        } else {
          requestOpen();
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener(COMMAND_PALETTE_OPEN_EVENT, requestOpen);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener(COMMAND_PALETTE_OPEN_EVENT, requestOpen);
    };
  }, []);

  if (!open) return null;
  return <CommandPaletteDialog onClose={close} />;
}
