import { supabase } from "@/lib/supabase";
import type { Business } from "./business.types";

export class BusinessRepository {
  static async getAll(): Promise<Business[]> {
    const { data, error } = await supabase
      .from("businesses")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      throw error;
    }

    return (data ?? []) as Business[];
  }
}