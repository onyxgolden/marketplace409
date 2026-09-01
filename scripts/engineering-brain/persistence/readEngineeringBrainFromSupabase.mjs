// Minimal read-back layer proving the persisted index is genuinely queryable by application code,
// not just the sync script. Deliberately thin: Phase 2's actual query engine (ranking, matching,
// excerpt resolution) still reads the local JSON manifest and is unchanged by this phase -- unifying
// the two is a real design decision left for a later phase, not assumed here (see the Phase 3 report).

export async function fetchLatestRun(supabaseClient) {
  const { data, error } = await supabaseClient
    .from("engineering_brain_runs")
    .select("*")
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Failed to fetch the latest run: ${error.message}`);
  return data;
}

export async function fetchRecordsForRun(supabaseClient, runId, { sourceType, authorityLevel, symbolOrSection, limit = 1000 } = {}) {
  let query = supabaseClient.from("engineering_brain_records").select("*").eq("run_id", runId).limit(limit);
  if (sourceType) query = query.eq("source_type", sourceType);
  if (authorityLevel) query = query.eq("authority_level", authorityLevel);
  if (symbolOrSection) query = query.eq("symbol_or_section", symbolOrSection);
  const { data, error } = await query;
  if (error) throw new Error(`Failed to fetch records: ${error.message}`);
  return data;
}

const DEFAULT_PAGE_SIZE = 1000;

// Supabase/PostgREST silently caps a response at its own server-side row limit regardless of the
// `.limit(n)` requested in the query -- a plain single-page fetch with a large `limit` looks correct
// locally (small test fixtures never hit the cap) but truncates real data, dropping whichever
// source_types happen to sync after the cap in insertion order. Paginate with `.range()` instead,
// ordered by the table's own `id` for a stable cursor, until a short page proves there's no more.
export async function fetchAllRecordsForRun(supabaseClient, runId, { sourceType, authorityLevel, symbolOrSection, columns = "*", pageSize = DEFAULT_PAGE_SIZE } = {}) {
  const records = [];
  let from = 0;
  for (;;) {
    let query = supabaseClient
      .from("engineering_brain_records")
      .select(columns)
      .eq("run_id", runId)
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (sourceType) query = query.eq("source_type", sourceType);
    if (authorityLevel) query = query.eq("authority_level", authorityLevel);
    if (symbolOrSection) query = query.eq("symbol_or_section", symbolOrSection);
    const { data, error } = await query;
    if (error) throw new Error(`Failed to fetch records: ${error.message}`);
    records.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return records;
}

export async function fetchExcludedForRun(supabaseClient, runId) {
  const { data, error } = await supabaseClient.from("engineering_brain_excluded").select("*").eq("run_id", runId);
  if (error) throw new Error(`Failed to fetch excluded rows: ${error.message}`);
  return data;
}

// Exact row counts via Postgres's own count, not by fetching rows and measuring the array length --
// fetchRecordsForRun's default `limit: 1000` would silently undercount this repo's 4,400+ records,
// which is exactly the kind of "looked successful, was actually wrong" failure a sync verification
// step exists to catch. `{ head: true }` means Postgres never sends the rows themselves, just the count.
export async function countRecordsForRun(supabaseClient, runId) {
  const { count, error } = await supabaseClient
    .from("engineering_brain_records")
    .select("*", { count: "exact", head: true })
    .eq("run_id", runId);
  if (error) throw new Error(`Failed to count records: ${error.message}`);
  return count;
}

export async function countExcludedForRun(supabaseClient, runId) {
  const { count, error } = await supabaseClient
    .from("engineering_brain_excluded")
    .select("*", { count: "exact", head: true })
    .eq("run_id", runId);
  if (error) throw new Error(`Failed to count excluded rows: ${error.message}`);
  return count;
}
