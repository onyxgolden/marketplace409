export type Business = {
  id: string;
  created_at?: string;

  name: string;
  category?: string | null;
  description?: string | null;

  city?: string | null;
  phone?: string | null;

  website_url?: string | null;
  facebook_url?: string | null;
  image_url?: string | null;

  trust_tags?: string[] | null;
};