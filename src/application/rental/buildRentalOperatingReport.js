export function buildRentalOperatingReport({units=[],tenants=[],leases=[],memberships=[],charges=[],payments=[]},today=new Date().toISOString().slice(0,10)){
  const unitById=new Map(units.map(item=>[item.id,item]));const tenantById=new Map(tenants.map(item=>[item.id,item]));
  const tenantIdsByLease=new Map();for(const membership of memberships){const list=tenantIdsByLease.get(membership.lease_id)||[];list.push(membership.tenant_id);tenantIdsByLease.set(membership.lease_id,list);}
  const chargesByLease=new Map();for(const charge of charges){const list=chargesByLease.get(charge.lease_id)||[];list.push(charge);chargesByLease.set(charge.lease_id,list);}
  const paymentsByLease=new Map();for(const payment of payments){const list=paymentsByLease.get(payment.lease_id)||[];list.push(payment);paymentsByLease.set(payment.lease_id,list);}
  const rentRoll=leases.map(lease=>{const leaseCharges=chargesByLease.get(lease.id)||[];const leasePayments=paymentsByLease.get(lease.id)||[];
    const balanceCents=leaseCharges.filter(item=>item.status!=="void").reduce((sum,item)=>sum+Number(item.amount_cents)-Number(item.paid_amount_cents),0);
    const overdueCents=leaseCharges.filter(item=>item.status!=="void"&&item.due_date<today&&Number(item.amount_cents)>Number(item.paid_amount_cents)).reduce((sum,item)=>sum+Number(item.amount_cents)-Number(item.paid_amount_cents),0);
    return Object.freeze({leaseId:lease.id,propertyId:lease.property_id,unitId:lease.unit_id,unitLabel:unitById.get(lease.unit_id)?.label||lease.unit_id,
      tenantNames:Object.freeze((tenantIdsByLease.get(lease.id)||[]).map(id=>tenantById.get(id)?.display_name||id)),status:lease.status,
      startDate:lease.start_date,endDate:lease.end_date,monthlyRentCents:Number(lease.monthly_rent_cents),balanceCents,overdueCents,
      collectedCents:leasePayments.filter(item=>item.status==="succeeded").reduce((sum,item)=>sum+Number(item.amount_cents)-Number(item.refunded_amount_cents||0),0)});});
  return Object.freeze({generatedAt:new Date().toISOString(),asOfDate:today,summary:Object.freeze({activeLeases:rentRoll.filter(item=>item.status==="active").length,
    occupiedUnits:units.filter(item=>item.status==="occupied").length,monthlyScheduledCents:rentRoll.filter(item=>item.status==="active").reduce((sum,item)=>sum+item.monthlyRentCents,0),
    openBalanceCents:rentRoll.reduce((sum,item)=>sum+item.balanceCents,0),overdueBalanceCents:rentRoll.reduce((sum,item)=>sum+item.overdueCents,0),
    collectedCents:rentRoll.reduce((sum,item)=>sum+item.collectedCents,0)}),rentRoll:Object.freeze(rentRoll),payments:Object.freeze(payments)});
}
const csv=(value)=>`"${String(value??"").replaceAll('"','""')}"`;
export function rentalReportToCsv(report){const lines=[["Lease ID","Property ID","Unit","Tenants","Lease status","Start date","End date","Monthly rent","Open balance","Overdue balance","Collected"]];
for(const row of report.rentRoll)lines.push([row.leaseId,row.propertyId,row.unitLabel,row.tenantNames.join("; "),row.status,row.startDate,row.endDate||"",(row.monthlyRentCents/100).toFixed(2),(row.balanceCents/100).toFixed(2),(row.overdueCents/100).toFixed(2),(row.collectedCents/100).toFixed(2)]);
return lines.map(row=>row.map(csv).join(",")).join("\n");}
