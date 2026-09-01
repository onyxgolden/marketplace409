"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Header from "@/components/Header";
import { createBusinessApplicationSuite } from "@/infrastructure/composition";

const { businessCreateApplication } = createBusinessApplicationSuite();

const BUSINESS_CATEGORIES = [
  "HVAC Contractors",
  "Contractors",
  "Home Services",
  "Retail",
  "Restaurants & Food",
  "Professional Services",
  "Automotive",
  "Farm & Ranch",
  "Animal Shelter & Rescue",
  "Other Local Business",
];

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

export default function AddBusinessPage() {
  const router = useRouter();
  const [form, setForm] = useState(() =>
    businessCreateApplication.getInitialBusinessCreateForm(),
  );
  const [imageFile, setImageFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const requestedCategory = new URLSearchParams(window.location.search).get(
      "category",
    );

    if (requestedCategory && BUSINESS_CATEGORIES.includes(requestedCategory)) {
      setForm((currentForm) => ({ ...currentForm, category: requestedCategory }));
    }
  }, []);

  function updateField(field, value) {
    setForm((currentForm) => ({ ...currentForm, [field]: value }));
  }

  function toggleTag(tag) {
    setForm((currentForm) => ({
      ...currentForm,
      trustTags: currentForm.trustTags.includes(tag)
        ? currentForm.trustTags.filter((candidate) => candidate !== tag)
        : [...currentForm.trustTags, tag],
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      const result = await businessCreateApplication.createBusiness({
        form,
        imageFile,
      });

      if (!result.ok) {
        setError(result.message);
        return;
      }

      router.push(result.redirectTo);
    } catch (creationError) {
      setError(creationError?.message || "Failed to create business");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-gray-100 text-gray-900">
      <Header />

      <section className="mx-auto max-w-4xl px-6 py-12">
        <div className="overflow-hidden rounded-3xl bg-white shadow-md">
          <div className="bg-blue-950 px-8 py-8 text-white">
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-blue-200">
              409 Marketplace Business Directory
            </p>
            <h1 className="mt-2 text-4xl font-extrabold">Add Local Business</h1>
            <p className="mt-3 max-w-2xl text-blue-100">
              Create a complete local profile so customers can understand the
              services offered and contact the business directly.
            </p>
          </div>

          <form className="space-y-8 p-8" onSubmit={handleSubmit}>
            <section className="space-y-5">
              <div>
                <label className="mb-2 block font-bold" htmlFor="business-name">
                  Business name
                </label>
                <input
                  id="business-name"
                  value={form.name}
                  onChange={(event) => updateField("name", event.target.value)}
                  required
                  className="w-full rounded-2xl border border-gray-300 p-4"
                />
              </div>

              <div className="grid gap-5 md:grid-cols-2">
                <div>
                  <label className="mb-2 block font-bold" htmlFor="business-category">
                    Category
                  </label>
                  <select
                    id="business-category"
                    value={form.category}
                    onChange={(event) => updateField("category", event.target.value)}
                    required
                    className="w-full rounded-2xl border border-gray-300 bg-white p-4"
                  >
                    <option value="">Choose a category</option>
                    {BUSINESS_CATEGORIES.map((category) => (
                      <option key={category} value={category}>{category}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-2 block font-bold" htmlFor="business-city">
                    City or service area
                  </label>
                  <input
                    id="business-city"
                    value={form.city}
                    onChange={(event) => updateField("city", event.target.value)}
                    required
                    placeholder="Bridge City and Southeast Texas"
                    className="w-full rounded-2xl border border-gray-300 p-4"
                  />
                </div>
              </div>

              <div>
                <label className="mb-2 block font-bold" htmlFor="business-description">
                  Business description
                </label>
                <textarea
                  id="business-description"
                  value={form.description}
                  onChange={(event) => updateField("description", event.target.value)}
                  required
                  rows={7}
                  placeholder="Describe the services, specialties, and what customers should know."
                  className="w-full rounded-2xl border border-gray-300 p-4"
                />
              </div>
            </section>

            <section className="border-t border-gray-200 pt-8">
              <h2 className="text-2xl font-extrabold">Contact information</h2>
              <div className="mt-5 grid gap-5 md:grid-cols-2">
                <div>
                  <label className="mb-2 block font-bold" htmlFor="business-phone">Phone</label>
                  <input
                    id="business-phone"
                    type="tel"
                    value={form.phone}
                    onChange={(event) => updateField("phone", event.target.value)}
                    required
                    className="w-full rounded-2xl border border-gray-300 p-4"
                  />
                </div>

                <div>
                  <label className="mb-2 block font-bold" htmlFor="business-website">Website</label>
                  <input
                    id="business-website"
                    type="url"
                    value={form.websiteUrl}
                    onChange={(event) => updateField("websiteUrl", event.target.value)}
                    placeholder="https://example.com"
                    className="w-full rounded-2xl border border-gray-300 p-4"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="mb-2 block font-bold" htmlFor="business-facebook">
                    Facebook page (optional)
                  </label>
                  <input
                    id="business-facebook"
                    type="url"
                    value={form.facebookUrl}
                    onChange={(event) => updateField("facebookUrl", event.target.value)}
                    placeholder="https://facebook.com/..."
                    className="w-full rounded-2xl border border-gray-300 p-4"
                  />
                </div>
              </div>
            </section>

            <section className="border-t border-gray-200 pt-8">
              <h2 className="text-2xl font-extrabold">Photo and trust details</h2>
              <div className="mt-5">
                <label className="mb-2 block font-bold" htmlFor="business-image">
                  Business photo, logo, or card
                </label>
                <input
                  id="business-image"
                  type="file"
                  accept="image/*"
                  onChange={(event) => setImageFile(event.target.files?.[0] || null)}
                  className="w-full rounded-2xl border border-gray-300 p-4"
                />
              </div>

              <fieldset className="mt-6">
                <legend className="font-bold">Trust tags</legend>
                <p className="mt-1 text-sm text-gray-500">
                  Select only details the business has authorized or documented.
                </p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {TRUST_TAGS.map((tag) => (
                    <label key={tag} className="flex items-center gap-3 rounded-xl bg-gray-100 p-3">
                      <input
                        type="checkbox"
                        checked={form.trustTags.includes(tag)}
                        onChange={() => toggleTag(tag)}
                      />
                      <span>{tag}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            </section>

            {error && (
              <div role="alert" className="rounded-2xl bg-red-100 p-4 font-bold text-red-700">
                {error}
              </div>
            )}

            <div className="flex flex-col-reverse gap-3 border-t border-gray-200 pt-8 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => router.push("/businesses")}
                className="rounded-2xl border border-gray-300 px-6 py-4 font-bold"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="rounded-2xl bg-red-600 px-8 py-4 text-lg font-bold text-white hover:bg-red-500 disabled:bg-gray-400"
              >
                {loading ? "Creating business..." : "Create Business"}
              </button>
            </div>
          </form>
        </div>
      </section>
    </main>
  );
}
