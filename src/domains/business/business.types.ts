import type { Entity } from "@/types/entity";
import type { Address } from "@/types/address";
import type { Contact } from "@/types/contact";

export type Business = Entity & {
  name: string;

  category?: string | null;
  description?: string | null;

  address?: Address;

  contact?: Contact;

  image_url?: string | null;

  trust_tags?: string[] | null;
};