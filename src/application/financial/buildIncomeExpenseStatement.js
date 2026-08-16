const SIGNS={income:1,expense:-1};
function addTotals(target,event,amount){
  const sign=SIGNS[event.transaction_kind]??0;
  target.income+=event.transaction_kind==="income"?amount:0;
  target.expenses+=event.transaction_kind==="expense"?amount:0;
  target.net+=sign*amount;
  if(event.affects_noi===true)target.noi+=sign*amount;
}
const emptyTotals=()=>({income:0,expenses:0,net:0,noi:0});
export function buildIncomeExpenseStatement({events=[]},{startDate="",endDate="",propertyId=""}={}){
  const activeAll=events.filter(event=>event.status!=="inactive"&&event.status!=="deleted"&&event.is_deleted!==true);
  const propertyIds=Object.freeze([...new Set(activeAll.map(event=>event.property_id||"unassigned"))].sort());
  const active=activeAll.filter(event=>event.transaction_kind!=="asset_purchase");
  const scoped=active.filter(event=>(!propertyId||(event.property_id||"unassigned")===propertyId)&&(!startDate||event.event_date>=startDate)&&(!endDate||event.event_date<=endDate));
  const summary=emptyTotals();
  const categoryTotals=new Map();const propertyTotals=new Map();
  for(const event of scoped){
    const amount=Math.abs(Number(event.amount));
    addTotals(summary,event,amount);
    const category=event.normalized_category||"other";
    if(!categoryTotals.has(category))categoryTotals.set(category,emptyTotals());
    addTotals(categoryTotals.get(category),event,amount);
    const property=event.property_id||"unassigned";
    if(!propertyTotals.has(property))propertyTotals.set(property,emptyTotals());
    addTotals(propertyTotals.get(property),event,amount);
  }
  const byCategory=Object.freeze([...categoryTotals.entries()].map(([category,totals])=>Object.freeze({category,...totals})).sort((a,b)=>b.expenses+b.income-(a.expenses+a.income)));
  const byProperty=Object.freeze([...propertyTotals.entries()].map(([property,totals])=>Object.freeze({propertyId:property,...totals})).sort((a,b)=>a.propertyId.localeCompare(b.propertyId)));
  return Object.freeze({generatedAt:new Date().toISOString(),startDate:startDate||null,endDate:endDate||null,propertyId:propertyId||null,
    availableProperties:propertyIds,summary:Object.freeze(summary),byCategory,byProperty});
}
const csv=(value)=>`"${String(value??"").replaceAll('"','""')}"`;const money=(value)=>value.toFixed(2);
export function incomeExpenseStatementToCsv(report){
  const lines=[["Section","Key","Income","Expenses","Net","NOI"]];
  lines.push(["Total","All",money(report.summary.income),money(report.summary.expenses),money(report.summary.net),money(report.summary.noi)]);
  for(const row of report.byProperty)lines.push(["Property",row.propertyId,money(row.income),money(row.expenses),money(row.net),money(row.noi)]);
  for(const row of report.byCategory)lines.push(["Category",row.category,money(row.income),money(row.expenses),money(row.net),money(row.noi)]);
  return lines.map(row=>row.map(csv).join(",")).join("\n");
}
