"use client";

import { useEffect, useState } from "react";
import Header from "@/components/Header";
import { supabase } from "@/lib/supabase";

export default function EditBusinessPage({ params }) {
  const [businessId, setBusinessId] = useState("");
  const [loading, setLoading] = useState(true);

  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [city, setCity] = useState("");
  const [phone, setPhone] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [facebookUrl, setFacebookUrl] = useState("");
  const [description, setDescription] = useState("");
  const [trustTags, setTrustTags] = useState([]);

  function toggleTag(tag) {
    if (trustTags.includes(tag)) {
      setTrustTags(trustTags.filter((t) => t !== tag));
    } else {
      setTrustTags([...trustTags, tag]);
    }
  }

  useEffect(() => {
    async function start() {
      const resolvedParams = await params;
      setBusinessId(resolvedParams.id);
      loadBusiness(resolvedParams.id);
    }

    start();
  }, [params]);

  async function loadBusiness(id) {
    const { data, error } = await supabase
      .from("businesses")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !data) {
      alert("Business not found.");
      window.location.href = "/businesses";
      return;
    }

    setName(data.name || "");
    setCategory(data.category || "");
    setCity(data.city || "");
    setPhone(data.phone || "");
    setWebsiteUrl(data.website_url || "");
    setFacebookUrl(data.facebook_url || "");
    setDescription(data.description || "");
    setTrustTags(data.trust_tags || []);
    setLoading(false);
  }

  async function handleUpdate() {
    const { error } = await supabase
      .from("businesses")
      .update({
        name,
        category,
        city,
        phone,
        website_url: websiteUrl,
        facebook_url: facebookUrl,
        description,
        trust_tags: trustTags,
      })
      .eq("id", businessId);

    if (error) {
      alert("Error updating business");
      console.log(error);
    } else {
      alert("Business updated!");
      window.location.href = "/businesses";
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-100 text-gray-900">
        <Header />
        <section className="max-w-3xl mx-auto py-12 px-6">
          <div className="bg-white rounded-3xl shadow-md p-8 text-center">
            Loading business...
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
          <h1 className="text-4xl font-extrabold mb-8">Edit Business</h1>

          <div className="space-y-6">
            <input
              type="text"
              placeholder="Business Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full p-4 rounded-2xl border border-gray-300"
            />

            <input
              type="text"
              placeholder="Category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full p-4 rounded-2xl border border-gray-300"
            />

            <div>
              <label className="block font-bold mb-3">Trust Tags</label>

              <div className="grid grid-cols-2 gap-3">
                {[
                  "Made in USA",
                  "Texas Made",
                  "Veteran Owned",
                  "Family Owned",
                  "Local Farm",
                  "Licensed Contractor",
                  "Shelter Partner",
                ].map((tag) => (
                  <label
                    key={tag}
                    className="flex items-center gap-2 bg-gray-100 p-3 rounded-xl"
                  >
                    <input
                      type="checkbox"
                      checked={trustTags.includes(tag)}
                      onChange={() => toggleTag(tag)}
                    />

                    {tag}
                  </label>
                ))}
              </div>
            </div>

            <input
              type="text"
              placeholder="City"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className="w-full p-4 rounded-2xl border border-gray-300"
            />

            <input
              type="text"
              placeholder="Phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full p-4 rounded-2xl border border-gray-300"
            />

            <input
              type="text"
              placeholder="Website URL"
              value={websiteUrl}
              onChange={(e) => setWebsiteUrl(e.target.value)}
              className="w-full p-4 rounded-2xl border border-gray-300"
            />

            <input
              type="text"
              placeholder="Facebook URL"
              value={facebookUrl}
              onChange={(e) => setFacebookUrl(e.target.value)}
              className="w-full p-4 rounded-2xl border border-gray-300"
            />

            <textarea
              placeholder="Business Description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full p-4 rounded-2xl border border-gray-300 h-40"
            />

            <button
              onClick={handleUpdate}
              className="w-full bg-blue-900 text-white py-4 rounded-2xl text-xl font-bold hover:bg-blue-800"
            >
              Save Business Changes
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}
