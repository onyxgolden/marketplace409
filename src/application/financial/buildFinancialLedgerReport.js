const SIGNS={income:1,expense:-1,asset_purchase:-1};
export function buildFinancialLedgerReport({events=[]},{propertyId="",startDate="",endDate=""}={}){
  const active=events.filter(event=>event.status!=="inactive"&&event.status!=="deleted"&&event.is_deleted!==true);
  const propertyIds=Object.freeze([...new Set(active.map(event=>event.property_id||"unassigned"))].sort());
  const scoped=active.filter(event=>(!propertyId||(event.property_id||"unassigned")===propertyId)&&(!startDate||event.event_date>=startDate)&&(!endDate||event.event_date<=endDate));
  const sorted=[...scoped].sort((a,b)=>a.event_date<b.event_date?-1:a.event_date>b.event_date?1:String(a.id)<String(b.id)?-1:String(a.id)>String(b.id)?1:0);
  let balance=0;
  const rows=sorted.map(event=>{
    const amount=Math.abs(Number(event.amount));const sign=SIGNS[event.transaction_kind]??0;balance+=sign*amount;
    return Object.freeze({id:event.id,date:event.event_date,description:event.description,category:event.normalized_category,
      propertyId:event.property_id||"unassigned",transactionKind:event.transaction_kind,
      debit:sign<0?amount:0,credit:sign>0?amount:0,balance});
  });
  return Object.freeze({generatedAt:new Date().toISOString(),propertyId:propertyId||null,startDate:startDate||null,endDate:endDate||null,
    availableProperties:propertyIds,
    summary:Object.freeze({transactionCount:rows.length,totalDebits:rows.reduce((sum,row)=>sum+row.debit,0),
      totalCredits:rows.reduce((sum,row)=>sum+row.credit,0),endingBalance:balance}),rows:Object.freeze(rows)});
}
const money=(value)=>value.toFixed(2);const csv=(value)=>`"${String(value??"").replaceAll('"','""')}"`;
export function financialLedgerReportToCsv(report){const lines=[["Date","Description","Category","Property","Debit","Credit","Balance"]];
for(const row of report.rows)lines.push([row.date,row.description,row.category,row.propertyId,row.debit?money(row.debit):"",row.credit?money(row.credit):"",money(row.balance)]);
return lines.map(row=>row.map(csv).join(",")).join("\n");}
