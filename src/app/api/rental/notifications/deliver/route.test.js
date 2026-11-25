import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/createRentalWebhookClient", () => ({ createRentalWebhookClient: vi.fn() }));
vi.mock("@/infrastructure/notifications/ResendRentalEmailProvider", () => ({ createResendRentalEmailProvider: vi.fn() }));
import { createRentalWebhookClient } from "@/lib/supabase/createRentalWebhookClient";
import { createResendRentalEmailProvider } from "@/infrastructure/notifications/ResendRentalEmailProvider";
import { POST } from "./route";

const notification={id:"notice_1",owner_id:"owner_1",recipient:"tenant@example.com",subject:"Rent reminder",body_text:"Rent is due."};
// Claim-once semantics, like the real RPC: each queued row is claimed at most
// once per invocation; later claims return no row so the drain loop stops.
function database(provider="resend", claimable=[notification]) {
  const queue=[...claimable];
  const rpc=vi.fn(async(name)=>{
    if(name==="claim_rental_email_notification") return {data: queue.shift() || null, error:null};
    return {data:null,error:null};
  });
  const single=vi.fn(async()=>({data:{provider,sender_name:"FORGE Rentals",sender_email:"rentals@mail.409marketplace.online",status:"active"},error:null}));
  return {rpc,from:vi.fn(()=>({select:()=>({eq:()=>({eq:()=>({single})})})}))};
}
describe("rental email delivery", () => {
  beforeEach(()=>{vi.clearAllMocks();delete process.env.NEXT_PUBLIC_SITE_URL;delete process.env.CRON_SECRET;process.env.RENTAL_NOTIFICATION_DELIVERY_SECRET="secret"});
  it("rejects callers without the delivery secret",async()=>expect((await POST(new Request("https://test",{method:"POST"}))).status).toBe(401));
  it("rejects callers with the wrong secret",async()=>expect((await POST(new Request("https://test",{method:"POST",headers:{authorization:"Bearer nope"}}))).status).toBe(401));
  it("accepts the Vercel cron secret",async()=>{
    process.env.CRON_SECRET="cron-secret";delete process.env.RENTAL_NOTIFICATION_DELIVERY_SECRET;
    const db=database("resend",[]);createRentalWebhookClient.mockReturnValue(db);
    const response=await POST(new Request("https://test",{method:"POST",headers:{authorization:"Bearer cron-secret"}}));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expect.objectContaining({success:true,delivered:false,deliveredCount:0}));
  });
  it("sends a claimed message through Resend and completes the outbox record",async()=>{const db=database(),send=vi.fn(async()=>({messageId:"email_1"}));createRentalWebhookClient.mockReturnValue(db);createResendRentalEmailProvider.mockReturnValue({send});const response=await POST(new Request("https://test",{method:"POST",headers:{authorization:"Bearer secret"}}));expect(response.status).toBe(200);expect(await response.json()).toEqual(expect.objectContaining({delivered:true,deliveredCount:1,notificationIds:["notice_1"]}));expect(send).toHaveBeenCalledWith(expect.objectContaining({id:"notice_1",recipient:"tenant@example.com"}));expect(db.rpc).toHaveBeenCalledWith("complete_rental_email_delivery",expect.objectContaining({p_succeeded:true,p_provider_message_id:"email_1"}))});
  it("drains multiple queued rows in one invocation",async()=>{
    const second={...notification,id:"notice_2",recipient:"other@example.com"};
    const db=database("resend",[notification,second]);
    const send=vi.fn(async()=>({messageId:"email_1"}));createRentalWebhookClient.mockReturnValue(db);createResendRentalEmailProvider.mockReturnValue({send});
    const response=await POST(new Request("https://test",{method:"POST",headers:{authorization:"Bearer secret"}}));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expect.objectContaining({delivered:true,deliveredCount:2,notificationIds:["notice_1","notice_2"]}));
    expect(send).toHaveBeenCalledTimes(2);
  });
  it("fails closed and releases a claimed message when the provider is not approved",async()=>{const db=database("http");createRentalWebhookClient.mockReturnValue(db);const response=await POST(new Request("https://test",{method:"POST",headers:{authorization:"Bearer secret"}}));expect(response.status).toBe(502);expect(createResendRentalEmailProvider).not.toHaveBeenCalled();expect(db.rpc).toHaveBeenCalledWith("complete_rental_email_delivery",expect.objectContaining({p_succeeded:false}))});
  it("delivers a guest confirmation with an absolute private access link when the tenant outbox is empty",async()=>{const confirmation={...notification,id:"confirmation_1",recipient:"guest@example.com",body_text:"Access: /book/stay-safe/access/private"};const db=database();let claimed=false;db.rpc=vi.fn(async name=>{if(name==="claim_rental_email_notification")return{data:null,error:null};if(name==="claim_reservation_confirmation"){if(claimed)return{data:null,error:null};claimed=true;return{data:confirmation,error:null};}return{data:null,error:null};});createRentalWebhookClient.mockReturnValue(db);const send=vi.fn(async()=>({messageId:"email_2"}));createResendRentalEmailProvider.mockReturnValue({send});const response=await POST(new Request("https://test",{method:"POST",headers:{authorization:"Bearer secret"}}));expect(response.status).toBe(200);expect(send).toHaveBeenCalledTimes(1);expect(send).toHaveBeenCalledWith(expect.objectContaining({bodyText:"Access: https://409marketplace.online/book/stay-safe/access/private"}));expect(db.rpc).toHaveBeenCalledWith("complete_reservation_confirmation",expect.objectContaining({p_id:"confirmation_1",p_succeeded:true}))});
});
