"use client";

import { useState } from "react";
import Header from "@/components/Header";
import RealEstateWorkspaceNavigation from "@/components/forge/RealEstateWorkspaceNavigation";
import { createInvestorApplicationSuite } from "@/infrastructure/composition";

const {
  investorPropertyApplication,
} = createInvestorApplicationSuite();

export default function AddInvestorPropertyPage() {
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [county, setCounty] = useState("");
  const [askingPrice, setAskingPrice] = useState("");
  const [arv, setArv] = useState("");
  const [rehabCost, setRehabCost] = useState("");
  const [estimatedRent, setEstimatedRent] = useState("");
  const [bedrooms, setBedrooms] = useState("");
  const [bathrooms, setBathrooms] = useState("");
  const [sqft, setSqft] = useState("");
  const [lotSize, setLotSize] = useState("");
  const [occupancy, setOccupancy] = useState("");
  const [propertyType, setPropertyType] = useState("");
  const [summary, setSummary] = useState("");
  const [image, setImage] = useState(null);
  const [isPosting, setIsPosting] = useState(false);

  async function handleSubmit() {
    setIsPosting(true);

    try {
      const result = await investorPropertyApplication.createProperty({
        form: {
          address,
          city,
          county,
          asking_price: askingPrice,
          arv,
          rehab_cost: rehabCost,
          estimated_rent: estimatedRent,
          bedrooms,
          bathrooms,
          sqft,
          lot_size: lotSize,
          occupancy,
          property_type: propertyType,
          summary,
        },
        image,
      });

      if (!result.ok) {
        alert(result.message);

        if (result.reason === "authentication_required") {
          window.location.href = "/auth";
          return;
        }

        setIsPosting(false);
        return;
      }

      alert(result.message);
      window.location.href = result.redirectTo;
    } catch (error) {
      alert(error?.message || "Error posting investment property");
      console.error(error);
      setIsPosting(false);
    }
  }

  return (
    <main className="min-h-screen bg-gray-100 text-gray-900">
      <Header />

      <RealEstateWorkspaceNavigation />

      <section className="max-w-3xl mx-auto py-12 px-6">
        <div className="bg-white rounded-3xl shadow-md p-8">
          <h1 className="text-4xl font-extrabold mb-4">
            Add Investment Property
          </h1>

          <p className="text-gray-600 mb-8">
            Post a rental, rehab project, wholesale opportunity, or investor
            deal.
          </p>

          <div className="space-y-6">
            <input
              type="text"
              placeholder="Property Address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="w-full p-4 rounded-2xl border border-gray-300"
            />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <input
                type="text"
                placeholder="City"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className="w-full p-4 rounded-2xl border border-gray-300"
              />

              <input
                type="text"
                placeholder="County"
                value={county}
                onChange={(e) => setCounty(e.target.value)}
                className="w-full p-4 rounded-2xl border border-gray-300"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <input
                type="number"
                placeholder="Asking Price"
                value={askingPrice}
                onChange={(e) => setAskingPrice(e.target.value)}
                className="w-full p-4 rounded-2xl border border-gray-300"
              />

              <input
                type="number"
                placeholder="ARV"
                value={arv}
                onChange={(e) => setArv(e.target.value)}
                className="w-full p-4 rounded-2xl border border-gray-300"
              />

              <input
                type="number"
                placeholder="Estimated Rehab Cost"
                value={rehabCost}
                onChange={(e) => setRehabCost(e.target.value)}
                className="w-full p-4 rounded-2xl border border-gray-300"
              />

              <input
                type="number"
                placeholder="Estimated Monthly Rent"
                value={estimatedRent}
                onChange={(e) => setEstimatedRent(e.target.value)}
                className="w-full p-4 rounded-2xl border border-gray-300"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <input
                type="number"
                placeholder="Bedrooms"
                value={bedrooms}
                onChange={(e) => setBedrooms(e.target.value)}
                className="w-full p-4 rounded-2xl border border-gray-300"
              />

              <input
                type="number"
                placeholder="Bathrooms"
                value={bathrooms}
                onChange={(e) => setBathrooms(e.target.value)}
                className="w-full p-4 rounded-2xl border border-gray-300"
              />

              <input
                type="number"
                placeholder="Square Feet"
                value={sqft}
                onChange={(e) => setSqft(e.target.value)}
                className="w-full p-4 rounded-2xl border border-gray-300"
              />
            </div>

            <input
              type="text"
              placeholder="Lot Size"
              value={lotSize}
              onChange={(e) => setLotSize(e.target.value)}
              className="w-full p-4 rounded-2xl border border-gray-300"
            />

            <select
              value={occupancy}
              onChange={(e) => setOccupancy(e.target.value)}
              className="w-full p-4 rounded-2xl border border-gray-300"
            >
              <option value="">Occupancy</option>
              <option value="Vacant">Vacant</option>
              <option value="Tenant Occupied">Tenant Occupied</option>
              <option value="Owner Occupied">Owner Occupied</option>
              <option value="Unknown">Unknown</option>
            </select>

            <select
              value={propertyType}
              onChange={(e) => setPropertyType(e.target.value)}
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
              placeholder="Deal Summary"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              className="w-full p-4 rounded-2xl border border-gray-300 h-40"
            />

            <input
              type="file"
              accept="image/*"
              onChange={(e) => setImage(e.target.files[0])}
            />

            <button
              onClick={handleSubmit}
              disabled={isPosting}
              className="w-full bg-green-700 text-white py-4 rounded-2xl text-xl font-bold hover:bg-green-600 disabled:bg-gray-400"
            >
              {isPosting ? "Posting..." : "Post Investment Property"}
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}
