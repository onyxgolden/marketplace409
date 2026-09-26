// Dashboard card system for the financial overview.
//
// A layout is { order: [cardId, ...], hidden: [cardId, ...] } -- `order` is the
// full display sequence (hidden cards keep their slots, so un-hiding restores
// them where they were), `hidden` is the subset currently hidden. Everything
// in this module is pure: no React, no storage, no I/O, so the algebra is
// unit-testable in isolation. Persistence lives in useDashboardLayout.js,
// rendering in DashboardCardStack.jsx.
//
// All copy uses generic industry terminology only.

export const LAYOUT_STORAGE_VERSION = 1;

// KPI tiles rendered by FinancialKpiSurface on the financial dashboard.
export const FINANCIAL_KPI_CARD_IDS = Object.freeze([
  "equity",
  "cash",
  "profit",
  "margin",
]);

// Content sections stacked in the financial overview column.
export const FINANCIAL_SECTION_CARD_IDS = Object.freeze([
  "activity",
  "intelligence",
  "position",
  "compare",
  "ask-books",
  "brain-actions",
  "anomalies",
  "cash-forecast",
  "left-this-month",
  "debt-payoff",
]);

export const FINANCIAL_KPI_CARD_TITLES = Object.freeze({
  equity: "Net worth / equity",
  cash: "Cash",
  profit: "Monthly profit",
  margin: "Profit margin",
});

export const FINANCIAL_SECTION_CARD_TITLES = Object.freeze({
  activity: "Financial activity",
  intelligence: "Executive intelligence",
  position: "Balance sheet snapshot",
  compare: "Compare months",
  "ask-books": "Ask your books",
  "brain-actions": "Recommended actions",
  anomalies: "Anomaly alerts",
  "cash-forecast": "Cash forecast",
  "left-this-month": "Left this month",
  "debt-payoff": "Debt payoff optimizer",
});

// Every KPI number on the dashboard drills into the section that explains it.
// In-page anchors follow the established /forge/financial#section pattern
// (the debt payoff optimizer is already linked this way from the budget
// workspace). Anchors travel with their cards when the layout is reordered.
export const FINANCIAL_KPI_DEEP_LINKS = Object.freeze({
  equity: "#financial-position-snapshot",
  cash: "#cash-forecast",
  profit: "#financial-forge-overview",
  margin: "#month-comparison",
});

// The hero headline ("Cash on hand") answers "how much cash do I have right
// now" -- the 90-day cash forecast is its forward-looking drill-down.
export const FINANCIAL_HEADLINE_DEEP_LINK = "#cash-forecast";

// The activity card's income/expense summary tiles drill into the full
// transaction history (the financial page reads ?tab= to select its tab).
export const FINANCIAL_ACTIVITY_TRANSACTIONS_LINK = "/forge/financial?tab=transactions";

export function layoutStorageKey(actingUserId) {
  return `forge.financial.dashboard.layout.v${LAYOUT_STORAGE_VERSION}.${actingUserId || "shared"}`;
}

// The "shared" key is a pre-identity fallback, never a persistence target:
// layout mutations must not be written there, or one session could mutate the
// fallback layout another session (or a signed-out visitor) reads.
export function isSharedLayoutKey(storageKey) {
  return typeof storageKey === "string" && storageKey.endsWith(".shared");
}

export function createLayout(cardIds) {
  return {
    order: [...cardIds],
    hidden: [],
  };
}

// Sanitize a stored layout against the current registry: unknown ids are
// dropped, cards added by a later release are appended in default position,
// and the hidden list is filtered to known ids. Never throws on malformed
// input -- garbage in, defaults out.
export function normalizeLayout(raw, cardIds) {
  const known = new Set(cardIds);
  const seen = new Set();
  const order = [];

  const rawOrder = Array.isArray(raw?.order) ? raw.order : [];
  for (const id of rawOrder) {
    if (known.has(id) && !seen.has(id)) {
      seen.add(id);
      order.push(id);
    }
  }
  for (const id of cardIds) {
    if (!seen.has(id)) order.push(id);
  }

  const rawHidden = Array.isArray(raw?.hidden) ? raw.hidden : [];
  const hidden = rawHidden.filter((id) => known.has(id));

  return { order, hidden };
}

export function visibleIds(layout) {
  const hidden = new Set(layout.hidden);
  return layout.order.filter((id) => !hidden.has(id));
}

export function hiddenIds(layout) {
  const known = new Set(layout.order);
  return layout.hidden.filter((id) => known.has(id));
}

export function isDefaultLayout(layout, cardIds) {
  const expected = createLayout(cardIds);
  return (
    layout.order.length === expected.order.length
    && layout.order.every((id, index) => id === expected.order[index])
    && layout.hidden.length === 0
  );
}

// Move a card one step within the full order array, swapping with the nearest
// VISIBLE neighbor in the given direction (delta -1 = up, +1 = down). Hidden
// cards keep their slots, so un-hiding restores them where they were. Returns
// the original order array unchanged when the move is impossible.
export function moveCardId(order, hidden, cardId, delta) {
  const hiddenSet = new Set(hidden);
  const visible = order.filter((id) => !hiddenSet.has(id));
  const fromVisible = visible.indexOf(cardId);
  const toVisible = fromVisible + delta;
  if (fromVisible === -1 || toVisible < 0 || toVisible >= visible.length) {
    return order;
  }
  const next = [...order];
  const fromIndex = next.indexOf(cardId);
  const toIndex = next.indexOf(visible[toVisible]);
  next[fromIndex] = visible[toVisible];
  next[toIndex] = cardId;
  return next;
}
