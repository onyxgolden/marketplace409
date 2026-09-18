// Pure, deterministic budget-suggestion math -- no Supabase client, no AI/LLM call. Forge Brain's
// planned end-user layer (see the "Forge Brain vs Engineering Brain" project note) narrates numbers
// like this one, it never invents them; this module is that number.

function yearMonthOf(isoDate) {
  return isoDate.slice(0, 7);
}

export function addMonths(yearMonth, delta) {
  const [year, month] = yearMonth.split("-").map(Number);
  const totalMonths = year * 12 + (month - 1) + delta;
  const normalizedYear = Math.floor(totalMonths / 12);
  const normalizedMonth = (totalMonths % 12) + 1;
  return `${normalizedYear}-${String(normalizedMonth).padStart(2, "0")}`;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// events: plain rows for ONE category, each { eventDate: "YYYY-MM-DD", amount: number (dollars) }.
// The month containing asOfDate is always excluded (it's in progress, not a complete month). Months
// in the lookback window with zero matching events are treated as real $0 samples, not missing data
// -- that's a genuine "didn't spend in this category that month" signal for an infrequent category.
// Only when NONE of the lookback months have any event at all is there nothing to suggest from.
export function computeCategorySuggestion({ events, asOfDate, lookbackMonths = 3 }) {
  if (!Array.isArray(events)) {
    throw new Error("events must be an array");
  }
  if (typeof asOfDate !== "string" || !asOfDate) {
    throw new Error("asOfDate is required");
  }
  if (!Number.isInteger(lookbackMonths) || lookbackMonths < 1) {
    throw new Error("lookbackMonths must be a positive integer");
  }

  const currentMonth = yearMonthOf(asOfDate);
  const basisMonths = [];
  for (let i = lookbackMonths; i >= 1; i -= 1) {
    basisMonths.push(addMonths(currentMonth, -i));
  }
  const basisMonthSet = new Set(basisMonths);

  const sumsByMonth = new Map(basisMonths.map((month) => [month, 0]));
  const monthsWithData = new Set();

  for (const event of events) {
    const month = yearMonthOf(event.eventDate);
    if (!basisMonthSet.has(month)) continue;
    sumsByMonth.set(month, sumsByMonth.get(month) + event.amount);
    monthsWithData.add(month);
  }

  const sampleMonths = monthsWithData.size;

  if (sampleMonths === 0) {
    return Object.freeze({ suggestedAmountCents: null, sampleMonths: 0, basisMonths: Object.freeze(basisMonths) });
  }

  const monthlySums = basisMonths.map((month) => sumsByMonth.get(month));
  const suggestedAmountCents = Math.round(median(monthlySums) * 100);

  return Object.freeze({ suggestedAmountCents, sampleMonths, basisMonths: Object.freeze(basisMonths) });
}
