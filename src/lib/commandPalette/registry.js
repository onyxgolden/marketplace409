// Extensible command-palette action registry for the FORGE workspace.
//
// Any slice/feature can add actions without touching the palette UI:
//
//   import { registerCommandPaletteAction } from "@/lib/commandPalette/registry";
//   registerCommandPaletteAction({
//     id: "my-feature-do-thing",          // unique, stable
//     title: "Do the thing",              // shown in the palette
//     keywords: ["thing", "alias"],       // extra search terms (optional)
//     hint: "Where it lands",             // small caption under the title (optional)
//     group: "Actions",                   // grouping header (optional, defaults to "Actions")
//     href: "/forge/my-feature",          // navigate here on select ...
//     // ... or run a custom handler instead of navigating:
//     // run: () => openMyDialog(),
//   });
//
// Registration is idempotent per id (re-registering the same id is a no-op),
// so modules can safely register at import time and across client navigations.
// This module is framework-free so the registry and the fuzzy matcher stay
// unit-testable in plain node/vitest.

export const COMMAND_PALETTE_OPEN_EVENT = "forge:open-command-palette";

const actionsById = new Map();

function assertValidAction(action) {
  if (!action || typeof action !== "object") {
    throw new TypeError("registerCommandPaletteAction: action must be an object");
  }
  if (typeof action.id !== "string" || action.id.trim() === "") {
    throw new TypeError("registerCommandPaletteAction: action.id must be a non-empty string");
  }
  if (typeof action.title !== "string" || action.title.trim() === "") {
    throw new TypeError(`registerCommandPaletteAction("${action.id}"): action.title must be a non-empty string`);
  }
  if (typeof action.href !== "string" && typeof action.run !== "function") {
    throw new TypeError(
      `registerCommandPaletteAction("${action.id}"): action needs either an href or a run() handler`,
    );
  }
  if (action.keywords !== undefined && !Array.isArray(action.keywords)) {
    throw new TypeError(`registerCommandPaletteAction("${action.id}"): keywords must be an array of strings`);
  }
}

export function registerCommandPaletteAction(action) {
  assertValidAction(action);
  if (actionsById.has(action.id)) return actionsById.get(action.id);
  const frozen = Object.freeze({
    id: action.id,
    title: action.title,
    keywords: Object.freeze([...(action.keywords ?? [])]),
    hint: action.hint ?? "",
    group: action.group ?? "Actions",
    href: typeof action.href === "string" ? action.href : null,
    run: typeof action.run === "function" ? action.run : null,
  });
  actionsById.set(action.id, frozen);
  return frozen;
}

export function unregisterCommandPaletteAction(id) {
  return actionsById.delete(id);
}

export function getCommandPaletteActions() {
  return [...actionsById.values()];
}

export function findCommandPaletteAction(id) {
  return actionsById.get(id) ?? null;
}

// Test/maintenance helper: wipes the registry. Production code should prefer
// unregisterCommandPaletteAction(id); this exists so tests can isolate.
export function clearCommandPaletteActions() {
  actionsById.clear();
}

// --- Fuzzy matching ---------------------------------------------------------

// Subsequence scorer: every query character must appear in order in the text.
// Rewards matches at word starts and consecutive runs, prefers shorter text
// and earlier first matches. Returns -1 when the query is not a subsequence.
export function fuzzyScore(query, text) {
  const q = String(query ?? "").toLowerCase().trim();
  const t = String(text ?? "").toLowerCase();
  if (q === "") return 0;
  let qi = 0;
  let score = 0;
  let run = 0;
  let firstMatch = -1;
  for (let ti = 0; ti < t.length && qi < q.length; ti += 1) {
    if (t[ti] === q[qi]) {
      if (firstMatch === -1) firstMatch = ti;
      const wordStart = ti === 0 || /[\s\-_/.]/.test(t[ti - 1]);
      score += 1 + (wordStart ? 4 : 0) + run * 2;
      run += 1;
      qi += 1;
    } else {
      run = 0;
    }
  }
  if (qi < q.length) return -1;
  score += Math.max(0, 8 - firstMatch);
  score -= t.length * 0.01;
  return score;
}

// Keywords are aliases, not the primary label: weight them below a title
// match of comparable strength so the visible title is what ranks first.
const KEYWORD_SCORE_WEIGHT = 0.75;

function actionScore(action, query) {
  const titleScore = fuzzyScore(query, action.title);
  if (titleScore < 0 && action.keywords.length === 0) return -1;
  let best = titleScore;
  for (const keyword of action.keywords) {
    const keywordScore = fuzzyScore(query, keyword);
    if (keywordScore >= 0) best = Math.max(best, keywordScore * KEYWORD_SCORE_WEIGHT);
  }
  return best;
}

// Filter + rank actions for a query. Empty/blank query returns everything in
// registration order (stable). Non-matching actions are dropped; the rest are
// sorted best-first with registration order as the tiebreak.
export function filterCommandPaletteActions(actions, query) {
  const q = String(query ?? "").trim();
  if (q === "") return [...actions];
  const scored = [];
  for (let index = 0; index < actions.length; index += 1) {
    const action = actions[index];
    const score = actionScore(action, q);
    if (score >= 0) scored.push({ action, score, index });
  }
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.map((entry) => entry.action);
}

// Convenience: filter the live registry in one call.
export function searchCommandPalette(query) {
  return filterCommandPaletteActions(getCommandPaletteActions(), query);
}

// Dispatch this (e.g. from a visible trigger button) to open the palette.
export function openCommandPalette() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(COMMAND_PALETTE_OPEN_EVENT));
  }
}
