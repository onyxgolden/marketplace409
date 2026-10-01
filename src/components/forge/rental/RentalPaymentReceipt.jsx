import { formatFeePercent } from "@/domains/rental-payment/convenienceFee";
const money=new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"});
const date=new Intl.DateTimeFormat("en-US",{month:"long",day:"numeric",year:"numeric"});
export function buildRentalReceiptNumber(payment){return payment.receiptReference||`FORGE-${payment.id.replace(/^rental_payment_/,"").slice(0,12).toUpperCase()}`;}
export default function RentalPaymentReceipt({payment,tenantName,unitLabel,onClose}){
  // R12: when a card convenience fee was charged, the receipt breaks the
  // total into rent + fee so the tenant sees exactly what the fee was. The
  // fee reimburses the landlord's card-processing cost -- it is not rent.
  const feeCents=Number(payment.convenienceFeeCents)||0;
  const rentCents=(Number(payment.amountCents)||0)-feeCents;
  const bps=Number(payment.convenienceFeeBps)||0;
  const feePercentLabel=bps>0?formatFeePercent(bps):null;
  return <article className="rounded-2xl border bg-white p-6 shadow-sm print:border-0 print:shadow-none">
  <div className="flex items-start justify-between gap-4"><div><p className="text-sm font-bold uppercase tracking-widest text-amber-700">FORGE rent receipt</p><h2 className="mt-2 text-2xl font-black">Payment received</h2></div><button onClick={onClose} className="rounded-lg border px-3 py-2 text-sm font-bold print:hidden">Close</button></div>
  <dl className="mt-6 grid grid-cols-2 gap-4 text-sm"><div><dt className="text-slate-500">Receipt number</dt><dd className="font-bold">{buildRentalReceiptNumber(payment)}</dd></div><div><dt className="text-slate-500">Status</dt><dd className="font-bold capitalize">{payment.status}</dd></div>
    <div><dt className="text-slate-500">Tenant</dt><dd className="font-bold">{tenantName}</dd></div><div><dt className="text-slate-500">Rental</dt><dd className="font-bold">{unitLabel}</dd></div>
    <div><dt className="text-slate-500">Date received</dt><dd className="font-bold">{date.format(new Date(payment.receivedAt||payment.succeededAt||payment.createdAt))}</dd></div><div><dt className="text-slate-500">Amount</dt><dd className="text-xl font-black">{money.format(payment.amountCents/100)}</dd></div>
    {feeCents>0?<>
      <div><dt className="text-slate-500">Rent paid</dt><dd className="font-bold">{money.format(rentCents/100)}</dd></div>
      <div><dt className="text-slate-500">Card convenience fee{feePercentLabel?` (${feePercentLabel})`:""}</dt><dd className="font-bold">{money.format(feeCents/100)}</dd></div>
    </>:null}
    <div><dt className="text-slate-500">Payment method</dt><dd className="font-bold capitalize">{(payment.paymentMethod||"online payment").replaceAll("_"," ")}</dd></div><div><dt className="text-slate-500">Payment ID</dt><dd className="break-all font-mono text-xs">{payment.id}</dd></div></dl>
  {feeCents>0?<p className="mt-4 text-xs text-slate-500">The convenience fee reimburses the landlord&apos;s card-processing cost — it is not part of your rent.</p>:null}
  <p className="mt-6 border-t pt-4 text-xs text-slate-500">This receipt confirms the payment status recorded by FORGE. Keep it with your rental records.</p>
  <button onClick={()=>window.print()} className="mt-5 rounded-lg bg-slate-950 px-5 py-3 font-bold text-white print:hidden">Print or save as PDF</button>
  </article>;}

