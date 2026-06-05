import Header from "@/components/Header";
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
  return (
    <main className="min-h-screen bg-gray-100 text-gray-900">
      
{/* Launch Banner */}
<div className="bg-red-600 text-white text-center px-4 py-3 font-semibold">
  🚀 409 Marketplace is in early build mode — Southeast Texas sellers, businesses,
  shelters, and contractors can request early access soon.
</div>

      <Header />
      

      {/* Hero Section */}
     <section className="relative py-24 px-6 overflow-hidden">
       <div className="absolute inset-0 bg-gradient-to-r from-blue-950 via-blue-900 to-red-700 opacity-95"></div>

<div className="relative max-w-5xl mx-auto text-center text-white">
  <div className="mb-10 rounded-3xl overflow-hidden shadow-2xl border border-white/20">
  <img
   src="https://images.unsplash.com/photo-1516321318423-f06f85e504b3?q=80&w=1600&auto=format&fit=crop"
    alt="Local Marketplace Community"
    className="w-full h-[350px] object-cover"
  />
</div>
          <h2 className="text-6xl font-extrabold mb-6 leading-tight">
            Southeast Texas Marketplace
          </h2>

          <p className="text-xl text-blue-100 mb-6">
  Buy Local. Sell Local. Support Community.
</p>

<div className="flex flex-wrap justify-center gap-3 mb-8">
  <span className="bg-blue-100 text-blue-900 px-4 py-2 rounded-full font-semibold">
    🇺🇸 Made in USA
  </span>

  <span className="bg-red-100 text-red-700 px-4 py-2 rounded-full font-semibold">
    🛠 Veteran Owned
  </span>

  <span className="bg-green-100 text-green-700 px-4 py-2 rounded-full font-semibold">
    🌽 Local Farms
  </span>

  <span className="bg-yellow-100 text-yellow-800 px-4 py-2 rounded-full font-semibold">
    🏠 Local Rentals
  </span>

  <span className="bg-purple-100 text-purple-800 px-4 py-2 rounded-full font-semibold">
    🐶 Community Pets
  </span>
</div>
<div className="bg-white rounded-2xl shadow-2xl p-4 max-w-4xl mx-auto mb-10">
  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">

    <input
      className="border rounded-xl px-4 py-3 text-gray-900"
      placeholder="What are you looking for?"
    />

    <input
      className="border rounded-xl px-4 py-3 text-gray-900"
      placeholder="City or ZIP"
    />

    <select className="border rounded-xl px-4 py-3 text-gray-900">
      <option>All Categories</option>
      <option>Vehicles</option>
      <option>Rentals</option>
      <option>Services</option>
      <option>Farm & Ranch</option>
      <option>Pets</option>
      <option>Electronics</option>
      <option>Music & Instruments</option>
      <option>Boats & Marine</option>
      <option>Hunting & Fishing</option>
      <option value="Tools & Equipment">Tools & Equipment</option>
      <option>Miscellaneous</option>

    </select>

    <button className="bg-red-600 text-white rounded-xl font-bold hover:bg-red-500">
      Search
    </button>

  </div>
</div>
          <div className="flex justify-center gap-4">
            <button className="bg-blue-900 text-white px-6 py-3 rounded-xl text-lg font-semibold hover:bg-blue-800">
              <a
  href="/browse"
  className="bg-blue-900 text-white px-6 py-3 rounded-xl text-lg font-semibold hover:bg-blue-800"
>
  Browse Listings
</a>
            </button>

            <a
  href="/post"
  className="bg-red-600 text-white px-6 py-3 rounded-xl text-lg font-semibold hover:bg-red-500"
>
  Post Listing
</a>
          </div>
        </div>
      </section>
      {/* Marketplace Stats */}
<section className="max-w-6xl mx-auto py-10 px-6">
  <div className="grid grid-cols-2 md:grid-cols-5 gap-6">

    <div className="bg-white rounded-2xl shadow-md p-6 text-center">
      <h3 className="text-4xl font-extrabold text-blue-900">{listingsCount || 0}</h3>
      <p className="text-gray-600 mt-2">Live Listings</p>
    </div>

    <div className="bg-white rounded-2xl shadow-md p-6 text-center">
      <h3 className="text-4xl font-extrabold text-red-600">{businessesCount || 0}</h3>
      <p className="text-gray-600 mt-2">Local Businesses</p>
    </div>

    <div className="bg-white rounded-2xl shadow-md p-6 text-center">
      <h3 className="text-4xl font-extrabold text-green-700">{petsCount || 0}</h3>
      <p className="text-gray-600 mt-2">Pet Posts</p>
    </div>

    <div className="bg-white rounded-2xl shadow-md p-6 text-center">
      <h3 className="text-4xl font-extrabold text-purple-700">{jobsCount || 0}</h3>
      <p className="text-gray-600 mt-2">Local Jobs</p>
    </div>

  </div>
</section>
      {/* Launch Signup */}
<section className="max-w-5xl mx-auto py-10 px-6">
  <div className="bg-red-600 text-white rounded-3xl shadow-lg p-8 text-center">
    <p className="uppercase tracking-wide text-red-100 mb-2">
      Coming Soon to Southeast Texas
    </p>

    <h3 className="text-3xl font-bold mb-4">
      Be First to Post on 409 Marketplace
    </h3>

    <p className="text-lg text-red-100 mb-6">
      Join the early list for local sellers, contractors, businesses, pet shelters,
      farmers, and buyers.
    </p>

    <div className="flex flex-col md:flex-row gap-4 max-w-2xl mx-auto">
      <input
        className="flex-1 rounded-xl px-4 py-3 text-gray-900"
        placeholder="Enter your email..."
      />

      <button className="bg-blue-900 px-6 py-3 rounded-xl font-bold hover:bg-blue-800">
        Join Early List
      </button>
    </div>
  </div>
<section className="max-w-6xl mx-auto py-10 px-6">
  <div className="bg-white rounded-3xl shadow-md p-8">
    <label className="block text-xl font-bold mb-3">
      Select Your Local Marketplace
    </label>

    <select
      className="w-full md:w-96 border rounded-xl px-4 py-4 text-lg"
      defaultValue="409"
    >
      <option value="409">409 Marketplace — Southeast Texas</option>
    </select>
  </div>
</section>
</section>
{/* Cross Posting Feature */}
<section className="max-w-6xl mx-auto py-10 px-6">
  <div className="bg-blue-900 text-white rounded-3xl p-8 shadow-lg">
    <p className="text-sm uppercase tracking-wide text-blue-200 mb-2">
      Seller Tool
    </p>

    <h3 className="text-3xl font-bold mb-4">
      Easy Cross Posting
    </h3>

    <p className="text-lg text-blue-100 mb-6">
      Already posted on Facebook, Craigslist, or OfferUp? Paste your listing,
      upload screenshots, and let 409 Marketplace help clean it up for local buyers.
    </p>

    <div className="flex flex-col md:flex-row gap-4">
      <input
        className="flex-1 rounded-xl px-4 py-3 text-gray-900"
        placeholder="Paste listing text or link here..."
      />

      <a
  href="/import"
  className="bg-red-600 px-6 py-3 rounded-xl font-bold hover:bg-red-500"
>
  Import Listing
</a>
    </div>
  </div>
</section>
{/* Local Trust Tags */}
<section className="max-w-6xl mx-auto py-8 px-6">
  <h3 className="text-2xl font-bold mb-5">Shop by Local Trust Tags</h3>

  <div className="flex flex-wrap gap-3">
    <button className="bg-white shadow px-5 py-3 rounded-full font-semibold hover:bg-blue-50">
      🇺🇸 Made in USA
    </button>

    <button className="bg-white shadow px-5 py-3 rounded-full font-semibold hover:bg-blue-50">
      Texas Made
    </button>

    <button className="bg-white shadow px-5 py-3 rounded-full font-semibold hover:bg-blue-50">
      Veteran Owned
    </button>

    <button className="bg-white shadow px-5 py-3 rounded-full font-semibold hover:bg-blue-50">
      Family Owned
    </button>

    <button className="bg-white shadow px-5 py-3 rounded-full font-semibold hover:bg-blue-50">
      Local Farm
    </button>

    <button className="bg-white shadow px-5 py-3 rounded-full font-semibold hover:bg-blue-50">
      Licensed Contractor
    </button>

    <button className="bg-white shadow px-5 py-3 rounded-full font-semibold hover:bg-blue-50">
      Shelter Partner
    </button>
  </div>
</section>
      {/* Categories */}
      <section className="max-w-6xl mx-auto py-12 px-6">
        <h3 className="text-3xl font-bold mb-8">Popular Categories</h3>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">

          <a
           href="/browse?category=Vehicles"
           className="bg-white p-6 rounded-2xl shadow-md text-center block hover:shadow-xl"
          >
            🚗
          <h4 className="text-xl font-bold mt-3">Vehicles</h4>
        </a>

          <a
           href="/browse?category=Rentals"
           className="bg-white p-6 rounded-2xl shadow-md text-center block hover:shadow-xl"
          >
            🏠
          <h4 className="text-xl font-bold mt-3">Rentals</h4>
          </a>

          <a
            href="/jobs"
            className="bg-white p-6 rounded-2xl shadow-md text-center block hover:shadow-xl"
          >
            💼
            <h4 className="text-xl font-bold mt-3">409 Jobs</h4>
          </a>

          <a
            href="/pets"
            className="bg-white p-6 rounded-2xl shadow-md text-center block hover:shadow-xl"
          >
            🐶
          <h4 className="text-xl font-bold mt-3">Pets & Shelters</h4>
          </a>

        </div>
      </section>
      {/* Local Business Spotlight */}
<section className="max-w-6xl mx-auto py-12 px-6">
  <div className="bg-white rounded-3xl shadow-md p-8">
    <div className="flex flex-col md:flex-row justify-between gap-6 items-center">
      <div>
        <p className="text-sm uppercase tracking-wide text-gray-500 mb-2">
          Support Local Business
        </p>

        <h3 className="text-3xl font-bold mb-3">
          Local Business Spotlight
        </h3>

        <p className="text-gray-600 text-lg">
          Featuring Southeast Texas businesses, contractors, makers, farms,
          shelters, and service providers.
        </p>
      </div>

      <button className="bg-blue-900 text-white px-6 py-3 rounded-xl font-bold hover:bg-blue-800">
        Nominate a Business
      </button>
    </div>

    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-8">
      <div className="border rounded-2xl p-5">
        <div className="text-4xl mb-3">🔨</div>
        <h4 className="text-xl font-bold">409 Custom Woodworks</h4>
        <p className="text-gray-600 mt-2">
          Handmade tables, cabinets, and home projects.
        </p>
        <p className="mt-3 text-sm font-bold text-blue-900">
          Texas Made • Family Owned
        </p>
      </div>

      <div className="border rounded-2xl p-5">
        <div className="text-4xl mb-3">🐕</div>
        <h4 className="text-xl font-bold">Beaumont Pet Rescue</h4>
        <p className="text-gray-600 mt-2">
          Helping local pets find safe and loving homes.
        </p>
        <p className="mt-3 text-sm font-bold text-blue-900">
          Shelter Partner • Community Pets
        </p>
      </div>

      <div className="border rounded-2xl p-5">
        <div className="text-4xl mb-3">🌽</div>
        <h4 className="text-xl font-bold">Southeast TX Farm Stand</h4>
        <p className="text-gray-600 mt-2">
          Local produce, eggs, honey, and handmade goods.
        </p>
        <p className="mt-3 text-sm font-bold text-blue-900">
          Local Farms • Farm Fresh
        </p>
      </div>
    </div>
  </div>
</section>
{/* Recent Local Activity */}
<section className="max-w-6xl mx-auto py-8 px-6">
  <div className="bg-white rounded-3xl shadow-md p-6">
    <h3 className="text-2xl font-bold mb-5">Recent Local Activity</h3>

    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
      <div className="border rounded-2xl p-4">
        <p className="text-sm text-gray-500">Just Posted</p>
        <p className="font-bold">Utility Trailer</p>
        <p className="text-sm text-gray-600">Orange, TX</p>
      </div>

      <div className="border rounded-2xl p-4">
        <p className="text-sm text-gray-500">New Business</p>
        <p className="font-bold">409 Custom Woodworks</p>
        <p className="text-sm text-gray-600">Beaumont, TX</p>
      </div>

      <div className="border rounded-2xl p-4">
        <p className="text-sm text-gray-500">Pet Spotlight</p>
        <p className="font-bold">Daisy needs a home</p>
        <p className="text-sm text-gray-600">Beaumont, TX</p>
      </div>

      <div className="border rounded-2xl p-4">
        <p className="text-sm text-gray-500">Local Service</p>
        <p className="font-bold">Roofing Quotes Available</p>
        <p className="text-sm text-gray-600">Port Arthur, TX</p>
      </div>
    </div>
  </div>
</section>
{/* Featured Listings */}
<section className="max-w-6xl mx-auto py-12 px-6">
  <div className="flex justify-between items-center mb-8">
    <h3 className="text-3xl font-bold">Featured Local Listings</h3>
    <a href="#" className="text-blue-900 font-bold">
      View All
    </a>
  </div>

  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
    <div className="bg-white rounded-2xl shadow-md overflow-hidden">
      <div className="h-44 bg-gray-300 flex items-center justify-center text-5xl">
        🚜
      </div>
      <div className="p-5">
        <p className="text-sm text-gray-500">Orange, TX</p>
        <h4 className="text-xl font-bold">Utility Trailer</h4>
        <p className="text-2xl font-bold text-green-700 mt-2">$1,850</p>
        <p className="mt-3 text-gray-600">
          Good tires, working lights, ready to haul.
        </p>
      </div>
    </div>

    <div className="bg-white rounded-2xl shadow-md overflow-hidden">
      <div className="h-44 bg-gray-300 flex items-center justify-center text-5xl">
        🛋️
      </div>
      <div className="p-5">
        <p className="text-sm text-gray-500">Beaumont, TX</p>
        <h4 className="text-xl font-bold">Solid Oak Dining Table</h4>
        <p className="text-2xl font-bold text-green-700 mt-2">$450</p>
        <p className="mt-3 text-gray-600">
          Texas Made • Local Pickup • Family Owned
        </p>
      </div>
    </div>

    <div className="bg-white rounded-2xl shadow-md overflow-hidden">
      <div className="h-44 bg-gray-300 flex items-center justify-center text-5xl">
        🛠️
      </div>
      <div className="p-5">
        <p className="text-sm text-gray-500">Port Arthur, TX</p>
        <h4 className="text-xl font-bold">Local Roofing Contractor</h4>
        <p className="text-2xl font-bold text-green-700 mt-2">Free Quotes</p>
        <p className="mt-3 text-gray-600">
          Licensed • Insured • Veteran Owned
        </p>
      </div>
    </div>
  </div>
</section>
      {/* Pet of the Week */}
      <section className="bg-white py-14 px-6">
        <div className="max-w-5xl mx-auto rounded-3xl shadow-lg overflow-hidden">
          
          <div className="bg-orange-500 text-white p-6">
            <h3 className="text-3xl font-bold">🐾 Pet of the Week</h3>
          </div>

          <div className="p-8">
            <h4 className="text-2xl font-bold mb-2">Meet Daisy</h4>

            <p className="text-lg text-gray-700 mb-4">
              2-Year-Old Lab Mix looking for her forever home in Beaumont, Texas.
            </p>

            <button className="bg-blue-900 text-white px-5 py-3 rounded-xl hover:bg-blue-800"></button>
          </div>

        </div>
      </section>
      {/* Real Estate & Investment Hub */}
<section className="max-w-6xl mx-auto py-12 px-6">
  <div className="bg-gradient-to-r from-green-900 to-green-700 text-white rounded-3xl shadow-xl p-8">

    <div className="flex flex-col md:flex-row justify-between items-center gap-8">
      
      <div className="max-w-2xl">
        <p className="uppercase tracking-wide text-green-200 mb-2">
          Real Estate & Investment Network
        </p>

        <h3 className="text-4xl font-bold mb-4">
          Local Deals. Rentals. Contractors. Investors.
        </h3>

        <p className="text-lg text-green-100 mb-6">
          Connecting Southeast Texas property owners, contractors,
          investors, landlords, wholesalers, and service professionals.
        </p>

        <div className="flex flex-wrap gap-3">
          <span className="bg-white/20 px-4 py-2 rounded-full">
            🏠 Rentals
          </span>

          <span className="bg-white/20 px-4 py-2 rounded-full">
            🔨 Contractors
          </span>

          <span className="bg-white/20 px-4 py-2 rounded-full">
            💰 Investment Deals
          </span>

          <span className="bg-white/20 px-4 py-2 rounded-full">
            🧰 Local Services
          </span>
        </div>
      </div>

      <div className="bg-white text-gray-900 rounded-2xl p-6 shadow-lg w-full md:w-96">
        <h4 className="text-2xl font-bold mb-4">
          Join Property Network
        </h4>

        <input
          className="w-full border rounded-xl px-4 py-3 mb-4"
          placeholder="Email Address"
        />

        <button className="w-full bg-green-700 text-white py-3 rounded-xl font-bold hover:bg-green-600">
          Request Early Access
        </button>
      </div>

    </div>
  </div>
</section>
{/* Community Support */}
<section className="max-w-6xl mx-auto py-12 px-6">
  <div className="bg-white rounded-3xl shadow-xl p-8">

    <div className="flex flex-col md:flex-row justify-between gap-8 items-center">

      <div className="max-w-3xl">
        <p className="uppercase tracking-wide text-gray-500 mb-2">
          Community Assistance Network
        </p>

        <h3 className="text-4xl font-bold mb-4">
          Helping Local Families & Community Causes
        </h3>

        <p className="text-lg text-gray-600 mb-6">
          Support verified local fundraisers, medical hardships,
          disaster recovery efforts, shelter drives, school programs,
          and emergency community assistance initiatives.
        </p>

        <div className="flex flex-wrap gap-3">
          <span className="bg-red-100 text-red-700 px-4 py-2 rounded-full font-semibold">
            ❤️ Medical Support
          </span>

          <span className="bg-blue-100 text-blue-900 px-4 py-2 rounded-full font-semibold">
            🌀 Disaster Recovery
          </span>

          <span className="bg-green-100 text-green-700 px-4 py-2 rounded-full font-semibold">
            🐶 Shelter Drives
          </span>

          <span className="bg-yellow-100 text-yellow-800 px-4 py-2 rounded-full font-semibold">
            🎓 School Programs
          </span>
        </div>
      </div>

      <div className="bg-gray-100 rounded-2xl p-6 w-full md:w-96">
        <h4 className="text-2xl font-bold mb-4">
          Featured Community Drive
        </h4>

        <p className="text-gray-700 mb-4">
          Southeast Texas Storm Recovery Supply Fund
        </p>

        <div className="w-full bg-gray-300 rounded-full h-4 mb-3">
          <div className="bg-green-600 h-4 rounded-full w-2/3"></div>
        </div>

        <p className="text-sm text-gray-600 mb-5">
          $13,400 raised of $20,000 goal
        </p>

        <button className="w-full bg-red-600 text-white py-3 rounded-xl font-bold hover:bg-red-500">
          Support Local Cause
        </button>
      </div>

    </div>
  </div>
</section>
{/* Community Hub */}
<section className="max-w-6xl mx-auto py-12 px-6">
  <h3 className="text-3xl font-bold mb-8">Community Hub</h3>

  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
    <div className="bg-white rounded-2xl shadow-md p-6">
      <div className="text-5xl mb-4">🌽</div>
      <h4 className="text-xl font-bold mb-2">Farmers Markets</h4>
      <p className="text-gray-600 mb-4">
        Find local produce, ranch goods, crafts, and vendors near you.
      </p>
      <button className="text-blue-900 font-bold">View Markets →</button>
    </div>

    <div className="bg-white rounded-2xl shadow-md p-6">
      <div className="text-5xl mb-4">🎓</div>
      <h4 className="text-xl font-bold mb-2">Skill Center</h4>
      <p className="text-gray-600 mb-4">
        Free community learning for trades, job training, small business, and homeschooling.
      </p>
      <button className="text-blue-900 font-bold">Start Learning →</button>
    </div>

    <div className="bg-white rounded-2xl shadow-md p-6">
      <div className="text-5xl mb-4">🐾</div>
      <h4 className="text-xl font-bold mb-2">Lost & Found Pets</h4>
      <p className="text-gray-600 mb-4">
        Help reconnect local families with missing pets and support nearby shelters.
      </p>
      <a
  href="/pets"
  className="text-blue-900 font-bold"
>
  View Pets →
</a>
    </div>
  </div>
</section>
{/* Why Local Matters */}
<section className="bg-blue-950 text-white py-16 px-6 mt-14">
  <div className="max-w-6xl mx-auto">

    <div className="text-center mb-12">
      <h3 className="text-4xl font-extrabold mb-4">
        Why Local Matters
      </h3>

      <p className="text-blue-200 text-lg max-w-3xl mx-auto">
        Every dollar spent locally helps strengthen Southeast Texas businesses,
        families, jobs, shelters, farms, and communities.
      </p>
    </div>

    <div className="grid grid-cols-1 md:grid-cols-4 gap-8">

      <div className="text-center">
        <div className="text-5xl mb-4">🏪</div>
        <h4 className="text-2xl font-bold mb-2">
          Support Local Business
        </h4>

        <p className="text-blue-200">
          Help small businesses, contractors, and local sellers grow.
        </p>
      </div>

      <div className="text-center">
        <div className="text-5xl mb-4">🇺🇸</div>
        <h4 className="text-2xl font-bold mb-2">
          Buy American
        </h4>

        <p className="text-blue-200">
          Promote Made in USA products and regional manufacturing.
        </p>
      </div>

      <div className="text-center">
        <div className="text-5xl mb-4">🐶</div>
        <h4 className="text-2xl font-bold mb-2">
          Community First
        </h4>

        <p className="text-blue-200">
          Support shelters, events, farms, and local causes.
        </p>
      </div>

      <div className="text-center">
        <div className="text-5xl mb-4">🤝</div>
        <h4 className="text-2xl font-bold mb-2">
          Stronger Together
        </h4>

        <p className="text-blue-200">
          Build a trusted local network for commerce and connection.
        </p>
      </div>

    </div>
  </div>
</section>
{/* Footer */}
<footer className="bg-blue-900 text-white py-10 mt-10">
  <div className="max-w-6xl mx-auto px-6 grid grid-cols-1 md:grid-cols-4 gap-8">
    <div>
      <h4 className="text-2xl font-bold mb-3">409 Marketplace</h4>
      <p className="text-blue-200">
  Support local fundraisers, emergency family needs, medical hardships,
  shelter drives, disaster recovery efforts, and community assistance programs.
</p>
    </div>

    <div>
      <h5 className="font-bold mb-3">Marketplace</h5>
      <p className="text-blue-100">Browse Listings</p>
      <p className="text-blue-100">Post Listing</p>
      <p className="text-blue-100">Import Listing</p>
    </div>

    <div>
      <h5 className="font-bold mb-3">Community</h5>
      <p className="text-blue-100">Pet of the Week</p>
      <p className="text-blue-100">Farmers Markets</p>
      <p className="text-blue-100">Skill Center</p>
    </div>

    <div>
      <h5 className="font-bold mb-3">Local Business</h5>
      <p className="text-blue-100">Business Spotlight</p>
      <p className="text-blue-100">Sponsor a Section</p>
      <p className="text-blue-100">Partner With Us</p>
    </div>
  </div>

  <div className="max-w-6xl mx-auto px-6 mt-8 pt-6 border-t border-blue-700 text-center text-blue-100">
    © 2026 409 Marketplace — Built for Local Communities
  </div>
</footer>

{/* Mobile Bottom Navigation */}
<div className="fixed bottom-0 left-0 right-0 bg-white border-t shadow-2xl md:hidden z-50">
  <div className="grid grid-cols-5 text-center py-3">

    <button className="flex flex-col items-center text-blue-900 font-semibold">
      <span className="text-2xl">🏠</span>
      <span className="text-xs">Home</span>
    </button>

    <button className="flex flex-col items-center text-gray-600">
      <span className="text-2xl">🔍</span>
      <span className="text-xs">Browse</span>
    </button>

    <button className="flex flex-col items-center text-red-600 font-bold">
      <span className="text-3xl">➕</span>
      <span className="text-xs">Post</span>
    </button>

    <a
  href="/pets"
  className="flex flex-col items-center text-gray-600"
>
  <span className="text-2xl">🐶</span>
  <span className="text-xs">Pets</span>
</a>

    <button className="flex flex-col items-center text-gray-600">
      <span className="text-2xl">👤</span>
      <span className="text-xs">Account</span>
    </button>

  </div>
</div>
    </main>
  );
}
