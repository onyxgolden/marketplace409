// Panels-slice warm-switch contract: the converted panels serve cached data
// on first paint with no loading flash, and keep last-good data when a
// refresh fails. Loading skeletons appear only when nothing is cached.
import { afterEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { clearSWRCache, fetchWithDedupe } from "../../hooks/swrCache";
import RecurringPaymentsPanel from "./RecurringPaymentsPanel.jsx";
import ReconcileTransfersPanel from "./ReconcileTransfersPanel.jsx";
import ReconcileDuplicatesPanel from "./ReconcileDuplicatesPanel.jsx";
import CaptureLibraryGrid from "./capture/CaptureLibraryGrid.jsx";
import GuestReservationAccess from "../reservations/GuestReservationAccess.jsx";
import PublicReservationBooking from "../reservations/PublicReservationBooking.jsx";

const recurringPatterns = [
  {
    accountName: "DuGood Checking", direction: "outbound", category: "mortgage_payment",
    cadence: "monthly", medianAmount: 1413.83, occurrences: 6, medianIntervalDays: 30,
    lastDate: "2026-09-01", nextExpectedDate: "2026-10-01", irregularIntervals: 0,
  },
];

const transfersPayload = {
  directionFixes: [],
  internalTransfers: [],
  distributions: [],
  debtPayments: [],
  ambiguousTransfers: [
    {
      eventId: "evt_1", eventDate: "2026-09-10", description: "Transfer to Share 0009",
      amount: 10000, side: "outbound", reason: "uncertain_match",
      suggestion: { category: "internal_transfer", confidence: 0.9, reasons: ["matched amount"] },
    },
  ],
  totalDebtPaymentAmountCents: 0,
  totalDistributionAmountCents: 0,
  totalDirectionFixAmountCents: 0,
};

const duplicatesPayload = {
  confirmedDuplicates: [
    {
      transactionId: "txn_1", transactionDate: "2026-09-05", transactionAmount: 150000,
      transactionDescription: "Rent payment", rentecDescription: "Rent received",
    },
  ],
  ambiguous: [],
  totalConfirmedAmountCents: 150000,
};

const captureItems = [
  {
    id: "cap_1", title: "Snagit-style screenshot", signedUrl: "https://example.com/signed.png",
    captured_at: "2026-09-24T12:00:00Z", byte_size: 204800, kind: "screenshot",
  },
];

const accessPayload = {
  publicName: "Cabin Pinecone", checkIn: "2026-10-01", checkOut: "2026-10-04",
  available: true, arrivalInstructions: "Gate code 1234.",
  financial: {
    bookingBalanceCents: 20000, securityDepositCents: 10000, bookingAmountDueCents: 0,
    bookingPaymentStatus: "paid", securityDepositStatus: "held", settlementStatus: "settled",
    bookingAppliedCents: 20000, currencyCode: "USD",
  },
};

const listingPayload = {
  publicName: "Cabin Pinecone", publicDescription: "Lakeside cabin.", inventoryType: "cabin",
  maximumGuests: 6, minimumNights: 2,
};

afterEach(() => { clearSWRCache(); });

describe("panels slice warm-switch behavior", () => {
  it("renders cached recurring patterns instantly with no loading flash", async () => {
    await fetchWithDedupe("financial:recurring-patterns", () => Promise.resolve(recurringPatterns));
    const html = renderToStaticMarkup(<RecurringPaymentsPanel />);
    expect(html).toContain("Recurring payments");
    expect(html).toContain("DuGood Checking");
    expect(html).not.toContain("Looking for recurring payments");
  });

  it("shows the recurring skeleton only when nothing is cached", () => {
    const html = renderToStaticMarkup(<RecurringPaymentsPanel />);
    expect(html).toContain("Looking for recurring payments…");
  });

  it("keeps the last good patterns visible when a refresh fails", async () => {
    await fetchWithDedupe("financial:recurring-patterns", () => Promise.resolve(recurringPatterns));
    await fetchWithDedupe("financial:recurring-patterns", () => Promise.reject(new Error("refresh failed"))).catch(() => {});
    const html = renderToStaticMarkup(<RecurringPaymentsPanel />);
    expect(html).toContain("DuGood Checking");
    expect(html).not.toContain("Looking for recurring payments");
  });

  it("renders the cached transfer preview instantly with no loading flash", async () => {
    await fetchWithDedupe("financial:reconcile-transfers", () => Promise.resolve(transfersPayload));
    const html = renderToStaticMarkup(<ReconcileTransfersPanel />);
    expect(html).toContain("Transfers &amp; distributions");
    expect(html).toContain("Transfer to Share 0009");
    expect(html).not.toContain("Checking for misclassified transfers");
  });

  it("shows the transfer skeleton only when nothing is cached", () => {
    const html = renderToStaticMarkup(<ReconcileTransfersPanel />);
    expect(html).toContain("Checking for misclassified transfers…");
  });

  it("renders nothing when the transfer schema is unavailable", async () => {
    await fetchWithDedupe("financial:reconcile-transfers", () => Promise.resolve({ schemaUnavailable: true }));
    const html = renderToStaticMarkup(<ReconcileTransfersPanel />);
    expect(html).toBe("");
  });

  it("renders the cached duplicates preview instantly with no loading flash", async () => {
    await fetchWithDedupe("financial:reconcile-duplicates", () => Promise.resolve(duplicatesPayload));
    const html = renderToStaticMarkup(<ReconcileDuplicatesPanel />);
    expect(html).toContain("Duplicate transactions");
    expect(html).toContain("Rent payment");
    expect(html).not.toContain("Checking for duplicate transactions");
  });

  it("shows the duplicates skeleton only when nothing is cached", () => {
    const html = renderToStaticMarkup(<ReconcileDuplicatesPanel />);
    expect(html).toContain("Checking for duplicate transactions…");
  });

  it("renders the cached capture library instantly with no loading flash", async () => {
    await fetchWithDedupe("capture:library-items", () => Promise.resolve(captureItems));
    const html = renderToStaticMarkup(<CaptureLibraryGrid />);
    expect(html).toContain("Snagit-style screenshot");
    expect(html).not.toContain("Loading your library");
  });

  it("shows the library skeleton only when nothing is cached", () => {
    const html = renderToStaticMarkup(<CaptureLibraryGrid />);
    expect(html).toContain("Loading your library…");
  });

  it("keeps the last good captures visible when a refresh fails", async () => {
    await fetchWithDedupe("capture:library-items", () => Promise.resolve(captureItems));
    await fetchWithDedupe("capture:library-items", () => Promise.reject(new Error("refresh failed"))).catch(() => {});
    const html = renderToStaticMarkup(<CaptureLibraryGrid />);
    expect(html).toContain("Snagit-style screenshot");
    expect(html).not.toContain("Loading your library");
  });

  it("renders cached reservation access instantly with no loading flash", async () => {
    await fetchWithDedupe("reservation:access:slug-1:tok-1", () => Promise.resolve(accessPayload));
    const html = renderToStaticMarkup(<GuestReservationAccess slug="slug-1" token="tok-1" />);
    expect(html).toContain("Cabin Pinecone");
    expect(html).toContain("Gate code 1234.");
    expect(html).not.toContain("Loading reservation access");
  });

  it("shows the access skeleton only when nothing is cached", () => {
    const html = renderToStaticMarkup(<GuestReservationAccess slug="cold" token="tok" />);
    expect(html).toContain("Loading reservation access…");
  });

  it("renders the cached stay listing instantly with no loading flash", async () => {
    await fetchWithDedupe("reservation:listing:slug-1", () => Promise.resolve(listingPayload));
    const html = renderToStaticMarkup(<PublicReservationBooking slug="slug-1" />);
    expect(html).toContain("Cabin Pinecone");
    expect(html).toContain("Lakeside cabin.");
    expect(html).not.toContain("Loading stay");
  });

  it("shows the listing skeleton only when nothing is cached", () => {
    const html = renderToStaticMarkup(<PublicReservationBooking slug="cold" />);
    expect(html).toContain("Loading stay…");
  });
});
