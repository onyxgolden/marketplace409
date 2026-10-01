// R24 — insurance + pets compliance dashboard builder (pure function).
//
// Inputs are plain row arrays from the rental tables; the function resolves,
// per active lease, the effective insurance requirement (lease-level row
// overrides the property default), flags missing items, and produces the
// in-app expiry-reminder list for renters-insurance policies expiring within
// 30 days. No emails — reminders are in-app only.
//
// Lease flags:
//   - insurance: "not_required" | "missing" | "expired" | "expiring_soon" | "pending" | "valid"
//     (missing = required and no acceptable policy on file — none submitted or the
//     latest governing policy was rejected; pending = a policy is on file but has
//     not been verified; expired/expiring_soon/valid come from the governing
//     policy. Only a verified, unexpired policy ever counts as "valid".)
//   - petRecords: "not_required" | "missing" | "on_file"
//   - depositChoice: "traditional_security_deposit" | "deposit_insurance_product" | "unrecorded"
//
// Governing-policy selection: the lease's policies are NOT ranked by greatest
// expiration_date alone. A later-expiring rejected/pending submission must not
// displace a currently verified policy, so verified-and-unexpired policies rank
// first (furthest coverage wins among them); everything else keeps expiry order.

export const INSURANCE_EXPIRY_REMINDER_DAYS = 30;

const dateOnly = (value) => String(value ?? "").slice(0, 10);

function reminderCutoff(asOf) {
  const cutoff = new Date(`${asOf}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() + INSURANCE_EXPIRY_REMINDER_DAYS);
  return cutoff.toISOString().slice(0, 10);
}

export function buildInsuranceComplianceDashboard(
  {
    leases = [],
    policies = [],
    leaseRequirements = [],
    propertyRequirements = [],
    animals = [],
    depositChoices = [],
    tenants = [],
  } = {},
  { asOf = new Date().toISOString().slice(0, 10), propertyId = "" } = {},
) {
  const tenantById = new Map(tenants.map((tenant) => [tenant.id, tenant]));
  const cutoff = reminderCutoff(asOf);

  const policiesByLease = new Map();
  for (const policy of policies) {
    const list = policiesByLease.get(policy.lease_id) || [];
    list.push(policy);
    policiesByLease.set(policy.lease_id, list);
  }
  // Governing-policy selection (R24 review fix): explicitly prefer the current
  // verified policy. Verified-and-unexpired policies rank first (furthest
  // coverage wins among them); a later-expiring rejected or pending submission
  // must never displace verified coverage. Remaining rows keep expiry order
  // with a stable id tiebreak.
  const policyRank = (policy) =>
    policy.status === "verified" && dateOnly(policy.expiration_date) >= asOf ? 0 : 1;
  for (const list of policiesByLease.values()) {
    list.sort((a, b) => {
      const rank = policyRank(a) - policyRank(b);
      if (rank !== 0) return rank;
      if (a.expiration_date !== b.expiration_date) return a.expiration_date < b.expiration_date ? 1 : -1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
  }

  const leaseReqByLease = new Map(leaseRequirements.map((row) => [row.lease_id, row]));
  const propertyReqByProperty = new Map(propertyRequirements.map((row) => [row.property_id, row]));
  const animalsByLease = new Map();
  for (const animal of animals) {
    const list = animalsByLease.get(animal.lease_id) || [];
    list.push(animal);
    animalsByLease.set(animal.lease_id, list);
  }
  const depositChoiceByLease = new Map(depositChoices.map((row) => [row.lease_id, row]));

  const activeLeases = leases.filter((lease) => lease.status === "active" && (!propertyId || lease.property_id === propertyId));

  const rows = activeLeases.map((lease) => {
    const leaseRequirement = leaseReqByLease.get(lease.id);
    const propertyRequirement = propertyReqByProperty.get(lease.property_id);
    const insuranceRequired = leaseRequirement
      ? Boolean(leaseRequirement.required)
      : Boolean(propertyRequirement?.requires_renters_insurance);
    const petRecordsRequired = Boolean(propertyRequirement?.requires_pet_records);

    const leasePolicies = policiesByLease.get(lease.id) || [];
    const latestPolicy = leasePolicies[0] || null;
    let insurance;
    if (!insuranceRequired) {
      insurance = "not_required";
    } else if (!latestPolicy) {
      insurance = "missing";
    } else if (latestPolicy.status === "verified") {
      // Only a verified policy can satisfy the requirement. Resolve the
      // verification status BEFORE the expiry check: a policy awaiting
      // verification is "pending" (never "valid"), and a rejected policy leaves
      // the lease with no acceptable policy on file ("missing").
      const expires = dateOnly(latestPolicy.expiration_date);
      if (expires < asOf) insurance = "expired";
      else if (expires <= cutoff) insurance = "expiring_soon";
      else insurance = "valid";
    } else {
      insurance = latestPolicy.status === "rejected" ? "missing" : "pending";
    }

    const leaseAnimals = animalsByLease.get(lease.id) || [];
    const petRecords = !petRecordsRequired ? "not_required" : leaseAnimals.length > 0 ? "on_file" : "missing";

    const depositChoiceRow = depositChoiceByLease.get(lease.id) || null;
    const depositChoice = depositChoiceRow ? depositChoiceRow.choice : "unrecorded";

    const flags = [];
    if (insurance === "missing") flags.push("insurance_missing");
    if (insurance === "expired") flags.push("insurance_expired");
    if (insurance === "expiring_soon") flags.push("insurance_expiring_soon");
    if (petRecords === "missing") flags.push("pet_records_missing");
    if (depositChoice === "unrecorded") flags.push("deposit_choice_unrecorded");

    return Object.freeze({
      leaseId: lease.id,
      propertyId: lease.property_id,
      unitId: lease.unit_id,
      insurance,
      petRecords,
      depositChoice,
      depositProductReference: depositChoiceRow?.product_reference || null,
      petCount: leaseAnimals.length,
      latestPolicyCarrier: latestPolicy?.carrier_name || null,
      latestPolicyExpires: latestPolicy ? dateOnly(latestPolicy.expiration_date) : null,
      flags: Object.freeze(flags),
    });
  });

  // In-app reminders: expiring (<=30 days) and already-expired policies on
  // required leases, plus expiring pet vaccination records. Sorted most urgent
  // first. In-app only — no email is sent.
  const reminders = [];
  for (const row of rows) {
    if (row.latestPolicyExpires && (row.insurance === "expired" || row.insurance === "expiring_soon")) {
      reminders.push(
        Object.freeze({
          kind: row.insurance === "expired" ? "insurance_expired" : "insurance_expiring_soon",
          leaseId: row.leaseId,
          propertyId: row.propertyId,
          detail: `Renters insurance ${row.latestPolicyCarrier || "policy"} ${row.insurance === "expired" ? "expired" : "expires"} ${row.latestPolicyExpires}`,
        }),
      );
    }
  }
  for (const lease of activeLeases) {
    for (const animal of animalsByLease.get(lease.id) || []) {
      const expires = dateOnly(animal.vaccination_expires_on);
      if (!animal.vaccination_record_on_file || !expires) continue;
      if (expires < asOf || expires <= cutoff) {
        reminders.push(
          Object.freeze({
            kind: expires < asOf ? "pet_vaccination_expired" : "pet_vaccination_expiring_soon",
            leaseId: lease.id,
            propertyId: lease.property_id,
            detail: `Pet "${animal.name || animal.id}" vaccination ${expires < asOf ? "expired" : "expires"} ${expires}`,
          }),
        );
      }
    }
  }

  const tenantNames = (leaseId) =>
    (tenantById.size ? [...tenantById.values()].filter((t) => t.lease_id === leaseId) : []).map(
      (t) => t.display_name || t.id,
    );

  // Lightweight pet-record rows for the pets section of the dashboard UI.
  const pets = [];
  for (const lease of activeLeases) {
    for (const animal of animalsByLease.get(lease.id) || []) {
      const expires = dateOnly(animal.vaccination_expires_on);
      let vaccinationStatus = "no_record";
      if (animal.vaccination_record_on_file && expires) {
        vaccinationStatus = expires < asOf ? "expired" : expires <= cutoff ? "expiring_soon" : "current";
      }
      pets.push(
        Object.freeze({
          animalId: animal.id,
          leaseId: lease.id,
          propertyId: lease.property_id,
          name: animal.name || animal.id,
          weightLbs: animal.weight_lbs ?? null,
          vaccinationRecordOnFile: Boolean(animal.vaccination_record_on_file),
          vaccinationExpiresOn: expires || null,
          vaccinationStatus,
        }),
      );
    }
  }

  return Object.freeze({
    generatedAt: new Date().toISOString(),
    asOf,
    propertyId: propertyId || null,
    summary: Object.freeze({
      activeLeaseCount: rows.length,
      leasesWithFlags: rows.filter((row) => row.flags.length > 0).length,
      insuranceMissing: rows.filter((row) => row.flags.includes("insurance_missing")).length,
      insuranceExpired: rows.filter((row) => row.flags.includes("insurance_expired")).length,
      insuranceExpiringSoon: rows.filter((row) => row.flags.includes("insurance_expiring_soon")).length,
      petRecordsMissing: rows.filter((row) => row.flags.includes("pet_records_missing")).length,
      depositChoiceUnrecorded: rows.filter((row) => row.flags.includes("deposit_choice_unrecorded")).length,
    }),
    rows: Object.freeze(rows.map((row) => Object.freeze({ ...row, tenantNames: Object.freeze(tenantNames(row.leaseId)) }))),
    reminders: Object.freeze(reminders),
    pets: Object.freeze(pets),
  });
}
