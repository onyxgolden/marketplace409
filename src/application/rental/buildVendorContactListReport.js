export function buildVendorContactListReport({contractors=[]}){
  const rows=contractors.map(contractor=>Object.freeze({contractorId:contractor.id,businessName:contractor.business_name,
    contactName:contractor.contact_name||"",email:contractor.email||"",phone:contractor.phone||"",trade:contractor.trade||"",
    status:contractor.status,insuranceExpiration:contractor.insurance_expiration||"",w9Status:contractor.w9_status}))
    .sort((a,b)=>a.businessName.localeCompare(b.businessName));
  return Object.freeze({generatedAt:new Date().toISOString(),summary:Object.freeze({vendorCount:rows.length,activeCount:rows.filter(row=>row.status==="active").length}),rows:Object.freeze(rows)});
}
const csv=(value)=>`"${String(value??"").replaceAll('"','""')}"`;
export function vendorContactListReportToCsv(report){const lines=[["Contractor ID","Business name","Contact name","Email","Phone","Trade","Status","Insurance expiration","W-9 status"]];
for(const row of report.rows)lines.push([row.contractorId,row.businessName,row.contactName,row.email,row.phone,row.trade,row.status,row.insuranceExpiration,row.w9Status]);
return lines.map(row=>row.map(csv).join(",")).join("\n");}
