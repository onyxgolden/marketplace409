import { isChargeForgeCollectible } from "./isChargeForgeCollectible";

// Delinquency here means "FORGE should be chasing this tenant" — a lease whose overdue balance is
// entirely externally managed (Rentec still authoritative) is not a FORGE delinquency, even though
// the obligation is real. Those obligations are still surfaced, in full, via
// externallyManagedCents/externallyManagedChargeCount — never hidden or dropped from the report.
export function buildDelinquentTenantsReport({units=[],tenants=[],leases=[],memberships=[],charges=[],schedules=[]},today=new Date().toISOString().slice(0,10)){
  const unitById=new Map(units.map(item=>[item.id,item]));const tenantById=new Map(tenants.map(item=>[item.id,item]));
  const scheduleById=new Map(schedules.map(item=>[item.id,item]));
  const tenantIdsByLease=new Map();for(const membership of memberships){const list=tenantIdsByLease.get(membership.lease_id)||[];list.push(membership.tenant_id);tenantIdsByLease.set(membership.lease_id,list);}
  const chargesByLease=new Map();for(const charge of charges){const list=chargesByLease.get(charge.lease_id)||[];list.push(charge);chargesByLease.set(charge.lease_id,list);}
  const rows=leases.filter(lease=>lease.status==="active").map(lease=>{
    const openOverdue=(chargesByLease.get(lease.id)||[]).filter(item=>item.status!=="void"&&item.due_date<today&&Number(item.amount_cents)>Number(item.paid_amount_cents));
    const overdueCharges=openOverdue.filter(item=>isChargeForgeCollectible(item,scheduleById.get(item.schedule_id),today));
    const externallyManagedOverdueCharges=openOverdue.filter(item=>!isChargeForgeCollectible(item,scheduleById.get(item.schedule_id),today));
    const overdueCents=overdueCharges.reduce((sum,item)=>sum+Number(item.amount_cents)-Number(item.paid_amount_cents),0);
    const externallyManagedCents=externallyManagedOverdueCharges.reduce((sum,item)=>sum+Number(item.amount_cents)-Number(item.paid_amount_cents),0);
    const oldestDueDate=overdueCharges.reduce((oldest,item)=>!oldest||item.due_date<oldest?item.due_date:oldest,null);
    const tenantIds=tenantIdsByLease.get(lease.id)||[];const leaseTenants=tenantIds.map(id=>tenantById.get(id)).filter(Boolean);
    return Object.freeze({leaseId:lease.id,propertyId:lease.property_id,unitId:lease.unit_id,unitLabel:unitById.get(lease.unit_id)?.label||lease.unit_id,
      tenantNames:Object.freeze(leaseTenants.map(item=>item.display_name)),tenantEmails:Object.freeze(leaseTenants.map(item=>item.email)),
      tenantPhones:Object.freeze(leaseTenants.map(item=>item.phone||"")),overdueCents,overdueChargeCount:overdueCharges.length,oldestDueDate,
      externallyManagedCents,externallyManagedChargeCount:externallyManagedOverdueCharges.length});
  }).filter(row=>row.overdueCents>0||row.externallyManagedCents>0).sort((a,b)=>b.overdueCents-a.overdueCents);
  return Object.freeze({generatedAt:new Date().toISOString(),asOfDate:today,
    summary:Object.freeze({delinquentLeaseCount:rows.filter(row=>row.overdueCents>0).length,totalOverdueCents:rows.reduce((sum,row)=>sum+row.overdueCents,0),
      externallyManagedCents:rows.reduce((sum,row)=>sum+row.externallyManagedCents,0),externallyManagedChargeCount:rows.reduce((sum,row)=>sum+row.externallyManagedChargeCount,0)}),
    rows:Object.freeze(rows)});
}
const csv=(value)=>`"${String(value??"").replaceAll('"','""')}"`;
export function delinquentTenantsReportToCsv(report){const lines=[["Lease ID","Property ID","Unit","Tenants","Emails","Phones","Overdue amount (FORGE)","Overdue charge count (FORGE)","Oldest due date","Externally managed (reconciliation required)","Externally managed charge count"]];
for(const row of report.rows)lines.push([row.leaseId,row.propertyId,row.unitLabel,row.tenantNames.join("; "),row.tenantEmails.join("; "),row.tenantPhones.join("; "),(row.overdueCents/100).toFixed(2),row.overdueChargeCount,row.oldestDueDate||"",(row.externallyManagedCents/100).toFixed(2),row.externallyManagedChargeCount]);
return lines.map(row=>row.map(csv).join(",")).join("\n");}
