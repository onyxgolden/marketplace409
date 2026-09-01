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

// Builds "/auth?next=/forge/private-financing/portal[&email=...]" -- the invited email (read from
// this request's own ?email= query param, set by the invitation link) rides along so the sign-in
// page can pre-fill and lock it, and so a mismatch can be explained by comparing it against
// whichever email the borrower actually authenticates with.
function signInUrl(invitedEmail) {
  const params = new URLSearchParams({ next: "/forge/private-financing/portal" });
  if (invitedEmail) params.set("email", invitedEmail);
  return `/auth?${params.toString()}`;
}

export async function GET(request) {
  const invitedEmail = new URL(request.url).searchParams.get("email")?.trim().toLowerCase() || null;
  const db=await createClient();
  const {data:{user},error:authError}=await db.auth.getUser();
  if(authError||!user?.id)return NextResponse.json({error:"Sign in to view your financing account.",signInUrl:signInUrl(invitedEmail),invitedEmail},{status:401});
  const claim=await db.rpc("claim_private_financing_borrower_portal");
  const memberships=await db.from("private_financing_account_borrowers").select("account_id,role,status").eq("status","active");
  if(memberships.error)return NextResponse.json({error:"Unable to load borrower access."},{status:500});
  // A repeat claim must never hide an already-active account. This matters when a borrower opens an
  // older invitation after access was activated, or when the claim RPC encounters a transient error
  // after the membership became readable through RLS. It also makes retrying this route exact: a
  // second call with nothing new to claim (claimedIdentityCount/activatedMembershipCount both 0)
  // still returns the same already-active accounts, never an error or a duplicate.
  if(claim.error&&!(memberships.data||[]).length){
    console.error("Private financing borrower claim failed",{code:claim.error.code||"unknown"});
    return NextResponse.json({error:"Unable to match this signed-in account to a borrower invitation.",signedInEmail:user.email||null,invitedEmail,claimErrorCode:claim.error.code||"unknown",signInUrl:signInUrl(invitedEmail)},{status:400});
  }
  // Authenticated, claim ran clean, but nothing matched -- almost always because the signed-in
  // email differs from the one this invitation was sent to (the claim RPC only links a borrower
  // identity to auth.uid() when they match). Surface both emails on the success payload so the
  // frontend can explain exactly what to fix, instead of a bare "no accounts".
  const mismatched = Boolean(!(memberships.data||[]).length && invitedEmail && user.email && invitedEmail !== user.email.toLowerCase());
  const accounts=[];
  for(const membership of memberships.data||[]){
    const [accountResult,eventResult,termsResult,settingsResult]=await Promise.all([
      db.from("private_financing_accounts").select("id,product,status,opened_date,origination_principal_cents").eq("id",membership.account_id).maybeSingle(),
      db.rpc("read_private_financing_borrower_events",{p_account_id:membership.account_id}),
      db.from("private_financing_current_account_terms").select("regular_scheduled_payment_amount_cents").eq("account_id",membership.account_id).maybeSingle(),
      db.from("private_financing_online_payment_settings").select("enabled").eq("account_id",membership.account_id).maybeSingle(),
    ]);
    if(accountResult.data&&!eventResult.error)accounts.push({account:accountResult.data,role:membership.role,summary:summarizeBorrowerEvents(eventResult.data||[]),events:eventResult.data||[],regularScheduledPaymentCents:Number(termsResult.data?.regular_scheduled_payment_amount_cents||0),onlinePaymentsEnabled:settingsResult.data?.enabled===true});
  }
  return NextResponse.json({success:true,email:user.email,invitedEmail,mismatched,accounts,claim:claim.data||null});
}
