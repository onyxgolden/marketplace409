// Shared, paginated fetch of every financial_events row for one owner. Both the preview and
// approval routes need the FULL set to classify Rentec transactions correctly — Supabase's
// PostgREST layer caps a plain .select() at a default page size (1000 rows) regardless of how many
// rows actually match, and this owner already has more rows than that. A silently truncated fetch
// here doesn't just produce a wrong preview: the classifier's evidence-matching against the legacy
// CSV import only sees whichever rows happened to land in the truncated page, so it can
// misclassify an already-represented legacy transaction as safeMissing, and — since the approval
// route re-runs this same fetch to recompute its "fresh" classification before writing — approving
// that misclassified row would insert a real duplicate financial_events row under a new
// (rentec_api, composite id) that the database's own uniqueness constraint has no way to catch,
// because it never collides with the legacy row's completely different source_record_id format.
const PAGE_SIZE = 1000;

export async function fetchAllOwnerFinancialEvents(database, ownerId, { columns } = {}) {
  const select = columns || "id, event_date, description, amount, transaction_kind, normalized_category, property_id, source_system, source_record_id, status, is_deleted";
  const rows = [];
  for (let start = 0; ; start += PAGE_SIZE) {
    const { data, error } = await database
      .from("financial_events")
      .select(select)
      .eq("owner_id", ownerId)
      .range(start, start + PAGE_SIZE - 1);
    if (error) throw error;
    const page = data || [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}
