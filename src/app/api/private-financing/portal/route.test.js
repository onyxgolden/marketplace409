import {describe,expect,it} from "vitest";
import {summarizeBorrowerEvents} from "./route";
describe("private financing borrower portal summary",()=>{
it("includes a later principal correction instead of showing the preceding payment balance",()=>{const summary=summarizeBorrowerEvents([
  {event_type:"payment_posted",amount_cents:60000,interest_paid_cents:10000,principal_remaining_interest_bearing_cents:3300000,principal_remaining_zero_interest_cents:0},
  {event_type:"principal_correction",component_type:"interest_bearing",corrected_component_principal_remaining_cents_after:3184347},
]);expect(summary).toEqual({paymentCount:1,totalPaidCents:60000,interestPaidCents:10000,principalRemainingCents:3184347});});
});
