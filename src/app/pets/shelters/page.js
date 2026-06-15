import Header from "@/components/Header";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function SheltersPage() {
  const { data: shelters, error } = await supabase
    .from("businesses")
    .select("*")
    .eq("category", "Animal Shelter & Rescue")
    .order("created_at", { ascending: false });

  return (
    <main className="min-h-screen bg-gray-100 text-gray-900">
      <Header />

      <section className="bg-orange-500 text-white py-16 px-6">
        <div className="max-w-6xl mx-auto">
          <h1 className="text-5xl font-extrabold mb-4">
            🐾 Shelters & Rescues
          </h1>

          <p className="text-xl text-orange-100">
            Discover local shelters, rescues, adoption partners, and animal
            welfare organizations throughout Southeast Texas.
          </p>
        </div>
      </section>

      <section className="max-w-6xl mx-auto py-12 px-6">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h2 className="text-3xl font-bold">Local Shelter Partners</h2>

            <p className="text-gray-600 mt-2">
              Find shelters and rescue groups helping pets find loving homes.
            </p>
          </div>

          <a
            href="/businesses/add"
            className="bg-red-600 text-white px-6 py-3 rounded-xl font-bold hover:bg-red-500"
          >
            Add Shelter
          </a>
        </div>

        {error && (
          <div className="bg-red-100 text-red-700 p-4 rounded-xl">
            Could not load shelters.
          </div>
        )}

        {!shelters || shelters.length === 0 ? (
          <div className="bg-white rounded-3xl shadow-md p-10 text-center">
            <div className="text-6xl mb-4">🐶</div>

            <h3 className="text-2xl font-bold mb-3">No shelters listed yet</h3>

            <p className="text-gray-600 mb-6">
              Be the first shelter or rescue organization to join 409
              Marketplace.
            </p>

            <a
              href="/businesses/add"
              className="inline-block bg-orange-500 text-white px-6 py-3 rounded-xl font-bold hover:bg-orange-400"
            >
              Add Shelter
            </a>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {shelters.map((shelter) => (
              <div
                key={shelter.id}
                className="bg-white rounded-3xl shadow-md overflow-hidden"
              >
                {shelter.image_url ? (
                  <img
                    src={shelter.image_url}
                    alt={shelter.name}
                    className="h-48 w-full object-cover"
                  />
                ) : (
                  <div className="h-48 bg-orange-100 flex items-center justify-center text-7xl">
                    🐾
                  </div>
                )}

                <div className="p-6">
                  <p className="text-sm text-gray-500">{shelter.city}</p>

                  <h3 className="text-2xl font-bold mt-1">{shelter.name}</h3>

                  <div className="mt-3 text-gray-600">
                    {shelter.description}
                  </div>

                  <a
                    href={`/businesses/${shelter.id}`}
                    className="block mt-4 bg-orange-500 text-white text-center py-3 rounded-xl font-bold hover:bg-orange-400"
                  >
                    View Shelter
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
