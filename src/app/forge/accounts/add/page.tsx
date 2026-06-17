"use client";

import { useState } from "react";
import Header from "@/components/Header";
import { Button, Card } from "@/components/ui";
import { InstitutionService } from "@/domains/institution";

export default function AddAccountPage() {
  const institutions = InstitutionService.getDefaults();
const [selected, setSelected] = useState<string | null>(null);
const [search, setSearch] = useState("");

const filteredInstitutions = institutions.filter((institution) =>
  institution.name.toLowerCase().includes(search.toLowerCase())
);

  return (
    <main className="min-h-screen bg-gray-100 text-gray-900">
      <Header />

      <section className="max-w-5xl mx-auto py-12 px-6">
        <h1 className="text-4xl font-extrabold mb-3">
          Add Financial Account
        </h1>

        <p className="text-gray-600 text-lg mb-8">
          Choose where this account is held.
        </p>
<input
  value={search}
  onChange={(event) => setSearch(event.target.value)}
  placeholder="Search institutions..."
  className="w-full rounded-xl border border-gray-300 px-4 py-3 mb-6 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
/>


        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          {filteredInstitutions.map((institution) => (
            <Card
  key={institution.name}
  onClick={() => setSelected(institution.name)}
  className={`cursor-pointer transition border-2 ${
    selected === institution.name
      ? "border-blue-600 bg-blue-50"
      : "border-transparent hover:border-gray-300"
  }`}
>
              <h2 className="text-xl font-bold">{institution.name}</h2>
              <p className="text-sm text-gray-500 capitalize">
                {institution.type.replace("_", " ")}
              </p>
            </Card>
          ))}
        </div>

        <Button className={!selected ? "opacity-50 cursor-not-allowed" : ""}>
  Continue
</Button>
      </section>
    </main>
  );
}