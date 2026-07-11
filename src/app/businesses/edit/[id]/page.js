"use client";

import { useEffect, useState } from "react";
import Header from "@/components/Header";
import {
  createBusinessApplicationSuite,
} from "@/infrastructure/composition";

const {
  businessEditApplication,
} = createBusinessApplicationSuite();

const TRUST_TAGS = [
  "Community Listing",
  "Texas Made",
  "Veteran Owned",
  "Family Owned",
  "Local Farm",
  "Licensed Contractor",
  "Shelter Partner",
  "Non Profit",
];

export default function EditBusinessPage({ params }) {
  const [businessId, setBusinessId] = useState("");
  const [form, setForm] = useState(() =>
    businessEditApplication.getInitialBusinessEditForm(),
  );
  const [newImageFile, setNewImageFile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  function updateField(field, value) {
    setForm((currentForm) => ({
      ...currentForm,
      [field]: value,
    }));
  }

  function toggleTag(tag) {
    setForm((currentForm) => ({
      ...currentForm,
      trustTags: currentForm.trustTags.includes(tag)
        ? currentForm.trustTags.filter((candidate) => candidate !== tag)
        : [...currentForm.trustTags, tag],
    }));
  }

  useEffect(() => {
    async function start() {
      const resolvedParams = await params;
      const resolvedBusinessId = resolvedParams.id;

      setBusinessId(resolvedBusinessId);

      const result =
        await businessEditApplication.loadBusiness(resolvedBusinessId);

      if (!result.ok) {
        alert(result.message);
        window.location.href = result.redirectTo;
        return;
      }

      setForm(result.form);
      setLoading(false);
    }

    start();
  }, [params]);

  async function handleUpdate() {
    setSaving(true);

    const result = await businessEditApplication.updateBusiness({
      businessId,
      form,
      newImageFile,
    });

    setSaving(false);

    if (!result.ok) {
      alert(result.message);
      console.log(result.error);
      return;
    }

    alert(result.message);
    window.location.href = result.redirectTo;
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
            {form.imageUrl && (
              <div>
                <label className="block font-bold mb-3">Current Image</label>
                <img
                  src={form.imageUrl}
                  alt={form.name}
                  className="w-full max-h-80 object-cover rounded-2xl border"
                />
              </div>
            )}

            <div>
              <label className="block font-bold mb-3">Replace Image</label>
              <input
                type="file"
                accept="image/*"
                onChange={(event) =>
                  setNewImageFile(event.target.files?.[0] || null)
                }
                className="w-full p-4 rounded-2xl border border-gray-300"
              />
              <p className="text-sm text-gray-500 mt-2">
                Leave this blank to keep the current image.
              </p>
            </div>

            <input
              type="text"
              placeholder="Business Name"
              value={form.name}
              onChange={(event) => updateField("name", event.target.value)}
              className="w-full p-4 rounded-2xl border border-gray-300"
            />

            <input
              type="text"
              placeholder="Category"
              value={form.category}
              onChange={(event) => updateField("category", event.target.value)}
              className="w-full p-4 rounded-2xl border border-gray-300"
            />

            <div>
              <label className="block font-bold mb-3">Trust Tags</label>

              <div className="grid grid-cols-2 gap-3">
                {TRUST_TAGS.map((tag) => (
                  <label
                    key={tag}
                    className="flex items-center gap-2 bg-gray-100 p-3 rounded-xl"
                  >
                    <input
                      type="checkbox"
                      checked={form.trustTags.includes(tag)}
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
              value={form.city}
              onChange={(event) => updateField("city", event.target.value)}
              className="w-full p-4 rounded-2xl border border-gray-300"
            />

            <input
              type="text"
              placeholder="Phone"
              value={form.phone}
              onChange={(event) => updateField("phone", event.target.value)}
              className="w-full p-4 rounded-2xl border border-gray-300"
            />

            <input
              type="text"
              placeholder="Website URL"
              value={form.websiteUrl}
              onChange={(event) =>
                updateField("websiteUrl", event.target.value)
              }
              className="w-full p-4 rounded-2xl border border-gray-300"
            />

            <input
              type="text"
              placeholder="Facebook URL"
              value={form.facebookUrl}
              onChange={(event) =>
                updateField("facebookUrl", event.target.value)
              }
              className="w-full p-4 rounded-2xl border border-gray-300"
            />

            <textarea
              placeholder="Business Description"
              value={form.description}
              onChange={(event) =>
                updateField("description", event.target.value)
              }
              className="w-full p-4 rounded-2xl border border-gray-300 h-40"
            />

            <button
              onClick={handleUpdate}
              disabled={saving}
              className="w-full bg-blue-900 text-white py-4 rounded-2xl text-xl font-bold hover:bg-blue-800 disabled:bg-gray-400"
            >
              {saving ? "Saving..." : "Save Business Changes"}
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}
