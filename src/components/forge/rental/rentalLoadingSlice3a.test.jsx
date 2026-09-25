// Slice 3a warm-switch contract: the converted private-financing / setup panels serve cached
// data on first paint with no loading flash, and keep last-good data when a refresh fails.
// The module-level SWR cache is cleared between tests so no fixture leaks across cases.
import { beforeEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { clearSWRCache, fetchWithDedupe } from "../../../hooks/swrCache";
import PrivateFinancingAccountsPanel from "./PrivateFinancingAccountsPanel.jsx";
import PrivateFinancingAccountDetail from "./PrivateFinancingAccountDetail.jsx";
import PrivateFinancingLedgerHistory from "./PrivateFinancingLedgerHistory.jsx";
import PrivateFinancingBorrowerPortal from "./PrivateFinancingBorrowerPortal.jsx";
import PropertyFinancialSetupPanel from "./PropertyFinancialSetupPanel.jsx";
import RentalAnimalsPanel from "./RentalAnimalsPanel.jsx";

const accountsPayload = {
  status: "ok",
  accounts: [{
    id: "acc_1",
    borrowerLabel: "Tyler Welch",
    product: "seller_financing",
    status: "active",
    paymentAcceptancePolicy: "partial_allowed",
    balance: { regularScheduledPaymentCents: 50000, totalPrincipalRemainingCents: 9000000 },
  }],
};

const detailPayload = {
  status: "ok",
  account: {
    id: "acc_1", product: "seller_financing", status: "active",
    originationPrincipalCents: 10000000, openedDate: "2026-01-15", lateFeePolicy: "disabled",
  },
  balance: { totalPrincipalRemainingCents: 9000000, regularScheduledPaymentCents: 50000 },
  dueState: null,
  servicingPolicy: { paymentAcceptancePolicy: "partial_allowed" },
  components: [],
  payoffEstimate: null,
  borrowers: [{ membershipId: "m_1", displayName: "Tyler Welch", role: "primary_borrower", status: "active" }],
  onlinePaymentSettings: { enabled: false },
};

const eventsPayload = {
  events: [{
    id: "ev_1", eventType: "payment_posted", effectiveDate: "2026-09-01",
    amountCents: 50000, eventOrigin: "manual_external", paymentMethod: "venmo",
  }],
  pageInfo: { hasMore: false, nextCursor: null },
};

const portalPayload = {
  status: "ok",
  email: "tyler@example.com",
  conversations: [],
  accounts: [{
    account: { id: "acc_1", status: "active", origination_principal_cents: 10000000 },
    role: "primary_borrower",
    summary: { principalRemainingCents: 9000000, paymentCount: 3, totalPaidCents: 150000 },
    events: [],
    regularScheduledPaymentCents: 50000,
    projection: null,
    progressAvailable: false,
    summaryAvailable: true,
    onlinePaymentsEnabled: false,
    pendingPayment: null,
    autopayEnrollments: [],
  }],
};

const setupPayload = {
  setup: {
    financial_account_id: "fin_1", purchase_date: "2026-01-15", purchase_price_cents: 20000000,
    down_payment_cents: 4000000, closing_costs_cents: 500000, initial_valuation_cents: null,
    initial_valuation_date: null, lender_name: "", loan_original_principal_cents: null,
    loan_origination_date: null, loan_current_balance_cents: null, loan_current_balance_as_of: null,
    loan_interest_rate_bps: null,
  },
  available_accounts: [{ id: "fin_1", name: "Business Checking" }],
};

const animalsPayload = [{
  id: "animal_1", name: "Rex", breed_description: "Labrador mix",
  classification: "pet", approval_status: "requested",
}];

beforeEach(() => { clearSWRCache(); });

describe("slice 3a warm-switch behavior", () => {
  it("renders the cached accounts list instantly with no loading flash", async () => {
    await fetchWithDedupe("private-financing:accounts", () => Promise.resolve(accountsPayload));
    const html = renderToStaticMarkup(<PrivateFinancingAccountsPanel />);
    expect(html).toContain("Tyler Welch");
    expect(html).not.toContain("Loading private financing accounts");
  });

  it("shows the accounts skeleton only when nothing is cached", () => {
    const html = renderToStaticMarkup(<PrivateFinancingAccountsPanel />);
    expect(html).toContain("Loading private financing accounts…");
  });

  it("keeps the last good accounts visible when a refresh fails", async () => {
    await fetchWithDedupe("private-financing:accounts", () => Promise.resolve(accountsPayload));
    await fetchWithDedupe("private-financing:accounts", () => Promise.reject(new Error("refresh failed"))).catch(() => {});
    const html = renderToStaticMarkup(<PrivateFinancingAccountsPanel />);
    expect(html).toContain("Tyler Welch");
    expect(html).not.toContain("Loading private financing accounts");
  });

  it("shows the honest schema-unavailable explanation, not a generic error", async () => {
    await fetchWithDedupe("private-financing:accounts", () => Promise.resolve({ status: "schema-unavailable", accounts: [] }));
    const html = renderToStaticMarkup(<PrivateFinancingAccountsPanel />);
    expect(html).toContain("has not been activated for this environment yet");
    expect(html).not.toContain("Loading private financing accounts");
  });

  it("renders the cached account detail instantly with no loading flash", async () => {
    await fetchWithDedupe("private-financing:account:acc_1", () => Promise.resolve(detailPayload));
    const html = renderToStaticMarkup(
      <PrivateFinancingAccountDetail accountId="acc_1" onBack={() => {}} />,
    );
    expect(html).toContain("Tyler Welch");
    expect(html).not.toContain("Loading account details");
  });

  it("shows the detail skeleton only when nothing is cached", () => {
    const html = renderToStaticMarkup(
      <PrivateFinancingAccountDetail accountId="cold-acc" onBack={() => {}} />,
    );
    expect(html).toContain("Loading account details…");
  });

  it("keeps the last good detail visible when a refresh fails", async () => {
    await fetchWithDedupe("private-financing:account:acc_1", () => Promise.resolve(detailPayload));
    await fetchWithDedupe("private-financing:account:acc_1", () => Promise.reject(new Error("refresh failed"))).catch(() => {});
    const html = renderToStaticMarkup(
      <PrivateFinancingAccountDetail accountId="acc_1" onBack={() => {}} />,
    );
    expect(html).toContain("Tyler Welch");
    expect(html).not.toContain("Loading account details");
  });

  it("renders the honest not-found state when the account is gone", async () => {
    await fetchWithDedupe("private-financing:account:missing", () => Promise.resolve({ status: "not-found" }));
    const html = renderToStaticMarkup(
      <PrivateFinancingAccountDetail accountId="missing" onBack={() => {}} />,
    );
    expect(html).toContain("This account was not found, or is not accessible to this workspace.");
  });

  it("renders the cached ledger events instantly with no loading flash", async () => {
    await fetchWithDedupe("private-financing:events:acc_1", () => Promise.resolve(eventsPayload));
    const html = renderToStaticMarkup(
      <PrivateFinancingLedgerHistory accountId="acc_1" product="seller_financing" refreshSignal={0} />,
    );
    expect(html).toContain("Payment posted");
    expect(html).not.toContain("Loading ledger history");
  });

  it("shows the ledger skeleton only when nothing is cached", () => {
    const html = renderToStaticMarkup(
      <PrivateFinancingLedgerHistory accountId="cold-acc" product="seller_financing" refreshSignal={0} />,
    );
    expect(html).toContain("Loading ledger history…");
  });

  it("keeps the last good ledger events visible when a refresh fails", async () => {
    await fetchWithDedupe("private-financing:events:acc_1", () => Promise.resolve(eventsPayload));
    await fetchWithDedupe("private-financing:events:acc_1", () => Promise.reject(new Error("refresh failed"))).catch(() => {});
    const html = renderToStaticMarkup(
      <PrivateFinancingLedgerHistory accountId="acc_1" product="seller_financing" refreshSignal={0} />,
    );
    expect(html).toContain("Payment posted");
    expect(html).not.toContain("Loading ledger history");
  });

  it("renders the cached borrower portal instantly with no loading flash", async () => {
    await fetchWithDedupe("private-financing:borrower-portal:", () => Promise.resolve(portalPayload));
    const html = renderToStaticMarkup(<PrivateFinancingBorrowerPortal />);
    expect(html).toContain("Your private financing");
    expect(html).toContain("tyler@example.com");
    expect(html).not.toContain("Loading your financing account");
  });

  it("shows the portal skeleton only when nothing is cached", () => {
    const html = renderToStaticMarkup(<PrivateFinancingBorrowerPortal />);
    expect(html).toContain("Loading your financing account…");
  });

  it("renders the portal's actionable error state without losing its context", async () => {
    await fetchWithDedupe("private-financing:borrower-portal:", () => Promise.resolve({
      status: "error",
      error: "No invitation matches this signed-in email.",
      signInUrl: null, signedInEmail: "tyler@example.com", invitedEmail: null, claimErrorCode: null,
    }));
    const html = renderToStaticMarkup(<PrivateFinancingBorrowerPortal />);
    expect(html).toContain("No invitation matches this signed-in email.");
    expect(html).toContain("tyler@example.com");
  });

  it("renders the cached financial setup form instantly with no loading flash", async () => {
    await fetchWithDedupe("rental:property-financial-setup:prop_1", () => Promise.resolve(setupPayload));
    const html = renderToStaticMarkup(
      <PropertyFinancialSetupPanel recordContext={{ propertyId: "prop_1" }} />,
    );
    expect(html).toContain("Financial setup");
    expect(html).not.toContain("Loading financial setup");
  });

  it("shows the setup skeleton only when nothing is cached", () => {
    const html = renderToStaticMarkup(
      <PropertyFinancialSetupPanel recordContext={{ propertyId: "cold-prop" }} />,
    );
    expect(html).toContain("Loading financial setup…");
  });

  it("renders the cached animal requests instantly with no loading flash", async () => {
    await fetchWithDedupe("rental:animals", () => Promise.resolve(animalsPayload));
    const html = renderToStaticMarkup(<RentalAnimalsPanel />);
    expect(html).toContain("Rex");
    expect(html).not.toContain("Loading animal requests");
  });

  it("shows the animals skeleton only when nothing is cached", () => {
    const html = renderToStaticMarkup(<RentalAnimalsPanel />);
    expect(html).toContain("Loading animal requests…");
  });

  it("keeps the last good animal list visible when a refresh fails", async () => {
    await fetchWithDedupe("rental:animals", () => Promise.resolve(animalsPayload));
    await fetchWithDedupe("rental:animals", () => Promise.reject(new Error("refresh failed"))).catch(() => {});
    const html = renderToStaticMarkup(<RentalAnimalsPanel />);
    expect(html).toContain("Rex");
    expect(html).not.toContain("Loading animal requests");
  });

  it("shows the honest empty state when there are no animal requests", async () => {
    await fetchWithDedupe("rental:animals", () => Promise.resolve([]));
    const html = renderToStaticMarkup(<RentalAnimalsPanel />);
    expect(html).toContain("No animal requests.");
    expect(html).not.toContain("Loading animal requests");
  });
});
