import type {
  InstitutionReference,
  InstitutionReferenceType,
} from "./institution-reference.types";

export type InstitutionReferenceRow = Readonly<{
  id: string;
  owner_id: string;
  connection_id: string;
  name: string;
  type: InstitutionReferenceType;
  provider: string;
  external_institution_id: string | null;
  website_url: string | null;
  logo_url: string | null;
  created_at: string;
  updated_at: string;
}>;

export function mapInstitutionReferenceRowToInstitutionReference(
  row: InstitutionReferenceRow,
): InstitutionReference {
  return {
    id: row.id,
    connectionId: row.connection_id,
    name: row.name,
    type: row.type,
    provider: row.provider,
    ...(row.external_institution_id
      ? {
          externalInstitutionId:
            row.external_institution_id,
        }
      : {}),
    ...(row.website_url
      ? {
          websiteUrl: row.website_url,
        }
      : {}),
    ...(row.logo_url
      ? {
          logoUrl: row.logo_url,
        }
      : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
