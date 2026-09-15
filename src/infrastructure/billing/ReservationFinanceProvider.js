import { reservationProviderId } from "./normalizeReservationFinanceEvent";

const id = value => reservationProviderId(typeof value === "object" ? value?.id : value);
const cents = value => Number.isSafeInteger(value);
function requireValue(condition) {
  if (!condition) throw new Error("Unknown reservation provider outcome.");
}

// Read-only Stripe adapter. No create, confirm, refund, or payout mutation methods.
export class ReservationFinanceProvider {
  constructor(provider, connectedAccountId) {
    requireValue(provider.mode === "test" && id(connectedAccountId));
    this.stripe = provider.stripe;
    this.options = { stripeAccount: connectedAccountId };
  }

  async pages(resource, params) {
    const result = [];
    let startingAfter;
    do {
      const page = await resource.list({ ...params, limit: 100, ...(startingAfter ? { starting_after: startingAfter } : {}) }, this.options);
      requireValue(Array.isArray(page.data) && typeof page.has_more === "boolean");
      result.push(...page.data);
      if (!page.has_more) return result;
      const next = id(page.data.at(-1));
      requireValue(next && next !== startingAfter && result.length <= 10000);
      startingAfter = next;
    } while (true);
  }

  async charge(paymentIntentId) {
    requireValue(id(paymentIntentId));
    const intent = await this.stripe.paymentIntents.retrieve(paymentIntentId, {}, this.options);
    requireValue(intent.id === paymentIntentId && intent.livemode === false && intent.status === "succeeded" && id(intent.latest_charge));
    const charge = await this.stripe.charges.retrieve(id(intent.latest_charge), {}, this.options);
    requireValue(charge.id === id(intent.latest_charge) && charge.livemode === false
      && id(charge.payment_intent) === paymentIntentId && charge.paid === true && charge.captured === true
      && cents(charge.amount) && charge.amount === intent.amount_received && charge.currency === intent.currency);
    return charge;
  }

  async paymentIntentForCharge(chargeId) {
    requireValue(id(chargeId));
    const charge = await this.stripe.charges.retrieve(chargeId, {}, this.options);
    requireValue(charge.id === chargeId && charge.livemode === false && id(charge.payment_intent));
    return id(charge.payment_intent);
  }

  async observations(attempt, { refunds = false, disputeId = null, payout = null, expectedChargeId = null } = {}) {
    const charge = await this.charge(attempt.paymentIntentId);
    if (expectedChargeId) requireValue(charge.id === expectedChargeId);
    requireValue(charge.amount === attempt.amountCents && charge.currency?.toUpperCase() === attempt.currencyCode);
    const base = { paymentIntentId: attempt.paymentIntentId, currencyCode: attempt.currencyCode };
    const observations = [];
    if (refunds) {
      const values = await this.pages(this.stripe.refunds, { charge: charge.id });
      requireValue(values.length > 0);
      for (const refund of values) {
        requireValue(id(refund) && id(refund.charge) === charge.id && id(refund.payment_intent) === attempt.paymentIntentId
          && refund.currency === charge.currency && cents(refund.amount) && refund.amount > 0
          && ["pending", "requires_action", "succeeded", "failed", "canceled"].includes(refund.status));
        observations.push({ ...base, objectId: refund.id,
          kind: refund.destination_details?.card?.type === "reversal" ? "reversal" : "refund",
          amountCents: refund.amount, status: refund.status });
      }
      const refunded = values.filter(value => value.status === "succeeded").reduce((sum, value) => sum + value.amount, 0);
      requireValue(cents(refunded) && refunded <= charge.amount && charge.amount_refunded === refunded);
    } else if (disputeId) {
      const dispute = await this.stripe.disputes.retrieve(disputeId, {}, this.options);
      requireValue(dispute.id === disputeId && dispute.livemode === false && id(dispute.charge) === charge.id
        && id(dispute.payment_intent) === attempt.paymentIntentId && dispute.currency === charge.currency
        && cents(dispute.amount) && dispute.amount > 0 && dispute.amount <= charge.amount
        && ["needs_response", "under_review", "won", "lost", "warning_needs_response", "warning_under_review", "warning_closed"].includes(dispute.status));
      observations.push({ ...base, objectId: dispute.id, kind: "dispute", amountCents: dispute.amount, status: dispute.status });
    } else {
      requireValue(id(charge.balance_transaction));
      const balance = await this.stripe.balanceTransactions.retrieve(id(charge.balance_transaction), {}, this.options);
      requireValue(balance.id === id(charge.balance_transaction) && id(balance.source) === charge.id
        && ["charge", "payment"].includes(balance.type) && balance.currency === charge.currency
        && cents(balance.amount) && balance.amount === charge.amount && cents(balance.fee) && balance.fee >= 0
        && cents(balance.net) && balance.net === balance.amount - balance.fee
        && ["pending", "available"].includes(balance.status));
      if (payout) requireValue(payout.balanceTransactionIds.includes(balance.id) && payout.currency === balance.currency && balance.status === "available");
      observations.push({ ...base, objectId: balance.id, kind: "settlement", amountCents: balance.amount,
        feeCents: balance.fee, netCents: balance.net, status: balance.status,
        ...(payout ? { payoutId: payout.id, payoutStatus: payout.status } : {}) });
    }
    return observations;
  }

  async payout(payoutId) {
    requireValue(id(payoutId));
    const payout = await this.stripe.payouts.retrieve(payoutId, {}, this.options);
    requireValue(payout.id === payoutId && payout.livemode === false && payout.automatic === true
      && payout.reconciliation_status === "completed" && cents(payout.amount) && payout.amount > 0
      && ["pending", "in_transit", "paid", "failed", "canceled"].includes(payout.status));
    const balances = await this.pages(this.stripe.balanceTransactions, { payout: payoutId });
    requireValue(balances.length > 0 && balances.every(value => id(value) && cents(value.net) && value.currency === payout.currency));
    requireValue(new Set(balances.map(value => value.id)).size === balances.length
      && balances.reduce((sum, value) => sum + value.net, 0) === payout.amount);
    // A mixed or unresolvable batch must remain unknown; never allocate a payout by metadata.
    requireValue(balances.every(value => ["charge", "payment"].includes(value.type) && id(value.source)));
    return { id: payout.id, status: payout.status, currency: payout.currency,
      balanceTransactionIds: balances.map(value => value.id), chargeIds: balances.map(value => id(value.source)) };
  }
}
