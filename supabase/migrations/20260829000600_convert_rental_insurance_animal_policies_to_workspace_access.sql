-- Shared FORGE workspace membership -- Checkpoint 3, group 4/5 (insurance/animals/pet-fees/
-- rent-reporting). Same treatment as groups 1-3: owner-management policies converted to
-- has_workspace_access(owner_id); tenant-facing policies (rental_animals_tenant_select,
-- pet_liability_tenant_select, pet_fees_tenant_select, pet_fee_charges_tenant_select,
-- insurance_requirement_tenant_select, insurance_policy_tenant_select,
-- insurance_evidence_tenant_read/insert, insurance_referral_tenant_select,
-- rent_reporting_tenant_select, rent_reporting_fee_tenant_select) untouched.

drop policy "rental_animals_owner_all" on rental_animals;
create policy "rental_animals_owner_all" on rental_animals for all to authenticated
using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

drop policy "pet_liability_owner_all" on pet_liability_policies;
create policy "pet_liability_owner_all" on pet_liability_policies for all to authenticated
using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

drop policy "pet_fees_owner_all" on monthly_pet_fees;
create policy "pet_fees_owner_all" on monthly_pet_fees for all to authenticated
using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

drop policy "pet_fee_charges_owner_all" on monthly_pet_fee_charges;
create policy "pet_fee_charges_owner_all" on monthly_pet_fee_charges for all to authenticated
using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

drop policy "insurance_requirement_owner_all" on renters_insurance_requirements;
create policy "insurance_requirement_owner_all" on renters_insurance_requirements for all to authenticated
using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

drop policy "insurance_policy_owner_all" on renters_insurance_policies;
create policy "insurance_policy_owner_all" on renters_insurance_policies for all to authenticated
using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

drop policy "insurance_evidence_owner_read" on renters_insurance_evidence;
create policy "insurance_evidence_owner_read" on renters_insurance_evidence for select to authenticated
using (has_workspace_access(owner_id));

drop policy "insurance_referral_owner_all" on insurance_referral_links;
create policy "insurance_referral_owner_all" on insurance_referral_links for all to authenticated
using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

drop policy "rent_reporting_owner_all" on rent_reporting_enrollments;
create policy "rent_reporting_owner_all" on rent_reporting_enrollments for all to authenticated
using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

drop policy "rent_reporting_fee_owner_all" on rent_reporting_fees;
create policy "rent_reporting_fee_owner_all" on rent_reporting_fees for all to authenticated
using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));
