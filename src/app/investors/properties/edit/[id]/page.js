"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Header from "@/components/Header";
import { supabase } from "@/lib/supabase";
import { uploadImage } from "@/lib/uploadImage";

export default function EditInvestorPropertyPage() {
  const params = useParams();
  const router = useRouter();
  const propertyId = params.id;

  const [form, setForm] = useState({
    address: "",
    city: "",
    county: "",
    asking_price: "",
    arv: "",
    rehab_cost: "",
    estimated_rent: "",
    bedrooms: "",
    bathrooms: "",
    sqft: "",
    lot_size: "",
    occupancy: "",
    property_type: "",
    summary: "",
    image_url: "",
  });

  const [newImage, setNewImage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadProperty() {
      const { data, error } = await supabase
        .from("investor_properties")
        .select("*")
        .eq("id", propertyId)
        .single();

      if (error) {
        setError(error.message);
      } else if (data) {
        setForm({
          address: data.address || "",
          city: data.city || "",
          county: data.county || "",
          asking_price: data.asking_price || "",
          arv: data.arv || "",
          rehab_cost: data.rehab_cost || "",
          estimated_rent: data.estimated_rent || "",
          bedrooms: data.bedrooms || "",
          bathrooms: data.bathrooms || "",
          sqft: data.sqft || "",
          lot_size: data.lot_size || "",
          occupancy: data.occupancy || "",
          property_type: data.property_type || "",
          summary: data.summary || "",
          image_url: data.image_url || "",
        });
      }

      setLoading(false);
    }

    if (propertyId) loadProperty();
  }, [propertyId]);

  function updateField(e) {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  async function saveProperty(e) {
    e.preventDefault();
    setSaving(true);
    setError("");

    try {
      const imageUrl = await uploadImage({
        file: newImage,
        currentImageUrl: form.image_url,
        folder: "investor-properties",
        prefix: "investor-property",
        recordId: propertyId,
      });

      const { error } = await supabase
        .from("investor_properties")
        .update({
          ...form,
          image_url: imageUrl,
          asking_price: form.asking_price || null,
          arv: form.arv || null,
          rehab_cost: form.rehab_cost || null,
          estimated_rent: form.estimated_rent || null,
          bedrooms: form.bedrooms || null,
          bathrooms: form.bathrooms || null,
          sqft: form.sqft || null,
        })
        .eq("id", propertyId);

      if (error) {
        setError(error.message);
        setSaving(false);
        return;
      }

      router.push("/investors/properties");
    } catch (err) {
      setError(err.message || "Image upload failed.");
      setSaving(false);
    }
  }

  async function removeProperty() {
    const confirmed = window.confirm(
      "Remove this investment property from the public list?",
    );

    if (!confirmed) return;

    setSaving(true);
    setError("");

    const { error } = await supabase
      .from("investor_properties")
      .delete()
      .eq("id", propertyId);

    setSaving(false);

    if (error) {
      setError(error.message);
      return;
    }

    router.push("/investors/properties");
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-100 text-gray-900">
        <Header />
        <section className="max-w-3xl mx-auto py-12 px-6">
          <p>Loading property...</p>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-100 text-gray-900">
      <Header />

      <section className="max-w-3xl mx-auto py-12 px-6">
        <a
          href="/investors/properties"
          className="inline-block mb-6 text-blue-700 font-bold hover:underline"
        >
          ← Back to Investment Properties
        </a>

        <div className="bg-white rounded-3xl shadow-md p-8">
          <h1 className="text-4xl font-extrabold mb-4">
            Edit Investment Property
          </h1>

          {error && (
            <div className="bg-red-100 text-red-800 p-4 rounded-xl mb-6">
              {error}
            </div>
          )}

          <form onSubmit={saveProperty} className="space-y-5">
            {form.image_url && (
              <div>
                <p className="font-bold mb-2">Current Image</p>
                <img
                  src={form.image_url}
                  alt={form.address}
                  className="h-52 w-full rounded-2xl object-cover border"
                />
              </div>
            )}

            <div>
              <p className="font-bold mb-2">Replace Image</p>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setNewImage(e.target.files?.[0] || null)}
                className="w-full p-4 rounded-2xl border border-gray-300"
              />
              <p className="text-sm text-gray-500 mt-2">
                Leave blank to keep the current image.
              </p>
            </div>

            {[
              ["address", "Property Address"],
              ["city", "City"],
              ["county", "County"],
              ["asking_price", "Asking Price"],
              ["arv", "ARV"],
              ["rehab_cost", "Estimated Rehab Cost"],
              ["estimated_rent", "Estimated Monthly Rent"],
              ["bedrooms", "Bedrooms"],
              ["bathrooms", "Bathrooms"],
              ["sqft", "Square Feet"],
              ["lot_size", "Lot Size"],
              ["image_url", "Image URL"],
            ].map(([name, placeholder]) => (
              <input
                key={name}
                name={name}
                value={form[name]}
                onChange={updateField}
                placeholder={placeholder}
                className="w-full p-4 rounded-2xl border border-gray-300"
              />
            ))}

            <select
              name="occupancy"
              value={form.occupancy}
              onChange={updateField}
              className="w-full p-4 rounded-2xl border border-gray-300"
            >
              <option value="">Occupancy</option>
              <option value="Vacant">Vacant</option>
              <option value="Tenant Occupied">Tenant Occupied</option>
              <option value="Owner Occupied">Owner Occupied</option>
              <option value="Unknown">Unknown</option>
            </select>

            <select
              name="property_type"
              value={form.property_type}
              onChange={updateField}
              className="w-full p-4 rounded-2xl border border-gray-300"
            >
              <option value="">Property Type</option>
              <option value="Rental Property">Rental Property</option>
              <option value="Rehab Opportunity">Rehab Opportunity</option>
              <option value="Wholesale Deal">Wholesale Deal</option>
              <option value="Single Family">Single Family</option>
              <option value="Duplex / Multifamily">Duplex / Multifamily</option>
              <option value="Commercial">Commercial</option>
              <option value="Land">Land</option>
            </select>

            <textarea
              name="summary"
              value={form.summary}
              onChange={updateField}
              placeholder="Deal Summary"
              className="w-full p-4 rounded-2xl border border-gray-300 h-40"
            />

            <div className="flex flex-wrap gap-3">
              <button
                type="submit"
                disabled={saving}
                className="bg-green-700 text-white px-6 py-3 rounded-xl font-bold hover:bg-green-600 disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save Changes"}
              </button>

              <button
                type="button"
                onClick={removeProperty}
                disabled={saving}
                className="bg-red-700 text-white px-6 py-3 rounded-xl font-bold hover:bg-red-600 disabled:opacity-50"
              >
                Delete Property
              </button>
            </div>
          </form>
        </div>
      </section>
    </main>
  );
}
