import { unstable_cache } from "next/cache";
import { supabase } from "@/lib/supabase";

// Supabase resolves query failures as { data, count, error } instead of
// throwing. If a failure slipped through here, unstable_cache would persist
// the null result as a successful shared entry and hide the outage from every
// later visitor until revalidation. Reject instead: thrown errors are never
// cached, so a failed request retries on the next visit and a failed
// background refresh keeps the last good entry.
function assertNoQueryError(results, label) {
  for (const result of results) {
    if (result && result.error) {
      throw new Error(
        `Marketplace ${label} query failed: ${result.error.message || "unknown database error"}`
      );
    }
  }
}

// Category counts change slowly — cache for 5 minutes so the page stops
// re-running 4 count queries on every request. Same data, bounded staleness.
export const getMarketplaceCounts = unstable_cache(
  async () => {
    const results = await Promise.all([
      supabase.from("listings").select("*", { count: "exact", head: true }),
      supabase.from("businesses").select("*", { count: "exact", head: true }),
      supabase.from("pets").select("*", { count: "exact", head: true }),
      supabase.from("jobs").select("*", { count: "exact", head: true }),
    ]);
    assertNoQueryError(results, "count");
    const [
      { count: listingsCount },
      { count: businessesCount },
      { count: petsCount },
      { count: jobsCount },
    ] = results;
    return { listingsCount, businessesCount, petsCount, jobsCount };
  },
  ["market-page-counts"],
  { revalidate: 300 }
);

// Featured rows turn over faster — cache for 60 seconds. Same rows,
// same order; a request may see up to a minute of staleness.
export const getMarketplaceFeatured = unstable_cache(
  async () => {
    const results = await Promise.all([
      supabase
        .from("listings")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(3),
      supabase
        .from("businesses")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(3),
      supabase
        .from("pets")
        .select("*")
        .eq("pet_of_week_eligible", true)
        .order("votes", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    assertNoQueryError(results, "featured");
    const [
      { data: featuredListings },
      { data: featuredBusinesses },
      { data: petOfTheWeek },
    ] = results;
    return { featuredListings, featuredBusinesses, petOfTheWeek };
  },
  ["market-page-featured"],
  { revalidate: 60 }
);
