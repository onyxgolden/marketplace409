import Header from "@/components/Header";
import ShareButton from "@/components/ShareButton";
import BusinessAdminControls from "@/components/BusinessAdminControls";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function BusinessDetailPage({ params }) {
  const { id } = await params;

  const { data: business, error } = await supabase
    .from("businesses")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !business) {
    return (
      <main className="min-h-screen bg-gray-100 text-gray-900">
        <Header />

        <section className="max-w-4xl mx-auto py-12 px-6">
          <div className="bg-white rounded-3xl shadow-md p-8 text-center">
            <h1 className="text-4xl font-extrabold mb-4">
              Business Not Found
            </h1>

            <p className="text-gray-600 mb-6">
              This business listing may have been removed.
            </p>

            <a
              href="/businesses"
              className="inline-block bg-red-600 text-white px-6 py-3 rounded-xl font-bold hover:bg-red-500"
            >
              Back to Businesses
            </a>
          </div>
        </section>
      </main>
    );
  }

  const businessUrl = `https://409marketplace.online/businesses/${business.id}`;

  return (
    <main className="min-h-screen bg-gray-100 text-gray-900">
      <Header />

      <section className="max-w-5xl mx-auto py-12 px-6">
        <a
          href="/businesses"
          className="inline-block mb-6 text-blue-700 font-bold hover:underline"
        >
          ← Back to Business Directory
        </a>

        <div className="bg-white rounded-3xl shadow-md overflow-hidden">
          {business.image_url ? (
            <img
              src={business.image_url}
              alt={business.name}
              className="h-80 w-full object-cover"
            />
          ) : (
            <div className="h-80 bg-blue-100 flex items-center justify-center text-8xl">
              🏪
            </div>
          )}

          <div className="p-8">
            <p className="text-sm text-gray-500 mb-2">
              {business.city}
              {business.category ? ` • ${business.category}` : ""}
            </p>

            <h1 className="text-5xl font-extrabold mb-6">
              {business.name}
            </h1>

            {business.description && (
              <div className="text-lg text-gray-700 whitespace-pre-wrap mb-8">
                {business.description}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
              {business.phone && (
                <a
                  href={`tel:${business.phone}`}
                  className="bg-green-700 text-white text-center py-4 rounded-2xl font-bold hover:bg-green-600"
                >
                  Call Business
                </a>
              )}

              {business.website_url && (
                <a
                  href={business.website_url}
                  target="_blank"
                  rel="noreferrer"
                  className="bg-blue-900 text-white text-center py-4 rounded-2xl font-bold hover:bg-blue-800"
                >
                  Visit Website
                </a>
              )}

              {business.facebook_url && (
                <a
                  href={business.facebook_url}
                  target="_blank"
                  rel="noreferrer"
                  className="bg-blue-600 text-white text-center py-4 rounded-2xl font-bold hover:bg-blue-500"
                >
                  Facebook Page
                </a>
              )}
            </div>

            <ShareButton
              title={business.name}
              url={businessUrl}
            />

            <div className="mt-6">
              <BusinessAdminControls businessId={business.id} />
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}