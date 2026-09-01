import { describe,expect,it } from "vitest";
import { quoteReservation } from "./quote";
const plan=(cadence,amountCents)=>({cadence,amountCents,status:"active",effectiveStartDate:"2026-01-01",effectiveEndDate:null});
describe("reservation quote",()=>{
  it("uses monthly then weekly then nightly rates deterministically",()=>{expect(quoteReservation({checkIn:"2026-09-01",checkOut:"2026-10-08",ratePlans:[plan("nightly",10000),plan("weekly",60000),plan("monthly",200000)]})).toMatchObject({nights:37,lodgingAmountCents:280000,lines:[{cadence:"monthly",quantity:1,amountCents:200000},{cadence:"weekly",quantity:1,amountCents:60000},{cadence:"nightly",quantity:2,amountCents:20000}]})});
  it("adds seller fees and lodging-only tax in cents",()=>{expect(quoteReservation({checkIn:"2026-09-01",checkOut:"2026-09-04",ratePlans:[plan("nightly",10000)],cleaningFeeCents:5000,securityDepositCents:10000,lodgingTaxBasisPoints:825})).toMatchObject({lodgingAmountCents:30000,cleaningFeeCents:5000,lodgingTaxCents:2475,securityDepositCents:10000,totalDueCents:47475})});
  it("fails closed when a remainder has no nightly rate",()=>{expect(()=>quoteReservation({checkIn:"2026-09-01",checkOut:"2026-09-09",ratePlans:[plan("weekly",60000)]})).toThrow("nightly rate")});
});
