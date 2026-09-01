const activeExpense = (event) => event.transaction_kind === "expense"
  && event.status !== "inactive" && event.status !== "deleted" && event.is_deleted !== true;

export function buildBusinessExpenseReport({ events = [] }, { scope = "all", propertyId = "", category = "", startDate = "", endDate = "" } = {}) {
  const active = events.filter(activeExpense);
  const availableProperties = Object.freeze([...new Set(active.map((event) => event.property_id).filter(Boolean))].sort());
  const availableCategories = Object.freeze([...new Set(active.map((event) => event.normalized_category || "other"))].sort());
  const rows = active.filter((event) => {
    if (scope === "portfolio" && event.property_id) return false;
    if (scope === "property" && !event.property_id) return false;
    if (propertyId && event.property_id !== propertyId) return false;
    if (category && (event.normalized_category || "other") !== category) return false;
    if (startDate && event.event_date < startDate) return false;
    if (endDate && event.event_date > endDate) return false;
    return true;
  }).map((event) => Object.freeze({
    id: event.id, date: event.event_date, description: event.description,
    category: event.normalized_category || "other", propertyId: event.property_id || "unassigned",
    amount: Math.abs(Number(event.amount)),
  })).sort((a, b) => a.date > b.date ? -1 : a.date < b.date ? 1 : String(a.id).localeCompare(String(b.id)));
  const categoryTotals = new Map();
  const propertyTotals = new Map();
  for (const row of rows) {
    categoryTotals.set(row.category, (categoryTotals.get(row.category) || 0) + row.amount);
    propertyTotals.set(row.propertyId, (propertyTotals.get(row.propertyId) || 0) + row.amount);
  }
  return Object.freeze({
    generatedAt: new Date().toISOString(), scope, propertyId: propertyId || null, category: category || null,
    startDate: startDate || null, endDate: endDate || null, availableProperties, availableCategories,
    summary: Object.freeze({ transactionCount: rows.length, totalExpenses: rows.reduce((sum, row) => sum + row.amount, 0) }),
    byCategory: Object.freeze([...categoryTotals.entries()].map(([name, amount]) => Object.freeze({ category: name, amount })).sort((a, b) => b.amount - a.amount || a.category.localeCompare(b.category))),
    byProperty: Object.freeze([...propertyTotals.entries()].map(([id, amount]) => Object.freeze({ propertyId: id, amount })).sort((a, b) => a.propertyId.localeCompare(b.propertyId))),
    rows: Object.freeze(rows),
  });
}

const csv = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
export function businessExpenseReportToCsv(report) {
  const lines = [["Date", "Description", "Category", "Scope / property", "Amount"]];
  for (const row of report.rows) lines.push([row.date, row.description, row.category, row.propertyId, row.amount.toFixed(2)]);
  lines.push(["", "Total", "", "", report.summary.totalExpenses.toFixed(2)]);
  return lines.map((row) => row.map(csv).join(",")).join("\n");
}
