"use client";

import { useState } from "react";
import Header from "@/components/Header";
import RealEstateWorkspaceNavigation from "@/components/forge/RealEstateWorkspaceNavigation";

export default function RehabEstimatorPage() {
  const [sqft, setSqft] = useState("");
  const [rehabLevel, setRehabLevel] = useState("");

  const sqftNum = Number(sqft) || 0;

  let lowCostPerSf = 0;
  let highCostPerSf = 0;

  switch (rehabLevel) {
    case "Light":
      lowCostPerSf = 15;
      highCostPerSf = 25;
      break;

    case "Medium":
      lowCostPerSf = 25;
      highCostPerSf = 45;
      break;

    case "Heavy":
      lowCostPerSf = 45;
      highCostPerSf = 75;
      break;

    case "Full Gut":
      lowCostPerSf = 75;
      highCostPerSf = 125;
      break;

    default:
      break;
  }

  const lowEstimate = sqftNum * lowCostPerSf;
  const highEstimate = sqftNum * highCostPerSf;

  return (
    <main className="min-h-screen bg-gray-100 text-gray-900">
      <Header />
      <RealEstateWorkspaceNavigation />

      <section className="bg-green-900 text-white py-16 px-6">
        <div className="max-w-5xl mx-auto">
          <h1 className="text-5xl font-extrabold mb-4">🧮 Rehab Estimator</h1>

          <p className="text-xl text-green-100">
            Estimate renovation costs for rentals, flips, and investment
            properties.
          </p>
        </div>
      </section>

      <section className="max-w-4xl mx-auto py-12 px-6">
        <div className="bg-white rounded-3xl shadow-md p-8">
          <div className="space-y-6">
            <div>
              <label className="block font-bold mb-2">Square Feet</label>

              <input
                type="number"
                value={sqft}
                onChange={(e) => setSqft(e.target.value)}
                placeholder="1500"
                className="w-full border rounded-2xl p-4"
              />
            </div>

            <div>
              <label className="block font-bold mb-2">Rehab Level</label>

              <select
                value={rehabLevel}
                onChange={(e) => setRehabLevel(e.target.value)}
                className="w-full border rounded-2xl p-4"
              >
                <option value="">Select Rehab Level</option>
                <option value="Light">Light Rehab</option>
                <option value="Medium">Medium Rehab</option>
                <option value="Heavy">Heavy Rehab</option>
                <option value="Full Gut">Full Gut Rehab</option>
              </select>
            </div>

            {sqftNum > 0 && rehabLevel && (
              <div className="bg-green-50 border border-green-300 rounded-3xl p-8">
                <h2 className="text-3xl font-bold mb-6">
                  Estimated Rehab Cost
                </h2>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <p className="text-gray-600">Low Estimate</p>

                    <p className="text-4xl font-extrabold text-green-700">
                      ${lowEstimate.toLocaleString()}
                    </p>
                  </div>

                  <div>
                    <p className="text-gray-600">High Estimate</p>

                    <p className="text-4xl font-extrabold text-red-700">
                      ${highEstimate.toLocaleString()}
                    </p>
                  </div>
                </div>

                <div className="mt-6 text-gray-700">
                  Cost Range: ${lowCostPerSf}/SF
                  {" - "}${highCostPerSf}/SF
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
