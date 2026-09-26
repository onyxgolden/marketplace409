import { NextResponse } from "next/server";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { normalizeBook } from "@/domains/roomDesigner/cabinetPriceBooks";

// Supplier cabinet price books for the Home Designer. Private per workspace
// owner (designer_price_books, RLS: has_workspace_access), never shipped in
// code. Books are validated through normalizeBook on the way in and out.

function ownerIdOf(authenticated) {
  return authenticated.effectiveOwnerId || authenticated.user.id;
}

/** Largest accepted request body (a 2,000-row book is ~250 KB). */
const MAX_BODY_BYTES = 1_000_000;

// GET — the caller's price books.
export async function GET() {
  try {
    const authenticated = await createAuthenticatedForgeApplication();
    if (authenticated.response) return authenticated.response;
    const { data, error } = await authenticated.supabaseClient
      .from("designer_price_books")
      .select("book_id,book,updated_at")
      .eq("owner_id", ownerIdOf(authenticated))
      .order("updated_at", { ascending: true });
    if (error) throw error;
    const books = (data || []).map((row) => normalizeBook({ ...row.book, id: row.book_id })).filter(Boolean);
    return NextResponse.json({ success: true, books });
  } catch (error) {
    console.error("Designer price books list error", error);
    return NextResponse.json({ error: "Unable to load price lists." }, { status: 500 });
  }
}

// PUT { book } — create or replace one price book.
export async function PUT(request) {
  try {
    const authenticated = await createAuthenticatedForgeApplication();
    if (authenticated.response) return authenticated.response;
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) {
      return NextResponse.json({ error: "Price list is too large." }, { status: 413 });
    }
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
    }
    const book = normalizeBook(body?.book);
    if (!book) return NextResponse.json({ error: "A price list needs an id." }, { status: 400 });
    const { error } = await authenticated.supabaseClient.from("designer_price_books").upsert(
      {
        owner_id: ownerIdOf(authenticated),
        book_id: book.id,
        book,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "owner_id,book_id" },
    );
    if (error) throw error;
    return NextResponse.json({ success: true, book });
  } catch (error) {
    console.error("Designer price book save error", error);
    return NextResponse.json({ error: "Unable to save the price list." }, { status: 500 });
  }
}

// DELETE ?id=<book id> — remove one price book.
export async function DELETE(request) {
  try {
    const authenticated = await createAuthenticatedForgeApplication();
    if (authenticated.response) return authenticated.response;
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Missing price list id." }, { status: 400 });
    const { error } = await authenticated.supabaseClient
      .from("designer_price_books")
      .delete()
      .eq("owner_id", ownerIdOf(authenticated))
      .eq("book_id", id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Designer price book delete error", error);
    return NextResponse.json({ error: "Unable to delete the price list." }, { status: 500 });
  }
}
