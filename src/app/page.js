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
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export default async function Home() {
  const { count: listingsCount } = await supabase
    .from("listings")
    .select("*", { count: "exact", head: true });

  const { count: businessesCount } = await supabase
    .from("businesses")
    .select("*", { count: "exact", head: true });

  const { count: petsCount } = await supabase
    .from("pets")
    .select("*", { count: "exact", head: true });

  const { count: jobsCount } = await supabase
    .from("jobs")
    .select("*", { count: "exact", head: true });

  const { data: featuredListings } = await supabase
    .from("listings")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(3);

  const { data: featuredBusinesses } = await supabase
    .from("businesses")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(3);

  const { data: petOfTheWeek } = await supabase
    .from("pets")
    .select("*")
    .eq("pet_of_week_eligible", true)
    .order("votes", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (
    <main className="min-h-screen bg-gray-100 text-gray-900">
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
