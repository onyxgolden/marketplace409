const DAY_MS = 86_400_000;
function date(value, field) { const parsed = new Date(`${value}T00:00:00.000Z`); if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "") || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0,10)!==value) throw new Error(`${field} must be a valid ISO date.`); return parsed; }
function active(plan, onDate) { return plan.status !== "inactive" && plan.effectiveStartDate <= onDate && (!plan.effectiveEndDate || plan.effectiveEndDate >= onDate); }
function planFor(plans, cadence, onDate) { return plans.filter((plan)=>plan.cadence===cadence&&active(plan,onDate)).sort((a,b)=>b.effectiveStartDate.localeCompare(a.effectiveStartDate))[0] || null; }

export function quoteReservation({ checkIn, checkOut, ratePlans, cleaningFeeCents = 0, securityDepositCents = 0, lodgingTaxBasisPoints = 0 }) {
  const start=date(checkIn,"checkIn"), end=date(checkOut,"checkOut"); const nights=Math.round((end-start)/DAY_MS); if(nights<1)throw new Error("Check-out must follow check-in.");
  const plans=(ratePlans||[]).map((plan)=>({ cadence:plan.cadence, amountCents:Number(plan.amountCents??plan.amount_cents), status:plan.status, effectiveStartDate:plan.effectiveStartDate??plan.effective_start_date, effectiveEndDate:plan.effectiveEndDate??plan.effective_end_date }));
  let remaining=nights,lodgingAmountCents=0; const lines=[];
  for(const [cadence,size] of [["monthly",28],["weekly",7],["nightly",1]]){
    const plan=planFor(plans,cadence,checkIn); if(!plan)continue; if(!Number.isSafeInteger(plan.amountCents)||plan.amountCents<=0)throw new Error("Rate-plan amount is invalid.");
    const quantity=Math.floor(remaining/size); if(quantity){const amountCents=quantity*plan.amountCents;lines.push(Object.freeze({cadence,quantity,amountCents}));lodgingAmountCents+=amountCents;remaining-=quantity*size;}
  }
  if(remaining>0)throw new Error("An active nightly rate is required for the remaining nights.");
  const cleaning=Number(cleaningFeeCents),deposit=Number(securityDepositCents),taxRate=Number(lodgingTaxBasisPoints);
  if(![cleaning,deposit,taxRate].every(Number.isSafeInteger)||cleaning<0||deposit<0||taxRate<0||taxRate>10000)throw new Error("Reservation fees or tax rate are invalid.");
  // V1 taxes lodging only. Jurisdictions that tax cleaning or other fees require an explicit later policy.
  const lodgingTaxCents=Math.round(lodgingAmountCents*taxRate/10000);
  return Object.freeze({ nights, lodgingAmountCents, cleaningFeeCents:cleaning, lodgingTaxCents, securityDepositCents:deposit,
    totalDueCents:lodgingAmountCents+cleaning+lodgingTaxCents+deposit, currencyCode:"USD", lines:Object.freeze(lines) });
}
