const addDays=(dateStr,days)=>{const date=new Date(`${dateStr}T00:00:00Z`);date.setUTCDate(date.getUTCDate()+days);return date.toISOString().slice(0,10);};
const dayDiff=(fromStr,toStr)=>Math.round((new Date(`${toStr}T00:00:00Z`)-new Date(`${fromStr}T00:00:00Z`))/86400000);
export function buildLeaseExpirationReport({units=[],tenants=[],leases=[],memberships=[]},{startDate=new Date().toISOString().slice(0,10),endDate}={}){
  const cutoff=endDate||addDays(startDate,60);
  const unitById=new Map(units.map(item=>[item.id,item]));const tenantById=new Map(tenants.map(item=>[item.id,item]));
  const tenantIdsByLease=new Map();for(const membership of memberships){const list=tenantIdsByLease.get(membership.lease_id)||[];list.push(membership.tenant_id);tenantIdsByLease.set(membership.lease_id,list);}
  const rows=leases.filter(lease=>lease.status==="active"&&lease.end_date&&lease.end_date<=cutoff).map(lease=>{
    const tenantIds=tenantIdsByLease.get(lease.id)||[];
    return Object.freeze({leaseId:lease.id,propertyId:lease.property_id,unitId:lease.unit_id,unitLabel:unitById.get(lease.unit_id)?.label||lease.unit_id,
      tenantNames:Object.freeze(tenantIds.map(id=>tenantById.get(id)?.display_name||id)),endDate:lease.end_date,
      daysUntilExpiration:dayDiff(startDate,lease.end_date),monthlyRentCents:Number(lease.monthly_rent_cents)});
  }).sort((a,b)=>a.endDate<b.endDate?-1:a.endDate>b.endDate?1:0);
  return Object.freeze({generatedAt:new Date().toISOString(),startDate,endDate:cutoff,
    summary:Object.freeze({expiringCount:rows.length,alreadyExpiredCount:rows.filter(row=>row.daysUntilExpiration<0).length}),rows:Object.freeze(rows)});
}
const csv=(value)=>`"${String(value??"").replaceAll('"','""')}"`;
export function leaseExpirationReportToCsv(report){const lines=[["Lease ID","Property ID","Unit","Tenants","End date","Days until expiration","Monthly rent"]];
for(const row of report.rows)lines.push([row.leaseId,row.propertyId,row.unitLabel,row.tenantNames.join("; "),row.endDate,row.daysUntilExpiration,(row.monthlyRentCents/100).toFixed(2)]);
return lines.map(row=>row.map(csv).join(",")).join("\n");}
