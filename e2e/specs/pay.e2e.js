// Pay flow smoke tests (scope §2.1).
//
// Runs serially: the fee test flips the owner's billing rate mid-run, so
// test order inside this file is load-bearing. Each test signs in through
// the real /auth UI; assertions mix UI state with service-role reads of the
// scratch project (the UI is the product, the reads are the backstop).
import { test, expect } from "@playwright/test";
import { readRunState, userFor } from "../helpers/fixtures.js";
import { signIn } from "../helpers/auth.js";
import { expectNoCriticalViolations } from "../helpers/axe.js";
import { scratchClient, readRow, updateBillingFeeBps } from "../helpers/seed.js";
import { deliverSucceededEvent, retrievePaymentIntent } from "../helpers/stripeWebhook.js";

test.describe.serial("tenant portal pay flow", () => {
  let state;
  let config;
  let db;

  test.beforeAll(() => {
    state = readRunState();
    config = {
      baseUrl: state.baseUrl,
      supabaseUrl: process.env.E2E_SUPABASE_URL,
      serviceRoleKey: process.env.E2E_SUPABASE_SERVICE_ROLE_KEY,
      stripeSecret: process.env.E2E_STRIPE_SECRET_KEY,
      webhookSecret: process.env.E2E_STRIPE_WEBHOOK_SECRET,
      connectedAccountId: process.env.E2E_STRIPE_CONNECTED_ACCOUNT_ID,
    };
    db = scratchClient(config);
  });

  const pay = () => state.owners.pay;
  const tenant = () => userFor(state, "tenantPay");

  function formatDate(dateStr) {
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" })
      .format(new Date(`${dateStr}T00:00:00`));
  }

  function parseMoney(text) {
    const match = text.replace(/,/g, "").match(/\$?([\d]+\.[\d]{2})/);
    if (!match) throw new Error(`No money amount in: ${text}`);
    return Math.round(Number.parseFloat(match[1]) * 100);
  }

  async function portalBalanceCents(page) {
    const section = page.locator("section", { hasText: "Current balance" }).first();
    await expect(section).toBeVisible();
    const text = await section.innerText();
    const amountLine = text.split("\n").find((line) => line.includes("$"));
    return parseMoney(amountLine);
  }

  // Charge rows are the bordered flex rows inside a lease section. The row
  // for a due date holds that date's text plus its action button.
  function chargeRow(page, dueDateStr) {
    return page.locator("div.flex.items-center.justify-between.gap-4.rounded-xl.border.p-4")
      .filter({ hasText: formatDate(dueDateStr) });
  }

  async function openReviewForDueDate(page, dueDateStr) {
    await chargeRow(page, dueDateStr).getByRole("button", { name: "Pay now" }).first().click();
    await expect(page.getByRole("heading", { name: "Review your payment" })).toBeVisible();
  }

  async function fillTestCard(page) {
    // The PaymentElement renders inside Stripe iframes whose names vary per
    // load (__privateStripeFrameN). Find the frame holding the card number
    // field instead of guessing a name.
    await expect(page.getByRole("button", { name: /Submit .* payment/ })).toBeEnabled();
    let cardFrame = null;
    for (const frame of page.frames()) {
      if (await frame.locator('input[name="cardnumber"]').count()) {
        cardFrame = frame;
        break;
      }
    }
    if (!cardFrame) throw new Error("Stripe card number field not found in any frame.");
    await cardFrame.locator('input[name="cardnumber"]').fill("4242 4242 4242 4242");
    await cardFrame.locator('input[name="exp-date"]').fill("12/34");
    await cardFrame.locator('input[name="cvc"]').fill("123");
    const postal = cardFrame.locator('input[name="postal"]');
    if (await postal.count()) await postal.fill("12345");
  }

  async function submitCardAndDeliverWebhook(page, chargeId, runTag) {
    await page.getByRole("button", { name: /Submit .* payment/ }).click();
    await expect(page.getByRole("status").filter({ hasText: "Payment submitted" })).toBeVisible();
    // The session creation stored the PaymentIntent id on the payment row.
    const payment = await readRow(db, "rental_payments", { charge_id: chargeId });
    if (!payment?.provider_payment_id) throw new Error("No provider payment id on the payment row after submit.");
    const intent = await retrievePaymentIntent(config.stripeSecret, config.connectedAccountId, payment.provider_payment_id);
    expect(intent.status).toBe("succeeded");
    await deliverSucceededEvent({
      baseUrl: config.baseUrl, stripeSecret: config.stripeSecret, webhookSecret: config.webhookSecret,
      connectedAccountId: config.connectedAccountId, paymentIntentId: payment.provider_payment_id,
      runId: state.runId, n: runTag,
    });
    // The webhook projection runs server-side; poll the charge row until it
    // reflects settlement (bounded — a stuck projection fails, not hangs).
    await expect(async () => {
      const row = await readRow(db, "rent_charges", { id: chargeId });
      expect(row.paid_amount_cents).toBe(row.amount_cents);
    }).toPass({ timeout: 30000 });
    await page.goto(`${config.baseUrl}/forge/rental/portal`);
  }

  test("pay gate renders both sides, and paid/void/pending rows have no pay action", async ({ page }, testInfo) => {
    await signIn(page, config.baseUrl, tenant().email, tenant().password);
    await page.goto(`${config.baseUrl}/forge/rental/portal`);
    await expect(page.getByText("Current balance")).toBeVisible();
    // FORGE-payable charge: Pay now. Externally managed charge: no button.
    await expect(chargeRow(page, pay().dueToday).getByRole("button", { name: "Pay now" }).first()).toBeVisible();
    await expect(page.getByText("Managed in Rentec").first()).toBeVisible();
    // Paid and void rows show no action button at all.
    const paidRow = page.locator("div.flex.items-center.justify-between.gap-4.rounded-xl.border.p-4")
      .filter({ hasText: "paid" }).first();
    await expect(paidRow.getByRole("button")).toHaveCount(0);
    // Seeded processing payment: button disabled, "Payment pending".
    const pendingButton = page.getByRole("button", { name: "Payment pending" });
    await expect(pendingButton).toBeVisible();
    await expect(pendingButton).toBeDisabled();
    await expectNoCriticalViolations(page, "portal balance", testInfo);
  });


  test("full card payment settles the charge and drops the balance", async ({ page }, testInfo) => {
    await signIn(page, config.baseUrl, tenant().email, tenant().password);
    await page.goto(`${config.baseUrl}/forge/rental/portal`);
    const before = await portalBalanceCents(page);
    await openReviewForDueDate(page, pay().dueToday);
    await expect(page.getByText("Total due now")).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue to payment — $1,850.00" })).toBeVisible();
    await page.getByRole("radio", { name: "Card" }).check();
    await expect(page.getByRole("button", { name: "Continue to payment — $1,850.00" })).toBeEnabled();
    await page.getByRole("button", { name: "Continue to payment — $1,850.00" }).click();
    await expect(page.getByRole("heading", { name: "Pay rent securely" })).toBeVisible();
    await expectNoCriticalViolations(page, "payment form", testInfo);
    await fillTestCard(page);
    await submitCardAndDeliverWebhook(page, pay().chargePayableId, "pay");
    const after = await portalBalanceCents(page);
    expect(before - after).toBe(pay().rentCents);
    await expect(page.getByRole("button", { name: "View receipt" }).first()).toBeVisible();
  });

  test("card fee agreement gates Continue and the fee lands on the payment", async ({ page }, testInfo) => {
    await updateBillingFeeBps(db, pay().ownerId, 250);
    await signIn(page, config.baseUrl, tenant().email, tenant().password);
    await page.goto(`${config.baseUrl}/forge/rental/portal`);
    // Fee charge is due tomorrow, so scope its row by tomorrow's date.
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const tomorrowStr = tomorrow.toISOString().slice(0, 10);
    await chargeRow(page, tomorrowStr).getByRole("button", { name: "Pay now" }).first().click();
    await expect(page.getByRole("heading", { name: "Review your payment" })).toBeVisible();
    // Bank selected by default: no fee. Card selected: 2.5% fee appears.
    await expect(page.getByRole("button", { name: "Continue to payment — $1,850.00" })).toBeVisible();
    await page.getByRole("radio", { name: "Card" }).check();
    await expect(page.getByText("Card convenience fee (2.5%)")).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue to payment — $1,896.25" })).toBeDisabled();
    await expect(page.getByText("Check the box above to agree to the card convenience fee.")).toBeVisible();
    await page.getByRole("checkbox").check();
    await expect(page.getByRole("button", { name: "Continue to payment — $1,896.25" })).toBeEnabled();
    await page.getByRole("button", { name: "Continue to payment — $1,896.25" }).click();
    await expect(page.getByRole("heading", { name: "Pay rent securely" })).toBeVisible();
    await fillTestCard(page);
    await submitCardAndDeliverWebhook(page, pay().chargeFeeId, "fee");
    const payment = await readRow(db, "rental_payments", { charge_id: pay().chargeFeeId });
    expect(Number(payment.convenience_fee_cents)).toBe(4625);
    expect(Number(payment.amount_cents)).toBe(pay().rentCents + 4625);
    // Only the seeded processing charge is still open: $1,850.00.
    expect(await portalBalanceCents(page)).toBe(pay().rentCents);
  });

  test("Stripe init failure shows the failure state, not a charge", async ({ page }, testInfo) => {
    // Runs on the fresh resume charge (created here) so the later resume
    // test can rehydrate the session this test leaves behind.
    const dueToday = pay().dueToday;
    const resumeChargeId = `e2e_${state.runId.replaceAll("-", "_")}_charge_resume`;
    const { error } = await db.from("rent_charges").insert({
      owner_id: pay().ownerId, id: resumeChargeId,
      lease_id: pay().leaseId, schedule_id: pay().scheduleForgeId,
      period: dueToday.slice(0, 7), due_date: dueToday, amount_cents: pay().rentCents, paid_amount_cents: 0,
      currency_code: "USD", status: "due", source_key: `smoke:${state.runId}:resume`, charge_type: "rent",
    });
    if (error) throw new Error(`resume charge seed failed: ${error.message}`);
    await page.route("**/js.stripe.com/**", (route) => route.abort());
    await signIn(page, config.baseUrl, tenant().email, tenant().password);
    await page.goto(`${config.baseUrl}/forge/rental/portal`);
    await openReviewForDueDate(page, dueToday);
    // Fee rate is 250 by now (fee test flipped it): agreement required.
    await page.getByRole("radio", { name: "Card" }).check();
    const checkbox = page.getByRole("checkbox");
    if (await checkbox.count()) await checkbox.check();
    await page.getByRole("button", { name: /Continue to payment/ }).click();
    await expect(page.getByRole("heading", { name: "Unable to load the secure payment form" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry loading payment form" })).toBeVisible();
    await page.getByRole("button", { name: "Back to balance" }).click();
    await expect(page.getByText("Current balance")).toBeVisible();
    await expectNoCriticalViolations(page, "portal stripe failure state", testInfo);
  });

  test("resume rehydrates an unsubmitted payment and completes it", async ({ page }) => {
    // Rehydrates the session the Stripe-failure test left behind on the
    // resume charge: no new session, no new charge — the row must offer
    // "Resume payment" instead of "Pay now".
    const dueToday = pay().dueToday;
    const resumeChargeId = `e2e_${state.runId.replaceAll("-", "_")}_charge_resume`;
    await signIn(page, config.baseUrl, tenant().email, tenant().password);
    await page.goto(`${config.baseUrl}/forge/rental/portal`);
    await expect(chargeRow(page, dueToday).getByRole("button", { name: "Resume payment" }).first()).toBeVisible();
    await chargeRow(page, dueToday).getByRole("button", { name: "Resume payment" }).first().click();
    await expect(page.getByRole("heading", { name: "Pay rent securely" })).toBeVisible();
    await fillTestCard(page);
    await submitCardAndDeliverWebhook(page, resumeChargeId, "resume");
    const row = await readRow(db, "rent_charges", { id: resumeChargeId });
    expect(row.status).toBe("paid");
  });
});
