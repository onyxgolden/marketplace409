import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { buildInsuranceComplianceDashboard } from "@/application/rental/buildInsuranceComplianceDashboard";

// R24 — insurance + pets compliance dashboard.
// GET /api/rental/insurance/dashboard?propertyId=<optional>
// Read-only members may read (it is a report, not a write).
//
// Per active lease the dashboard resolves the effective insurance
// requirement (per-lease renters_insurance_requirements row overrides the
// per-property default), flags missing/expired/expiring-soon renters
// insurance, missing pet records, and unrecorded deposit choices, and returns
// the in-app expiry-reminder list (<=30 days). No emails are sent —
// reminders are in-app only.

const LEASE_COLUMNS = "id,property_id,unit_id,status";
const POLICY_COLUMNS = "id,lease_id,carrier_name,status,expiration_date";
const LEASE_REQUIREMENT_COLUMNS = "lease_id,required";
const PROPERTY_REQUIREMENT_COLUMNS = "property_id,requires_renters_insurance,requires_pet_records";
const ANIMAL_COLUMNS = "id,lease_id,name,weight_lbs,vaccination_record_on_file,vaccination_expires_on";
const DEPOSIT_CHOICE_COLUMNS = "lease_id,choice,product_reference";

export async function GET(request) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const { supabaseClient, effectiveOwnerId } = authenticated;

    const url = new URL(request.url);
    const propertyId = String(url.searchParams.get("propertyId") || "").trim();

    const scoped = (table, columns) => supabaseClient.from(table).select(columns).eq("owner_id", effectiveOwnerId);
    const [leases, policies, leaseRequirements, propertyRequirements, animals, depositChoices] = await Promise.all([
      scoped("rental_leases", LEASE_COLUMNS).eq("status", "active"),
      scoped("renters_insurance_policies", POLICY_COLUMNS),
      scoped("renters_insurance_requirements", LEASE_REQUIREMENT_COLUMNS),
      scoped("rental_property_insurance_requirements", PROPERTY_REQUIREMENT_COLUMNS),
      scoped("rental_animals", ANIMAL_COLUMNS),
      scoped("rental_lease_deposit_choices", DEPOSIT_CHOICE_COLUMNS),
    ]);
    for (const result of [leases, policies, leaseRequirements, propertyRequirements, animals, depositChoices]) {
      if (result.error) throw result.error;
    }

    const dashboard = buildInsuranceComplianceDashboard(
      {
        leases: leases.data || [],
        policies: policies.data || [],
        leaseRequirements: leaseRequirements.data || [],
        propertyRequirements: propertyRequirements.data || [],
        animals: animals.data || [],
        depositChoices: depositChoices.data || [],
      },
      { propertyId },
    );
    return NextResponse.json({ dashboard });
  } catch (error) {
    console.error("Insurance compliance dashboard error", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load the insurance compliance dashboard." },
      { status: 500 },
    );
  }
}
