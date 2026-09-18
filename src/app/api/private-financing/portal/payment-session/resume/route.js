import {NextResponse} from "next/server";
import {createClient} from "@/lib/supabase/server";
import {createRentalWebhookClient} from "@/lib/supabase/createRentalWebhookClient";
import {createStripeBillingProvider} from "@/infrastructure/billing/StripeBillingProvider";
import {validatePublishableKeyMode} from "@/infrastructure/billing/stripeMode";
const failure=(error,status)=>NextResponse.json({error},{status});
// "processing" is deliberately excluded -- Stripe is actively settling that attempt (e.g. an ACH
// debit in flight), and issuing a fresh client secret for it here would risk a second submission
// against the same PaymentIntent. Mirrors rental's own resume route (payment-session/resume).
export const RESUMABLE_STATUSES=["created","requires_payment_method","requires_action"];
export async function POST(request){
 const auth=await createClient(),{data:{user}}=await auth.auth.getUser();if(!user?.id)return failure("Sign in to make a payment.",401);
 try{
  const body=await request.json(),paymentId=typeof body.paymentId==="string"?body.paymentId.trim():"";
  if(!paymentId)return failure("paymentId is required.",400);
  const db=createRentalWebhookClient(),provider=createStripeBillingProvider();validatePublishableKeyMode(provider.mode);
  const borrowerResult=await db.from("private_financing_borrowers").select("owner_id,id").eq("auth_user_id",user.id).maybeSingle();
  if(borrowerResult.error)throw borrowerResult.error;const borrower=borrowerResult.data;if(!borrower)return failure("No borrower access is linked to this account.",403);
  const paymentResult=await db.from("private_financing_online_payments").select("*").eq("owner_id",borrower.owner_id).eq("id",paymentId).maybeSingle();
  if(paymentResult.error)throw paymentResult.error;const payment=paymentResult.data;
  if(!payment||payment.borrower_id!==borrower.id)return failure("Payment was not found for this borrower.",404);
  if(!RESUMABLE_STATUSES.includes(payment.status))return failure("This payment can no longer be resumed.",409);
  if(!payment.provider_payment_id)return failure("This payment has no associated Stripe payment intent.",409);
  const account=await db.from("landlord_payment_accounts").select("*").eq("owner_id",borrower.owner_id).eq("provider","stripe").eq("provider_mode",provider.mode).maybeSingle();
  if(account.error)throw account.error;if(!account.data?.provider_account_id)return failure("The seller payment account is not ready.",409);
  const intent=await provider.retrievePaymentIntent({connectedAccountId:account.data.provider_account_id},payment.provider_payment_id);
  if(!intent.clientSecret)return failure("Stripe did not return a payment client secret.",502);
  return NextResponse.json({success:true,clientSecret:intent.clientSecret,connectedAccountId:account.data.provider_account_id,
   paymentId:payment.id,amountCents:Number(payment.amount_cents),
   returnUrl:`${request.nextUrl.origin}/forge/private-financing/portal?payment=returned`});
 }catch(error){console.error("Private financing payment resume error",{name:error?.name||"Error"});return failure("Unable to resume the financing payment.",500);}
}
