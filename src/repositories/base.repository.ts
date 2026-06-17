import { supabase } from "@/lib/supabase";

export abstract class BaseRepository<T> {
  constructor(protected readonly table: string) {}

  protected db() {
    return supabase.from(this.table);
  }

  async getAll() {
    const { data, error } = await this.db()
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;

    return data as T[];
  }

  async getById(id: string) {
    const { data, error } = await this.db()
      .select("*")
      .eq("id", id)
      .single();

    if (error) throw error;

    return data as T;
  }
}