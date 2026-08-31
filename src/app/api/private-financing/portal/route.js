import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export function summarizeBorrowerEvents(events) {
  const payments=events.filter(e=>e.event_type==="payment_posted");
  let interestBearing=0,zeroInterest=0;
  for(const event of events){
    if(event.principal_remaining_interest_bearing_cents!=null)interestBearing=Number(event.principal_remaining_interest_bearing_cents);
    if(event.principal_remaining_zero_interest_cents!=null)zeroInterest=Number(event.principal_remaining_zero_interest_cents);
    if(event.corrected_component_principal_remaining_cents_after!=null){
      if(event.component_type==="interest_bearing")interestBearing=Number(event.corrected_component_principal_remaining_cents_after);
      if(event.component_type==="zero_interest")zeroInterest=Number(event.corrected_component_principal_remaining_cents_after);
    }
    if(event.corrected_component_principal_remaining_cents_after==null){
      if(event.interest_bearing_delta_cents!=null)interestBearing+=Number(event.interest_bearing_delta_cents);
      if(event.zero_interest_delta_cents!=null)zeroInterest+=Number(event.zero_interest_delta_cents);
    }
  }
  return {paymentCount:payments.length,totalPaidCents:payments.reduce((n,e)=>n+Number(e.amount_cents||0),0),interestPaidCents:payments.reduce((n,e)=>n+Number(e.interest_paid_cents||0),0),principalRemainingCents:interestBearing+zeroInterest};
}

export async function GET() {
  const db=await createClient();
  const {data:{user},error:authError}=await db.auth.getUser();
  if(authError||!user?.id)return NextResponse.json({error:"Sign in to view your financing account.",signInUrl:"/auth?next=/forge/private-financing/portal"},{status:401});
  const claim=await db.rpc("claim_private_financing_borrower_portal");
  if(claim.error)return NextResponse.json({error:"Unable to claim borrower access with this signed-in email."},{status:400});
  const memberships=await db.from("private_financing_account_borrowers").select("account_id,role,status").eq("status","active");
  if(memberships.error)return NextResponse.json({error:"Unable to load borrower access."},{status:500});
  const accounts=[];
  for(const membership of memberships.data||[]){
    const [accountResult,eventResult]=await Promise.all([
      db.from("private_financing_accounts").select("id,product,status,opened_date,origination_principal_cents").eq("id",membership.account_id).maybeSingle(),
      db.rpc("read_private_financing_borrower_events",{p_account_id:membership.account_id}),
    ]);
    if(accountResult.data&&!eventResult.error)accounts.push({account:accountResult.data,role:membership.role,summary:summarizeBorrowerEvents(eventResult.data||[]),events:eventResult.data||[]});
  }
  return NextResponse.json({success:true,email:user.email,accounts,claim:claim.data});
}
