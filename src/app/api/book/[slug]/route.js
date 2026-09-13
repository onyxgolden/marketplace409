import { NextResponse } from "next/server";
import { buildAvailabilityCalendar, canReserveRange } from "@/domains/reservations/availability";
import { quoteReservation } from "@/domains/reservations/quote";
import { decodeReservationPreview, encodeReservationPreview } from "@/domains/reservations/previewToken";
import { createPublicReservationClient } from "@/lib/supabase/createPublicReservationClient";

const tokenKey = () => process.env.RESERVATION_PREVIEW_TOKEN_SECRET || process.env.PRIVATE_FINANCING_PREVIEW_TOKEN_SECRET;
const bad = (error, status = 400) => NextResponse.json({ error }, { status });
const clean = value => String(value || "").trim();
function input(body) { return { guestName: clean(body?.guestName), guestEmail: clean(body?.guestEmail).toLowerCase(), guestPhone: clean(body?.guestPhone), checkIn: clean(body?.checkIn), checkOut: clean(body?.checkOut), guestCount: Number(body?.guestCount || 0) }; }

async function load(db, slug, stay = null) {
  const settings = await db.from("reservation_inventory_settings").select("owner_id,unit_id,inventory_type,booking_status,public_name,public_description,maximum_guests,minimum_nights,maximum_nights,turnover_buffer_hours,check_in_time,check_out_time,amenities,cleaning_fee_cents,security_deposit_cents,lodging_tax_basis_points,public_cancellation_policy").eq("public_booking_slug", slug).eq("booking_status", "active").maybeSingle();
  if (settings.error) throw settings.error;
  if (!settings.data) return null;
  if (!stay) return { settings: settings.data };
  if (stay.checkIn < new Date().toISOString().slice(0, 10)) throw new Error("Check-in cannot be in the past.");
  const s = settings.data;
  const [rates, blocks, reservations] = await Promise.all([
    db.from("reservation_rate_plans").select("cadence,amount_cents,currency_code,effective_start_date,effective_end_date,day_of_week,minimum_nights_override,status").eq("owner_id", s.owner_id).eq("unit_id", s.unit_id).eq("status", "active"),
    db.from("reservation_calendar_blocks").select("start_date,end_date,block_type").eq("owner_id", s.owner_id).eq("unit_id", s.unit_id),
    db.from("reservations").select("check_in_date,check_out_date,status").eq("owner_id", s.owner_id).eq("unit_id", s.unit_id).in("status", ["held", "confirmed", "checked_in"]),
  ]);
  const error = rates.error || blocks.error || reservations.error; if (error) throw error;
  const calendar = buildAvailabilityCalendar({ rangeStart: stay.checkIn, rangeEnd: stay.checkOut, turnoverBufferHours: s.turnover_buffer_hours, blocks: [...(blocks.data || []).map(row => ({ startDate: row.start_date, endDate: row.end_date, blockType: row.block_type })), ...(reservations.data || []).map(row => ({ startDate: row.check_in_date, endDate: row.check_out_date, blockType: "reservation" }))] });
  const availability = canReserveRange({ checkIn: stay.checkIn, checkOut: stay.checkOut, calendar, minimumNights: s.minimum_nights, maximumNights: s.maximum_nights });
  if (!availability.allowed) throw new Error("The selected dates are unavailable or outside the stay rules.");
  if (!Number.isInteger(stay.guestCount) || stay.guestCount < 1 || stay.guestCount > s.maximum_guests) throw new Error("Guest count is outside the inventory limit.");
  return { settings: s, quote: quoteReservation({ checkIn: stay.checkIn, checkOut: stay.checkOut, ratePlans: rates.data || [], cleaningFeeCents: s.cleaning_fee_cents, securityDepositCents: s.security_deposit_cents, lodgingTaxBasisPoints: s.lodging_tax_basis_points }) };
}

function publicListing(s) { return { inventoryType: s.inventory_type, publicName: s.public_name, publicDescription: s.public_description, maximumGuests: s.maximum_guests, minimumNights: s.minimum_nights, maximumNights: s.maximum_nights, checkInTime: s.check_in_time, checkOutTime: s.check_out_time, amenities: s.amenities, cancellationPolicy: s.public_cancellation_policy }; }

export async function GET(_request, { params }) {
  try { const { slug } = await params; const result = await load(createPublicReservationClient(), clean(slug)); return result ? NextResponse.json({ listing: publicListing(result.settings) }) : bad("Bookable stay was not found.", 404); }
  catch (error) { console.error("Public reservation listing failed", { name: error?.name || "Error" }); return bad("Unable to load this stay.", 500); }
}

export async function POST(request, { params }) {
  try {
    const { slug } = await params, body = await request.json(), stay = input(body), db = createPublicReservationClient();
    if (!stay.guestName || !stay.guestEmail || !stay.checkIn || !stay.checkOut) return bad("Name, email, check-in, and check-out are required.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(stay.guestEmail)) return bad("A valid guest email is required.");
    if (body.operation === "preview") {
      const result = await load(db, clean(slug), stay); if (!result) return bad("Bookable stay was not found.", 404);
      const preview = { listing: publicListing(result.settings), stay, quote: result.quote };
      const previewToken = encodeReservationPreview({ operation: "public_booking", bookingSlug: clean(slug), stay, quote: result.quote, cancellationPolicy: result.settings.public_cancellation_policy }, { key: tokenKey() });
      return NextResponse.json({ preview, previewToken });
    }
    if (body.operation !== "confirm" || body.acknowledged !== true || body.confirmationText !== "BOOK") return bad("Review the terms and type BOOK to confirm.");
    const token = decodeReservationPreview(body.previewToken, { key: tokenKey() });
    if (token.operation !== "public_booking" || token.bookingSlug !== clean(slug) || JSON.stringify(token.stay) !== JSON.stringify(stay)) return bad("Booking details changed after preview. Preview again.", 409);
    const fresh = await load(db, clean(slug), stay); if (!fresh) return bad("Bookable stay was not found.", 404);
    if (JSON.stringify(fresh.quote) !== JSON.stringify(token.quote) || fresh.settings.public_cancellation_policy !== token.cancellationPolicy) return bad("Availability, price, or terms changed. Preview again.", 409);
    const q = fresh.quote, reservationId = `public_reservation_${token.confirmationId}`;
    const result = await db.rpc("confirm_public_reservation", { p_booking_slug: clean(slug), p_reservation_id: reservationId, p_guest_id: `public_guest_${token.confirmationId}`, p_guest_name: stay.guestName, p_guest_email: stay.guestEmail, p_guest_phone: stay.guestPhone || null, p_check_in_date: stay.checkIn, p_check_out_date: stay.checkOut, p_guest_count: stay.guestCount, p_lodging_amount_cents: q.lodgingAmountCents, p_cleaning_fee_cents: q.cleaningFeeCents, p_lodging_tax_cents: q.lodgingTaxCents, p_security_deposit_cents: q.securityDepositCents, p_total_due_cents: q.totalDueCents, p_currency_code: q.currencyCode });
    if (result.error) { if (/no longer available|blocked/i.test(result.error.message || "")) return bad("Those dates are no longer available. Preview again.", 409); throw result.error; }
    return NextResponse.json({ confirmation: result.data, paymentCollected: false });
  } catch (error) {
    if (/required|invalid|expired|unavailable|stay rules|guest count|nightly rate/i.test(error?.message || "")) return bad(error.message);
    console.error("Public reservation request failed", { name: error?.name || "Error" }); return bad("Unable to complete the reservation.", 500);
  }
}
