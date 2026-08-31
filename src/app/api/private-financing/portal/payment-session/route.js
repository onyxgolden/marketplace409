import {NextResponse} from "next/server";
import {createClient} from "@/lib/supabase/server";
import {createRentalWebhookClient} from "@/lib/supabase/createRentalWebhookClient";
import {createStripeBillingProvider} from "@/infrastructure/billing/StripeBillingProvider";
import {validatePublishableKeyMode} from "@/infrastructure/billing/stripeMode";
const failure=(error,status)=>NextResponse.json({error},{status});
export async function POST(request){
 const auth=await createClient(),{data:{user}}=await auth.auth.getUser();if(!user?.id)return failure("Sign in to make a payment.",401);
 try{
  const body=await request.json(),accountId=typeof body.accountId==="string"?body.accountId.trim():"",amountCents=body.amountCents;
  if(!accountId||!Number.isSafeInteger(amountCents)||amountCents<=0)return failure("Account and a positive whole-cent amount are required.",400);
  const db=createRentalWebhookClient(),provider=createStripeBillingProvider();validatePublishableKeyMode(provider.mode);
  const borrowerResult=await db.from("private_financing_borrowers").select("owner_id,id,email,full_name").eq("auth_user_id",user.id).maybeSingle();
  if(borrowerResult.error)throw borrowerResult.error;const borrower=borrowerResult.data;if(!borrower)return failure("No borrower access is linked to this account.",403);
  const membershipResult=await db.from("private_financing_account_borrowers").select("status").eq("owner_id",borrower.owner_id).eq("account_id",accountId).eq("borrower_id",borrower.id).eq("status","active").maybeSingle();
  if(membershipResult.error)throw membershipResult.error;if(!membershipResult.data)return failure("This financing account is not available to this borrower.",403);
  const settings=await db.from("private_financing_online_payment_settings").select("enabled").eq("owner_id",borrower.owner_id).eq("account_id",accountId).maybeSingle();
  if(settings.error)throw settings.error;if(!settings.data?.enabled)return failure("Online payments are not active for this financing account.",409);
  const terms=await db.from("private_financing_current_account_terms").select("regular_scheduled_payment_amount_cents").eq("owner_id",borrower.owner_id).eq("account_id",accountId).maybeSingle();if(terms.error)throw terms.error;
  const policy=await db.from("private_financing_current_servicing_policy").select("payment_acceptance_policy").eq("owner_id",borrower.owner_id).eq("account_id",accountId).maybeSingle();if(policy.error)throw policy.error;
  const regular=Number(terms.data?.regular_scheduled_payment_amount_cents||0),rule=policy.data?.payment_acceptance_policy;
  if(rule==="exact_amount_only"&&amountCents!==regular)return failure(`This account currently accepts exactly $${(regular/100).toFixed(2)}.`,400);
  if(rule==="full_amount_or_more"&&amountCents<regular)return failure(`This account requires at least $${(regular/100).toFixed(2)}.`,400);
  const pending=await db.from("private_financing_online_payments").select("id").eq("owner_id",borrower.owner_id).eq("account_id",accountId).eq("borrower_id",borrower.id).in("status",["created","requires_payment_method","requires_action","processing"]).maybeSingle();if(pending.error)throw pending.error;if(pending.data)return failure("A payment is already pending for this account.",409);
  const account=await db.from("landlord_payment_accounts").select("*").eq("owner_id",borrower.owner_id).eq("provider","stripe").eq("provider_mode",provider.mode).maybeSingle();if(account.error)throw account.error;
  if(!account.data?.provider_account_id||account.data.status!=="enabled"||!account.data.charges_enabled||!account.data.payouts_enabled)return failure("The seller payment account is not ready.",409);
  let customerResult=await db.from("private_financing_billing_customers").select("*").eq("owner_id",borrower.owner_id).eq("borrower_id",borrower.id).eq("provider","stripe").eq("provider_mode",provider.mode).maybeSingle();if(customerResult.error)throw customerResult.error;let customer=customerResult.data;
  if(!customer){const created=await provider.createPrivateFinancingCustomer({ownerId:borrower.owner_id,connectedAccountId:account.data.provider_account_id},{borrowerId:borrower.id,email:borrower.email,displayName:borrower.full_name||borrower.email},`pf-customer:${provider.mode}:${borrower.owner_id}:${borrower.id}`);const saved=await db.from("private_financing_billing_customers").upsert({owner_id:borrower.owner_id,borrower_id:borrower.id,provider:"stripe",provider_mode:provider.mode,connected_account_id:account.data.provider_account_id,customer_id:created.customerId},{onConflict:"owner_id,borrower_id,provider,provider_mode"}).select("*").single();if(saved.error)throw saved.error;customer=saved.data;}
  const paymentId=`pf_payment_${crypto.randomUUID()}`,idempotencyKey=`pf:${provider.mode}:${accountId}:${paymentId}`,now=new Date().toISOString();
  const inserted=await db.from("private_financing_online_payments").insert({owner_id:borrower.owner_id,id:paymentId,account_id:accountId,borrower_id:borrower.id,provider:"stripe",provider_mode:provider.mode,provider_customer_id:customer.customer_id,amount_cents:amountCents,currency_code:"USD",status:"created",idempotency_key:idempotencyKey,created_at:now,updated_at:now}).select("*").single();if(inserted.error)throw inserted.error;
  try{const session=await provider.createPrivateFinancingPaymentSession({ownerId:borrower.owner_id,connectedAccountId:account.data.provider_account_id},{paymentId,accountId,borrowerId:borrower.id,customerId:customer.customer_id,amountCents,paymentMethods:account.data.card_payments_enabled?["us_bank_account","card"]:["us_bank_account"],idempotencyKey});await db.from("private_financing_online_payments").update({provider_payment_id:session.paymentIntentId,status:"requires_payment_method",updated_at:new Date().toISOString()}).eq("owner_id",borrower.owner_id).eq("id",paymentId);return NextResponse.json({success:true,clientSecret:session.clientSecret,connectedAccountId:session.connectedAccountId,paymentId,amountCents,returnUrl:`${request.nextUrl.origin}/forge/private-financing/portal?payment=returned`});}
  catch(error){await db.from("private_financing_online_payments").update({status:"failed",failure_code:"session_creation_failed",failure_message:"Payment session could not be created.",updated_at:new Date().toISOString()}).eq("owner_id",borrower.owner_id).eq("id",paymentId);throw error;}
 }catch(error){console.error("Private financing payment session error",{name:error?.name||"Error"});return failure("Unable to start the financing payment.",500);}
}
