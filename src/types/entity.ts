export type EntityStatus = "draft" | "active" | "inactive" | "archived" | "deleted";

export type Entity = {
  id: string;

  created_at?: string;
  updated_at?: string;

  created_by?: string | null;
  updated_by?: string | null;

  owner_id?: string | null;
  organization_id?: string | null;

  status?: EntityStatus | string | null;

  is_deleted?: boolean | null;
  deleted_at?: string | null;
};