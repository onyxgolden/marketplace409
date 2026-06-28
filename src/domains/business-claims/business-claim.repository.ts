import { supabase } from "@/lib/supabase";

export class BusinessClaimRepository {
  async createClaim(payload: any) {
    const { data, error } = await supabase
      .from("business_claims")
      .insert([payload])
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async getAllClaims() {
    const { data, error } = await supabase
      .from("business_claims")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;
    return data;
  }

  async approveClaimRecord(claim: any) {
    const { error } = await supabase
      .from("business_claims")
      .update({
        status: "approved",
        claimed_at: new Date().toISOString(),
        claimed_by: claim.claimant_name,
      })
      .eq("id", claim.id);

    if (error) throw error;
  }

  async updateClaimedBusiness(businessId: string, businessUpdate: any) {
    const { error } = await supabase
      .from("businesses")
      .update(businessUpdate)
      .eq("id", businessId);

    if (error) throw error;
  }

  async approveClaim(claim: any, businessUpdate: any) {
    await this.approveClaimRecord(claim);
    await this.updateClaimedBusiness(claim.business_id, businessUpdate);
  }

  async rejectClaim(id: string) {
    const { error } = await supabase
      .from("business_claims")
      .update({ status: "rejected" })
      .eq("id", id);

    if (error) throw error;
  }
}
