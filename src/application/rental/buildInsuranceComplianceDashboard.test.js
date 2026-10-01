import { describe, expect, it } from "vitest";
import { buildInsuranceComplianceDashboard } from "./buildInsuranceComplianceDashboard";

const AS_OF = "2026-10-01";

function lease(id, propertyId = "prop_1", status = "active") {
  return { id, property_id: propertyId, unit_id: `unit_${id}`, status };
}

describe("buildInsuranceComplianceDashboard", () => {
  it("flags a missing policy when insurance is required at the property level", () => {
    const dashboard = buildInsuranceComplianceDashboard(
      {
        leases: [lease("lease_1")],
        policies: [],
        leaseRequirements: [],
        propertyRequirements: [{ property_id: "prop_1", requires_renters_insurance: true, requires_pet_records: false }],
        animals: [],
        depositChoices: [],
      },
      { asOf: AS_OF },
    );
    expect(dashboard.rows).toHaveLength(1);
    expect(dashboard.rows[0].insurance).toBe("missing");
    expect(dashboard.rows[0].flags).toContain("insurance_missing");
    expect(dashboard.summary.insuranceMissing).toBe(1);
  });

  it("lets the per-lease row override the property default (lease requires nothing)", () => {
    const dashboard = buildInsuranceComplianceDashboard(
      {
        leases: [lease("lease_1")],
        policies: [],
        leaseRequirements: [{ lease_id: "lease_1", required: false }],
        propertyRequirements: [{ property_id: "prop_1", requires_renters_insurance: true, requires_pet_records: false }],
        animals: [],
        depositChoices: [],
      },
      { asOf: AS_OF },
    );
    expect(dashboard.rows[0].insurance).toBe("not_required");
    expect(dashboard.rows[0].flags).not.toContain("insurance_missing");
  });

  it("classifies expired, expiring-soon, and valid policies from the expiration date", () => {
    const dashboard = buildInsuranceComplianceDashboard(
      {
        leases: [lease("l_expired"), lease("l_soon"), lease("l_valid")],
        policies: [
          { id: "p1", lease_id: "l_expired", carrier_name: "Acme", status: "verified", expiration_date: "2026-09-15" },
          { id: "p2", lease_id: "l_soon", carrier_name: "Acme", status: "verified", expiration_date: "2026-10-20" },
          { id: "p3", lease_id: "l_valid", carrier_name: "Acme", status: "verified", expiration_date: "2027-09-01" },
        ],
        leaseRequirements: [],
        propertyRequirements: [{ property_id: "prop_1", requires_renters_insurance: true, requires_pet_records: false }],
        animals: [],
        depositChoices: [],
      },
      { asOf: AS_OF },
    );
    const byLease = Object.fromEntries(dashboard.rows.map((row) => [row.leaseId, row]));
    expect(byLease.l_expired.insurance).toBe("expired");
    expect(byLease.l_soon.insurance).toBe("expiring_soon");
    expect(byLease.l_valid.insurance).toBe("valid");
    expect(dashboard.summary.insuranceExpired).toBe(1);
    expect(dashboard.summary.insuranceExpiringSoon).toBe(1);
  });

  describe("verification status is resolved before a policy can count as valid", () => {
    const requiredAt = (leases, policies) =>
      buildInsuranceComplianceDashboard(
        {
          leases,
          policies,
          leaseRequirements: [],
          propertyRequirements: [{ property_id: "prop_1", requires_renters_insurance: true, requires_pet_records: false }],
          animals: [],
          depositChoices: [],
        },
        { asOf: AS_OF },
      );

    it("keeps pending_verification with far-future expiry as pending, not valid", () => {
      const dashboard = requiredAt([lease("l_pending")], [
        { id: "p1", lease_id: "l_pending", carrier_name: "Acme", status: "pending_verification", expiration_date: "2028-01-01" },
      ]);
      expect(dashboard.rows[0].insurance).toBe("pending");
      expect(dashboard.rows[0].flags).not.toContain("insurance_missing");
    });

    it("treats a rejected policy with far-future expiry as missing", () => {
      const dashboard = requiredAt([lease("l_rejected")], [
        { id: "p1", lease_id: "l_rejected", carrier_name: "Acme", status: "rejected", expiration_date: "2028-01-01" },
      ]);
      expect(dashboard.rows[0].insurance).toBe("missing");
      expect(dashboard.rows[0].flags).toContain("insurance_missing");
    });

    it("keeps a verified policy expiring soon as expiring_soon", () => {
      const dashboard = requiredAt([lease("l_soon")], [
        { id: "p1", lease_id: "l_soon", carrier_name: "Acme", status: "verified", expiration_date: "2026-10-20" },
      ]);
      expect(dashboard.rows[0].insurance).toBe("expiring_soon");
      expect(dashboard.rows[0].flags).toContain("insurance_expiring_soon");
    });

    it("keeps a verified but expired policy as expired", () => {
      const dashboard = requiredAt([lease("l_expired")], [
        { id: "p1", lease_id: "l_expired", carrier_name: "Acme", status: "verified", expiration_date: "2026-09-15" },
      ]);
      expect(dashboard.rows[0].insurance).toBe("expired");
      expect(dashboard.rows[0].flags).toContain("insurance_expired");
    });
  });

  describe("governing-policy selection prefers the current verified policy", () => {
    const requiredAt = (leases, policies) =>
      buildInsuranceComplianceDashboard(
        {
          leases,
          policies,
          leaseRequirements: [],
          propertyRequirements: [{ property_id: "prop_1", requires_renters_insurance: true, requires_pet_records: false }],
          animals: [],
          depositChoices: [],
        },
        { asOf: AS_OF },
      );

    it("does not let a later-expiring rejected submission displace verified coverage", () => {
      const dashboard = requiredAt([lease("l1")], [
        { id: "p_verified", lease_id: "l1", carrier_name: "Acme", status: "verified", expiration_date: "2026-11-15" },
        { id: "p_rejected", lease_id: "l1", carrier_name: "Globex", status: "rejected", expiration_date: "2028-01-01" },
      ]);
      expect(dashboard.rows[0].insurance).toBe("valid");
      expect(dashboard.rows[0].latestPolicyCarrier).toBe("Acme");
    });

    it("does not let a later-expiring pending submission displace a verified expiring-soon policy", () => {
      const dashboard = requiredAt([lease("l1")], [
        { id: "p_verified", lease_id: "l1", carrier_name: "Acme", status: "verified", expiration_date: "2026-10-20" },
        { id: "p_pending", lease_id: "l1", carrier_name: "Globex", status: "pending_verification", expiration_date: "2028-01-01" },
      ]);
      expect(dashboard.rows[0].insurance).toBe("expiring_soon");
      expect(dashboard.rows[0].latestPolicyCarrier).toBe("Acme");
    });

    it("falls back to the pending submission once the verified policy has expired", () => {
      const dashboard = requiredAt([lease("l1")], [
        { id: "p_verified", lease_id: "l1", carrier_name: "Acme", status: "verified", expiration_date: "2026-09-01" },
        { id: "p_pending", lease_id: "l1", carrier_name: "Globex", status: "pending_verification", expiration_date: "2027-01-01" },
      ]);
      expect(dashboard.rows[0].insurance).toBe("pending");
      expect(dashboard.rows[0].latestPolicyCarrier).toBe("Globex");
    });

    it("prefers the furthest verified coverage when several verified policies are current", () => {
      const dashboard = requiredAt([lease("l1")], [
        { id: "p_old", lease_id: "l1", carrier_name: "Acme", status: "verified", expiration_date: "2026-11-01" },
        { id: "p_new", lease_id: "l1", carrier_name: "Globex", status: "verified", expiration_date: "2027-06-01" },
      ]);
      expect(dashboard.rows[0].insurance).toBe("valid");
      expect(dashboard.rows[0].latestPolicyCarrier).toBe("Globex");
      expect(dashboard.rows[0].latestPolicyExpires).toBe("2027-06-01");
    });
  });

  it("puts expired and expiring-soon policies on the in-app reminder list (no email)", () => {
    const dashboard = buildInsuranceComplianceDashboard(
      {
        leases: [lease("l_expired"), lease("l_soon"), lease("l_valid")],
        policies: [
          { id: "p1", lease_id: "l_expired", carrier_name: "Acme", status: "verified", expiration_date: "2026-09-15" },
          { id: "p2", lease_id: "l_soon", carrier_name: "Globex", status: "verified", expiration_date: "2026-10-20" },
          { id: "p3", lease_id: "l_valid", carrier_name: "Acme", status: "verified", expiration_date: "2027-09-01" },
        ],
        leaseRequirements: [],
        propertyRequirements: [{ property_id: "prop_1", requires_renters_insurance: true, requires_pet_records: false }],
        animals: [],
        depositChoices: [],
      },
      { asOf: AS_OF },
    );
    const kinds = dashboard.reminders.map((reminder) => reminder.kind);
    expect(kinds).toContain("insurance_expired");
    expect(kinds).toContain("insurance_expiring_soon");
    expect(dashboard.reminders.every((reminder) => typeof reminder.detail === "string")).toBe(true);
  });

  it("flags missing pet records and unrecorded deposit choices", () => {
    const dashboard = buildInsuranceComplianceDashboard(
      {
        leases: [lease("lease_1")],
        policies: [],
        leaseRequirements: [],
        propertyRequirements: [{ property_id: "prop_1", requires_renters_insurance: false, requires_pet_records: true }],
        animals: [],
        depositChoices: [],
      },
      { asOf: AS_OF },
    );
    expect(dashboard.rows[0].petRecords).toBe("missing");
    expect(dashboard.rows[0].flags).toContain("pet_records_missing");
    expect(dashboard.rows[0].depositChoice).toBe("unrecorded");
    expect(dashboard.rows[0].flags).toContain("deposit_choice_unrecorded");
  });

  it("recognizes on-file pet records and recorded deposit choices", () => {
    const dashboard = buildInsuranceComplianceDashboard(
      {
        leases: [lease("lease_1")],
        policies: [],
        leaseRequirements: [],
        propertyRequirements: [{ property_id: "prop_1", requires_renters_insurance: false, requires_pet_records: true }],
        animals: [{ id: "animal_1", lease_id: "lease_1", name: "Biscuit", vaccination_record_on_file: false, vaccination_expires_on: null }],
        depositChoices: [{ lease_id: "lease_1", choice: "deposit_insurance_product", product_reference: "SuretyCo ref 123" }],
      },
      { asOf: AS_OF },
    );
    expect(dashboard.rows[0].petRecords).toBe("on_file");
    expect(dashboard.rows[0].depositChoice).toBe("deposit_insurance_product");
    expect(dashboard.rows[0].depositProductReference).toBe("SuretyCo ref 123");
    expect(dashboard.rows[0].flags).not.toContain("pet_records_missing");
    expect(dashboard.rows[0].flags).not.toContain("deposit_choice_unrecorded");
  });

  it("adds expiring pet vaccinations to the reminder list", () => {
    const dashboard = buildInsuranceComplianceDashboard(
      {
        leases: [lease("lease_1")],
        policies: [],
        leaseRequirements: [],
        propertyRequirements: [],
        animals: [
          { id: "a1", lease_id: "lease_1", name: "Biscuit", vaccination_record_on_file: true, vaccination_expires_on: "2026-10-10" },
          { id: "a2", lease_id: "lease_1", name: "Mittens", vaccination_record_on_file: true, vaccination_expires_on: "2026-09-01" },
        ],
        depositChoices: [],
      },
      { asOf: AS_OF },
    );
    const kinds = dashboard.reminders.map((reminder) => reminder.kind);
    expect(kinds).toContain("pet_vaccination_expiring_soon");
    expect(kinds).toContain("pet_vaccination_expired");
  });

  it("excludes non-active leases and supports the property filter", () => {    const dashboard = buildInsuranceComplianceDashboard(
      {
        leases: [lease("l_active", "prop_1"), lease("l_ended", "prop_1", "ended"), lease("l_other", "prop_2")],
        policies: [],
        leaseRequirements: [],
        propertyRequirements: [],
        animals: [],
        depositChoices: [],
      },
      { asOf: AS_OF, propertyId: "prop_1" },
    );
    expect(dashboard.rows.map((row) => row.leaseId)).toEqual(["l_active"]);
    expect(dashboard.summary.activeLeaseCount).toBe(1);
  });

  it("summarizes lease flag counts", () => {    const dashboard = buildInsuranceComplianceDashboard(
      {
        leases: [lease("l1"), lease("l2")],
        policies: [],
        leaseRequirements: [],
        propertyRequirements: [{ property_id: "prop_1", requires_renters_insurance: true, requires_pet_records: true }],
        animals: [],
        depositChoices: [{ lease_id: "l2", choice: "traditional_security_deposit", product_reference: null }],
      },
      { asOf: AS_OF },
    );
    expect(dashboard.summary.activeLeaseCount).toBe(2);
    expect(dashboard.summary.leasesWithFlags).toBe(2);
    expect(dashboard.summary.depositChoiceUnrecorded).toBe(1);
  });

  it("exposes the pet-record rows with vaccination classification for the dashboard UI", () => {
    const dashboard = buildInsuranceComplianceDashboard(
      {
        leases: [lease("lease_1")],
        policies: [],
        leaseRequirements: [],
        propertyRequirements: [],
        animals: [
          { id: "a1", lease_id: "lease_1", name: "Biscuit", weight_lbs: 62, vaccination_record_on_file: true, vaccination_expires_on: "2026-10-10" },
          { id: "a2", lease_id: "lease_1", name: "Scout", weight_lbs: null, vaccination_record_on_file: false, vaccination_expires_on: null },
        ],
        depositChoices: [],
      },
      { asOf: AS_OF },
    );
    expect(dashboard.pets).toHaveLength(2);
    expect(dashboard.pets[0]).toMatchObject({ animalId: "a1", name: "Biscuit", weightLbs: 62, vaccinationStatus: "expiring_soon" });
    expect(dashboard.pets[1]).toMatchObject({ animalId: "a2", vaccinationStatus: "no_record" });
  });
});
