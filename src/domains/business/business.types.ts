import type { Entity } from "@/types/entity";
import type { Address } from "@/types/address";
import type { Contact } from "@/types/contact";

export type BusinessStatus =
  | "unclaimed"
  | "pending_claim"
  | "claimed"
  | "verified";

export type Business = Entity & {
  name: string;

  status?: BusinessStatus | null;
  owner_user_id?: string | null;

  category?: string | null;
  description?: string | null;

  address?: Address;

  contact?: Contact;

  image_url?: string | null;

  trust_tags?: string[] | null;
};
