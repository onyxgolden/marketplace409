import DeletePetButton from "@/components/DeletePetButton";
import Header from "@/components/Header";
import ShareButton from "@/components/ShareButton";
import { supabase } from "@/lib/supabase";
import VotePetButton from "@/components/VotePetButton";

export const dynamic = "force-dynamic";

export default async function PetsPage() {
  const { data: pets, error } = await supabase
    .from("pets")
    .select("*")
    .order("created_at", { ascending: false });

  const eligiblePets = pets?.filter((pet) => pet.pet_of_week_eligible === true) || [];

const petOfTheWeek = eligiblePets.length
  ? [...eligiblePets].sort((a, b) => (b.votes || 0) - (a.votes || 0))[0]
  : null;

  return (
    <main className="min-h-screen bg-gray-100 text-gray-900">
      <Header />

      <section className="max-w-6xl mx-auto py-12 px-6">
        <h1 className="text-5xl font-extrabold mb-4">Pets & Shelters</h1>

        <p className="text-xl text-gray-600 mb-8">
          Adoptable pets, lost and found animals, and local Pet of the Week.
        </p>

        <a
          href="/pets/add"
          className="inline-block bg-red-600 text-white px-6 py-3 rounded-xl font-bold mb-8 hover:bg-red-500"
        >
          Add Pet Post
        </a>

        {petOfTheWeek && (
          <div className="bg-yellow-100 rounded-3xl shadow-md p-6 mb-10">
            <h2 className="text-3xl font-bold mb-4">🏆 Pet of the Week</h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {petOfTheWeek.image_url ? (
                <img
                  src={petOfTheWeek.image_url}
                  alt={petOfTheWeek.pet_name}
                  className="h-72 w-full object-cover rounded-2xl"
                />
              ) : (
                <div className="h-72 bg-gray-300 flex items-center justify-center text-7xl rounded-2xl">
                  🐾
                </div>
              )}

              <div>
                <h3 className="text-3xl font-bold">{petOfTheWeek.pet_name}</h3>
                <p className="text-gray-600 mt-2">{petOfTheWeek.city}</p>
                <p className="mt-4 text-gray-700">{petOfTheWeek.description}</p>
                <p className="mt-4 font-bold">Votes: {petOfTheWeek.votes || 0}</p>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="bg-red-100 text-red-700 p-4 rounded-xl mb-6">
            Could not load pets.
          </div>
        )}

        {!pets || pets.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-md p-8 text-center">
            <h2 className="text-2xl font-bold mb-2">No pet posts yet</h2>
            <p className="text-gray-600">
              Be the first to add an adoptable, lost, found, or favorite pet.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {pets.map((pet) => (
              <div
                key={pet.id}
                className="bg-white rounded-2xl shadow-md overflow-hidden"
              >
                {pet.image_url ? (
                  <img
                    src={pet.image_url}
                    alt={pet.pet_name}
                    className="h-44 w-full object-cover"
                  />
                ) : (
                  <div className="h-44 bg-blue-100 flex items-center justify-center text-6xl">
                    🐾
                  </div>
                )}

                <div className="p-5">
                  <p className="text-sm text-gray-500">{pet.post_type}</p>
                  <h2 className="text-xl font-bold">{pet.pet_name}</h2>
                  <div className="mt-2">
  {pet.post_type === "Lost Pet" && (
    <span className="bg-red-600 text-white px-3 py-1 rounded-full text-sm font-bold">
      LOST
    </span>
  )}

  {pet.post_type === "Found Pet" && (
    <span className="bg-green-600 text-white px-3 py-1 rounded-full text-sm font-bold">
      FOUND
    </span>
  )}

  {pet.post_type === "Adoptable Pet" && (
    <span className="bg-blue-600 text-white px-3 py-1 rounded-full text-sm font-bold">
      ADOPTABLE
    </span>
  )}

  {pet.pet_of_week_eligible && (
    <span className="ml-2 bg-yellow-500 text-black px-3 py-1 rounded-full text-sm font-bold">
      PET OF THE WEEK ENTRY
    </span>
  )}
</div>
                  <p className="text-sm text-gray-500 mt-1">{pet.pet_type}</p>
                  <p className="text-sm text-gray-500 mt-1">{pet.city}</p>

                  <div className="mt-3 text-gray-600 max-h-40 overflow-y-auto pr-2">
                    {pet.description}
                  </div>

                  <p className="mt-3 font-bold">Votes: {pet.votes || 0}</p>
                  <VotePetButton
                   petId={pet.id}
                   currentVotes={pet.votes || 0}
                  />

                  {pet.contact_phone && (
                    <a
                      href={`tel:${pet.contact_phone}`}
                      className="block mt-4 bg-green-700 text-white text-center py-3 rounded-xl font-bold"
                    >
                      Call
                    </a>
                  )}

                  {pet.contact_phone && (
                    <a
                      href={`sms:${pet.contact_phone}`}
                      className="block mt-3 bg-blue-900 text-white text-center py-3 rounded-xl font-bold"
                    >
                      Text
                    </a>
                  )}

                  <ShareButton
                    title={pet.pet_name}
                    url={`https://409marketplace.online/pets`}
                  />
                  <DeletePetButton petId={pet.id} />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}