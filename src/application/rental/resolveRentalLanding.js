export async function resolveRentalLanding(supabaseClient, userId) {
  if (!supabaseClient?.from || typeof userId !== "string" || userId.trim() === "") return "/auth";
  const { data, error } = await supabaseClient.from("rental_tenants").select("id")
    .eq("auth_user_id", userId.trim()).maybeSingle();
  if (error) throw error;
  return data ? "/forge/rental/portal" : null;
}
