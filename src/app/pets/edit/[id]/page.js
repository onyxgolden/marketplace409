"use client";

import { useEffect, useState } from "react";
import Header from "@/components/Header";
import { supabase } from "@/lib/supabase";
import { uploadImage } from "@/lib/uploadImage";

export default function EditPetPage({ params }) {
  const [petId, setPetId] = useState("");
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const [petName, setPetName] = useState("");
  const [petType, setPetType] = useState("");
  const [postType, setPostType] = useState("");
  const [petOfWeekEligible, setPetOfWeekEligible] = useState(false);
  const [description, setDescription] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [city, setCity] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [newImageFile, setNewImageFile] = useState(null);

  useEffect(() => {
    async function start() {
      const resolvedParams = await params;
      setPetId(resolvedParams.id);
      loadPet(resolvedParams.id);
    }

    start();
  }, [params]);

  async function loadPet(id) {
    const { data, error } = await supabase
      .from("pets")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !data) {
      alert("Pet post not found.");
      window.location.href = "/pets";
      return;
    }

    setPetName(data.pet_name || "");
    setPetType(data.pet_type || "");
    setPostType(data.post_type || "");
    setPetOfWeekEligible(data.pet_of_week_eligible || false);
    setDescription(data.description || "");
    setContactName(data.contact_name || "");
    setContactPhone(data.contact_phone || "");
    setContactEmail(data.contact_email || "");
    setCity(data.city || "");
    setImageUrl(data.image_url || "");
    setLoading(false);
  }

  async function handleUpdate() {
    setIsSaving(true);

    const finalImageUrl = await uploadImage({
      file: newImageFile,
      currentImageUrl: imageUrl,
      folder: "pets",
      prefix: "pet",
      recordId: petId,
    });

    const { error } = await supabase
      .from("pets")
      .update({
        pet_name: petName,
        pet_type: petType,
        post_type: postType,
        pet_of_week_eligible: petOfWeekEligible,
        description,
        contact_name: contactName,
        contact_phone: contactPhone,
        contact_email: contactEmail,
        city,
        image_url: finalImageUrl,
      })
      .eq("id", petId);

    if (error) {
      alert("Error updating pet post.");
      console.log(error);
      setIsSaving(false);
      return;
    }

    alert("Pet post updated.");
    window.location.href = "/pets";
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-100 text-gray-900">
        <Header />
        <section className="max-w-3xl mx-auto py-12 px-6">
          <div className="bg-white rounded-3xl shadow-md p-8 text-center">
            Loading pet post...
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-100 text-gray-900">
      <Header />

      <section className="max-w-3xl mx-auto py-12 px-6">
        <div className="bg-white rounded-3xl shadow-md p-8">
          <h1 className="text-4xl font-extrabold mb-8">Edit Pet Post</h1>

          <div className="space-y-6">
            {imageUrl && (
              <div>
                <label className="block font-bold mb-3">Current Image</label>
                <img
                  src={imageUrl}
                  alt={petName}
                  className="w-full max-h-80 object-cover rounded-2xl border"
                />
              </div>
            )}

            <div>
              <label className="block font-bold mb-3">Replace Image</label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setNewImageFile(e.target.files[0])}
                className="w-full p-4 rounded-2xl border border-gray-300"
              />
              <p className="text-sm text-gray-500 mt-2">
                Leave this blank to keep the current image.
              </p>
            </div>

            <input
              type="text"
              placeholder="Pet Name"
              value={petName}
              onChange={(e) => setPetName(e.target.value)}
              className="w-full p-4 rounded-2xl border border-gray-300"
            />

            <select
              value={postType}
              onChange={(e) => {
                setPostType(e.target.value);

                if (
                  e.target.value === "Lost Pet" ||
                  e.target.value === "Found Pet"
                ) {
                  setPetOfWeekEligible(false);
                }
              }}
              className="w-full p-4 rounded-2xl border border-gray-300"
            >
              <option value="">Select Post Type</option>
              <option value="Adoptable Pet">Adoptable Pet</option>
              <option value="Lost Pet">Lost Pet</option>
              <option value="Found Pet">Found Pet</option>
              <option value="Personal Pet">Personal Pet</option>
            </select>

            {postType !== "Lost Pet" &&
              postType !== "Found Pet" &&
              postType !== "" && (
                <label className="flex items-center gap-3 text-lg font-bold">
                  <input
                    type="checkbox"
                    checked={petOfWeekEligible}
                    onChange={(e) => setPetOfWeekEligible(e.target.checked)}
                    className="w-5 h-5"
                  />
                  Enter this pet for Pet of the Week
                </label>
              )}

            <select
              value={petType}
              onChange={(e) => setPetType(e.target.value)}
              className="w-full p-4 rounded-2xl border border-gray-300"
            >
              <option value="">Select Pet Type</option>
              <option value="Dog">Dog</option>
              <option value="Cat">Cat</option>
              <option value="Bird">Bird</option>
              <option value="Horse">Horse</option>
              <option value="Livestock">Livestock</option>
              <option value="Other">Other</option>
            </select>

            <textarea
              placeholder="Description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full p-4 rounded-2xl border border-gray-300 h-40"
            />

            <input
              type="text"
              placeholder="Contact Name"
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              className="w-full p-4 rounded-2xl border border-gray-300"
            />

            <input
              type="text"
              placeholder="Contact Phone"
              value={contactPhone}
              onChange={(e) => setContactPhone(e.target.value)}
              className="w-full p-4 rounded-2xl border border-gray-300"
            />

            <input
              type="email"
              placeholder="Contact Email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              className="w-full p-4 rounded-2xl border border-gray-300"
            />

            <input
              type="text"
              placeholder="City"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className="w-full p-4 rounded-2xl border border-gray-300"
            />

            <button
              onClick={handleUpdate}
              disabled={isSaving}
              className="w-full bg-red-600 text-white py-4 rounded-2xl text-xl font-bold hover:bg-red-500 disabled:bg-gray-400"
            >
              {isSaving ? "Saving..." : "Save Pet Changes"}
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}
