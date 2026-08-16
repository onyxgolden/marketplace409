export function buildVendorLedgerReport({contractors=[],contractorPayments=[]},{contractorId="",startDate="",endDate=""}={}){
  const contractorById=new Map(contractors.map(item=>[item.id,item]));
  const scoped=contractorPayments.filter(payment=>(!contractorId||payment.contractor_id===contractorId)&&(!startDate||payment.paid_at>=startDate)&&(!endDate||payment.paid_at<=endDate));
  const rows=scoped.map(payment=>Object.freeze({paymentId:payment.id,contractorId:payment.contractor_id,businessName:contractorById.get(payment.contractor_id)?.business_name||payment.contractor_id,
    propertyId:payment.property_id||"",paidAt:payment.paid_at,amountCents:Number(payment.amount_cents),paymentMethod:payment.payment_method||"",
    reference:payment.reference||"",invoiceReference:payment.invoice_reference||"",workOrderId:payment.work_order_id||""}))
    .sort((a,b)=>a.paidAt<b.paidAt?-1:a.paidAt>b.paidAt?1:0);
  return Object.freeze({generatedAt:new Date().toISOString(),contractorId:contractorId||null,startDate:startDate||null,endDate:endDate||null,
    availableContractors:Object.freeze(contractors.map(c=>Object.freeze({id:c.id,businessName:c.business_name})).sort((a,b)=>a.businessName.localeCompare(b.businessName))),
    summary:Object.freeze({paymentCount:rows.length,totalPaidCents:rows.reduce((sum,row)=>sum+row.amountCents,0)}),rows:Object.freeze(rows)});
}
const csv=(value)=>`"${String(value??"").replaceAll('"','""')}"`;
export function vendorLedgerReportToCsv(report){const lines=[["Payment ID","Contractor","Property ID","Paid date","Amount","Method","Reference","Invoice reference","Work order"]];
for(const row of report.rows)lines.push([row.paymentId,row.businessName,row.propertyId,row.paidAt,(row.amountCents/100).toFixed(2),row.paymentMethod,row.reference,row.invoiceReference,row.workOrderId]);
return lines.map(row=>row.map(csv).join(",")).join("\n");}
