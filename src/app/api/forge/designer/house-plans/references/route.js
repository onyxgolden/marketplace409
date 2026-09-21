import { NextResponse } from "next/server";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { isHousePlansEnabled } from "@/lib/housePlans/housePlansFlags";

// HOUSE PLANS (HP-L2) — read-only reference browser API.
//
// Link-only scope: this route exposes FACTUAL METADATA ONLY about
// regulatory sources (titles, section identifiers, issuing
// authority/jurisdiction, edition/effective dates, official URLs, topic
// tags, provenance, retrieval/verification dates, jurisdiction state).
// The table has no summary/content/explanation columns and this route
// selects none — FORGE never authors or reproduces explanatory text about
// regulatory requirements here.

// Factual metadata columns only. Deliberately absent: any summary,
// content, description, explanation, paraphrase, or interpretation column.
const REFERENCE_COLUMNS = [
  "id",
  "title",
  "section_identifier",
  "issuing_authority",
  "jurisdiction",
  "edition",
  "effective_date",
  "official_url",
  "topic_tags",
  "provenance",
  "retrieval_date",
  "verification_date",
  "jurisdiction_state",
].join(",");

function ownerIdOf(authenticated) {
  return authenticated.effectiveOwnerId || authenticated.user.id;
}

function toReference(row) {
  return {
    id: row.id,
    title: row.title,
    sectionIdentifier: row.section_identifier,
    issuingAuthority: row.issuing_authority,
    jurisdiction: row.jurisdiction,
    edition: row.edition,
    effectiveDate: row.effective_date,
    officialUrl: row.official_url,
    topicTags: row.topic_tags || [],
    provenance: row.provenance,
    retrievalDate: row.retrieval_date,
    verificationDate: row.verification_date,
    jurisdictionState: row.jurisdiction_state,
  };
}

// GET /api/forge/designer/house-plans/references — list the caller's
// regulatory reference library entries (newest first). Read-only.
export async function GET() {
  try {
    if (!isHousePlansEnabled()) {
      return NextResponse.json(
        { error: "House Plans is not enabled." },
        { status: 404 }
      );
    }
    const authenticated = await createAuthenticatedForgeApplication();
    if (authenticated.response) return authenticated.response;
    const { data, error } = await authenticated.supabaseClient
      .from("house_plans_regulatory_sources")
      .select(REFERENCE_COLUMNS)
      .eq("owner_id", ownerIdOf(authenticated))
      .order("created_at", { ascending: false });
    if (error) throw error;
    return NextResponse.json({
      success: true,
      references: (data || []).map(toReference),
    });
  } catch (error) {
    console.error("House Plans references list error", error);
    return NextResponse.json(
      { error: "Unable to load the reference library." },
      { status: 500 }
    );
  }
}
