import Header from "@/components/Header";
import HomeLaunchBanner from "@/components/home/HomeLaunchBanner";
import HomeHero from "@/components/home/HomeHero";
import HomeCategories from "@/components/home/HomeCategories";
import HomePetOfWeek from "@/components/home/HomePetOfWeek";
import HomeFeaturedListings from "@/components/home/HomeFeaturedListings";
import HomeBusinessSpotlight from "@/components/home/HomeBusinessSpotlight";
import HomeCommunityHub from "@/components/home/HomeCommunityHub";
import HomeCrossPosting from "@/components/home/HomeCrossPosting";
import HomeMarketplaceStats from "@/components/home/HomeMarketplaceStats";
import HomeWhyLocal from "@/components/home/HomeWhyLocal";
import HomeFooter from "@/components/home/HomeFooter";
import HomeMobileBottomNav from "@/components/home/HomeMobileBottomNav";
import { unstable_cache } from "next/cache";
import { supabase } from "@/lib/supabase";

// Category counts change slowly — cache for 5 minutes so the page stops
// re-running 4 count queries on every request. Same data, bounded staleness.
const getMarketplaceCounts = unstable_cache(
  async () => {
    const [
      { count: listingsCount },
      { count: businessesCount },
      { count: petsCount },
      { count: jobsCount },
    ] = await Promise.all([
      supabase.from("listings").select("*", { count: "exact", head: true }),
      supabase.from("businesses").select("*", { count: "exact", head: true }),
      supabase.from("pets").select("*", { count: "exact", head: true }),
      supabase.from("jobs").select("*", { count: "exact", head: true }),
    ]);
    return { listingsCount, businessesCount, petsCount, jobsCount };
  },
  ["market-page-counts"],
  { revalidate: 300 }
);

// Featured rows turn over faster — cache for 60 seconds. Same rows,
// same order; a request may see up to a minute of staleness.
const getMarketplaceFeatured = unstable_cache(
  async () => {
    const [
      { data: featuredListings },
      { data: featuredBusinesses },
      { data: petOfTheWeek },
    ] = await Promise.all([
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
    return { featuredListings, featuredBusinesses, petOfTheWeek };
  },
  ["market-page-featured"],
  { revalidate: 60 }
);

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Southeast Texas Marketplace | 409 Marketplace",
  description:
    "Buy and sell locally in Southeast Texas — listings, rentals, pets, jobs, local businesses, and community. Post your listing free.",
};

export default async function Home() {
  const { listingsCount, businessesCount, petsCount, jobsCount } =
    await getMarketplaceCounts();
  const { featuredListings, featuredBusinesses, petOfTheWeek } =
    await getMarketplaceFeatured();
  return (
    <main className="min-h-screen bg-gray-100 text-gray-900 dark:bg-slate-950">
      <HomeLaunchBanner />

      <Header />

      <HomeHero />

          <HomeCategories />

      <HomePetOfWeek petOfTheWeek={petOfTheWeek} />

      <HomeFeaturedListings featuredListings={featuredListings} />

      <HomeBusinessSpotlight featuredBusinesses={featuredBusinesses} />

      <HomeCommunityHub />

      <HomeCrossPosting />

      <HomeMarketplaceStats
        listingsCount={listingsCount}
        businessesCount={businessesCount}
        petsCount={petsCount}
        jobsCount={jobsCount}
      />

      <HomeWhyLocal />

      <HomeFooter />

      <HomeMobileBottomNav />

    </main>
  );
}
