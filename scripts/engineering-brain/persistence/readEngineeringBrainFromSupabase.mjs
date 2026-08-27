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

export async function fetchExcludedForRun(supabaseClient, runId) {
  const { data, error } = await supabaseClient.from("engineering_brain_excluded").select("*").eq("run_id", runId);
  if (error) throw new Error(`Failed to fetch excluded rows: ${error.message}`);
  return data;
}
