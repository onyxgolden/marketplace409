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
import { getMarketplaceCounts, getMarketplaceFeatured } from "./_data";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Southeast Texas Marketplace | 409 Marketplace",
  description:
    "Buy and sell locally in Southeast Texas — listings, rentals, pets, jobs, local businesses, and community. Post your listing free.",
};

export default async function Home() {
  // A failed query throws inside the cached callbacks above, so no shared
  // failure entry is ever written. Handle it here with an explicit degraded
  // render — exactly what the page did before the queries were cached — and
  // never by catching inside the cache and returning a success-shaped object.
  let counts = {
    listingsCount: null,
    businessesCount: null,
    petsCount: null,
    jobsCount: null,
  };
  let featured = {
    featuredListings: null,
    featuredBusinesses: null,
    petOfTheWeek: null,
  };
  try {
    counts = await getMarketplaceCounts();
  } catch (error) {
    console.error("Marketplace counts unavailable", error);
  }
  try {
    featured = await getMarketplaceFeatured();
  } catch (error) {
    console.error("Marketplace featured content unavailable", error);
  }
  const { listingsCount, businessesCount, petsCount, jobsCount } = counts;
  const { featuredListings, featuredBusinesses, petOfTheWeek } = featured;
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
