const addDays=(dateStr,days)=>{const date=new Date(`${dateStr}T00:00:00Z`);date.setUTCDate(date.getUTCDate()+days);return date.toISOString().slice(0,10);};
export function buildUpcomingChargesReport({units=[],tenants=[],leases=[],memberships=[],charges=[]},{startDate=new Date().toISOString().slice(0,10),endDate}={}){
  const cutoff=endDate||addDays(startDate,30);
  const unitById=new Map(units.map(item=>[item.id,item]));const tenantById=new Map(tenants.map(item=>[item.id,item]));const leaseById=new Map(leases.map(item=>[item.id,item]));
  const tenantIdsByLease=new Map();for(const membership of memberships){const list=tenantIdsByLease.get(membership.lease_id)||[];list.push(membership.tenant_id);tenantIdsByLease.set(membership.lease_id,list);}
  const rows=charges.filter(charge=>["scheduled","due","partially_paid"].includes(charge.status)&&charge.due_date>=startDate&&charge.due_date<=cutoff).map(charge=>{
    const lease=leaseById.get(charge.lease_id);const tenantIds=tenantIdsByLease.get(charge.lease_id)||[];
    return Object.freeze({chargeId:charge.id,leaseId:charge.lease_id,propertyId:lease?.property_id||"",unitLabel:unitById.get(lease?.unit_id)?.label||lease?.unit_id||"",
      tenantNames:Object.freeze(tenantIds.map(id=>tenantById.get(id)?.display_name||id)),dueDate:charge.due_date,
      amountCents:Number(charge.amount_cents),remainingCents:Number(charge.amount_cents)-Number(charge.paid_amount_cents),status:charge.status});
  }).sort((a,b)=>a.dueDate<b.dueDate?-1:a.dueDate>b.dueDate?1:0);
  return Object.freeze({generatedAt:new Date().toISOString(),startDate,endDate:cutoff,
    summary:Object.freeze({upcomingCount:rows.length,totalDueCents:rows.reduce((sum,row)=>sum+row.remainingCents,0)}),rows:Object.freeze(rows)});
}
const csv=(value)=>`"${String(value??"").replaceAll('"','""')}"`;
export function upcomingChargesReportToCsv(report){const lines=[["Charge ID","Lease ID","Property ID","Unit","Tenants","Due date","Amount","Remaining","Status"]];
for(const row of report.rows)lines.push([row.chargeId,row.leaseId,row.propertyId,row.unitLabel,row.tenantNames.join("; "),row.dueDate,(row.amountCents/100).toFixed(2),(row.remainingCents/100).toFixed(2),row.status]);
return lines.map(row=>row.map(csv).join(",")).join("\n");}
