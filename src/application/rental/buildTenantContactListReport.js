export function buildTenantContactListReport({units=[],tenants=[],leases=[],memberships=[]}){
  const unitById=new Map(units.map(item=>[item.id,item]));const leaseById=new Map(leases.map(item=>[item.id,item]));
  const activeLeaseByTenant=new Map();
  for(const membership of memberships){const lease=leaseById.get(membership.lease_id);if(!lease||lease.status!=="active")continue;
    if(!activeLeaseByTenant.has(membership.tenant_id))activeLeaseByTenant.set(membership.tenant_id,lease);}
  const rows=tenants.map(tenant=>{const lease=activeLeaseByTenant.get(tenant.id);const unit=lease?unitById.get(lease.unit_id):null;
    return Object.freeze({tenantId:tenant.id,displayName:tenant.display_name,email:tenant.email,phone:tenant.phone||"",status:tenant.status,
      propertyId:lease?.property_id||"",unitLabel:unit?.label||"",leaseStatus:lease?.status||"none"});
  }).sort((a,b)=>a.displayName.localeCompare(b.displayName));
  return Object.freeze({generatedAt:new Date().toISOString(),summary:Object.freeze({tenantCount:rows.length}),rows:Object.freeze(rows)});
}
const csv=(value)=>`"${String(value??"").replaceAll('"','""')}"`;
export function tenantContactListReportToCsv(report){const lines=[["Tenant ID","Name","Email","Phone","Status","Property ID","Unit","Lease status"]];
for(const row of report.rows)lines.push([row.tenantId,row.displayName,row.email,row.phone,row.status,row.propertyId,row.unitLabel,row.leaseStatus]);
return lines.map(row=>row.map(csv).join(",")).join("\n");}
