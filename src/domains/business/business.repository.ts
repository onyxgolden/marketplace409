import { supabase } from "@/lib/supabase";
import type { Business } from "./business.types";
import { mapBusinessRowToBusiness } from "./business.mapper";

export class BusinessRepository {
  static async getAll(): Promise<Business[]> {
    const { data, error } = await supabase
      .from("businesses")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      throw error;
    }

    return (data ?? []).map(mapBusinessRowToBusiness);
  }
}