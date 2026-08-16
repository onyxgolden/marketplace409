export function buildDelinquentTenantsReport({units=[],tenants=[],leases=[],memberships=[],charges=[]},today=new Date().toISOString().slice(0,10)){
  const unitById=new Map(units.map(item=>[item.id,item]));const tenantById=new Map(tenants.map(item=>[item.id,item]));
  const tenantIdsByLease=new Map();for(const membership of memberships){const list=tenantIdsByLease.get(membership.lease_id)||[];list.push(membership.tenant_id);tenantIdsByLease.set(membership.lease_id,list);}
  const chargesByLease=new Map();for(const charge of charges){const list=chargesByLease.get(charge.lease_id)||[];list.push(charge);chargesByLease.set(charge.lease_id,list);}
  const rows=leases.filter(lease=>lease.status==="active").map(lease=>{
    const overdueCharges=(chargesByLease.get(lease.id)||[]).filter(item=>item.status!=="void"&&item.due_date<today&&Number(item.amount_cents)>Number(item.paid_amount_cents));
    const overdueCents=overdueCharges.reduce((sum,item)=>sum+Number(item.amount_cents)-Number(item.paid_amount_cents),0);
    const oldestDueDate=overdueCharges.reduce((oldest,item)=>!oldest||item.due_date<oldest?item.due_date:oldest,null);
    const tenantIds=tenantIdsByLease.get(lease.id)||[];const leaseTenants=tenantIds.map(id=>tenantById.get(id)).filter(Boolean);
    return Object.freeze({leaseId:lease.id,propertyId:lease.property_id,unitId:lease.unit_id,unitLabel:unitById.get(lease.unit_id)?.label||lease.unit_id,
      tenantNames:Object.freeze(leaseTenants.map(item=>item.display_name)),tenantEmails:Object.freeze(leaseTenants.map(item=>item.email)),
      tenantPhones:Object.freeze(leaseTenants.map(item=>item.phone||"")),overdueCents,overdueChargeCount:overdueCharges.length,oldestDueDate});
  }).filter(row=>row.overdueCents>0).sort((a,b)=>b.overdueCents-a.overdueCents);
  return Object.freeze({generatedAt:new Date().toISOString(),asOfDate:today,
    summary:Object.freeze({delinquentLeaseCount:rows.length,totalOverdueCents:rows.reduce((sum,row)=>sum+row.overdueCents,0)}),rows:Object.freeze(rows)});
}
const csv=(value)=>`"${String(value??"").replaceAll('"','""')}"`;
export function delinquentTenantsReportToCsv(report){const lines=[["Lease ID","Property ID","Unit","Tenants","Emails","Phones","Overdue amount","Overdue charge count","Oldest due date"]];
for(const row of report.rows)lines.push([row.leaseId,row.propertyId,row.unitLabel,row.tenantNames.join("; "),row.tenantEmails.join("; "),row.tenantPhones.join("; "),(row.overdueCents/100).toFixed(2),row.overdueChargeCount,row.oldestDueDate||""]);
return lines.map(row=>row.map(csv).join(",")).join("\n");}
