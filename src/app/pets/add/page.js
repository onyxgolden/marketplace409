"use client";

import { useState } from "react";
import Header from "@/components/Header";
import { supabase } from "@/lib/supabase";

export default function AddPetPage() {
  const [petName, setPetName] = useState("");
  const [petType, setPetType] = useState("");
  const [postType, setPostType] = useState("");
  const [petOfWeekEligible, setPetOfWeekEligible] = useState(false);
  const [description, setDescription] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [city, setCity] = useState("");
  const [image, setImage] = useState(null);
  const [isPosting, setIsPosting] = useState(false);

  async function handleSubmit() {
    setIsPosting(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      alert("Please create a free account before posting a pet.");
      window.location.href = "/auth";
      return;
    }

    let imageUrl = "";

    if (image) {
      const fileExt = image.name.split(".").pop();
      const fileName = `${Date.now()}-pet.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from("listing-images")
        .upload(fileName, image, {
          contentType: image.type,
          upsert: false,
        });

      if (uploadError) {
        alert("Error uploading pet image");
        console.log(uploadError);
        setIsPosting(false);
        return;
      }

      const { data } = supabase.storage
        .from("listing-images")
        .getPublicUrl(fileName);

      imageUrl = data.publicUrl;
    }

    const { error } = await supabase.from("pets").insert([
      {
        pet_name: petName,
        pet_type: petType,
        post_type: postType,
        description,
        image_url: imageUrl,
        contact_name: contactName,
        contact_phone: contactPhone,
        contact_email: contactEmail,
        city,
        votes: 0,
        pet_of_week_eligible: petOfWeekEligible,
      },
    ]);

    if (error) {
      alert("Error adding pet post");
      console.log(error);
      setIsPosting(false);
    } else {
      alert("Pet post added!");
      window.location.href = "/pets";
    }
  }

  return (
    <main className="min-h-screen bg-gray-100 text-gray-900">
      <Header />

      <section className="max-w-3xl mx-auto py-12 px-6">
        <div className="bg-white rounded-3xl shadow-md p-8">
          <h1 className="text-4xl font-extrabold mb-8">Add Pet Post</h1>

          <div className="space-y-6">
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

  if (e.target.value === "Lost Pet" || e.target.value === "Found Pet") {
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

            {postType !== "Lost Pet" && postType !== "Found Pet" && postType !== "" && (
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

            <input
              type="file"
              accept="image/*"
              onChange={(e) => setImage(e.target.files[0])}
            />

            <button
              onClick={handleSubmit}
              disabled={isPosting}
              className="w-full bg-red-600 text-white py-4 rounded-2xl text-xl font-bold hover:bg-red-500 disabled:bg-gray-400"
            >
              {isPosting ? "Posting..." : "Add Pet Post"}
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}