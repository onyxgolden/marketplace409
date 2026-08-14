import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/createRentalWebhookClient", () => ({ createRentalWebhookClient: vi.fn() }));
vi.mock("@/infrastructure/notifications/ResendRentalEmailProvider", () => ({ createResendRentalEmailProvider: vi.fn() }));
import { createRentalWebhookClient } from "@/lib/supabase/createRentalWebhookClient";
import { createResendRentalEmailProvider } from "@/infrastructure/notifications/ResendRentalEmailProvider";
import { POST } from "./route";

const notification={id:"notice_1",owner_id:"owner_1",recipient:"tenant@example.com",subject:"Rent reminder",body_text:"Rent is due."};
function database(provider="resend") { const rpc=vi.fn(async(name)=>name==="claim_rental_email_notification"?{data:notification,error:null}:{data:null,error:null}),single=vi.fn(async()=>({data:{provider,sender_name:"FORGE Rentals",sender_email:"rentals@mail.409marketplace.online",status:"active"},error:null}));return{rpc,from:vi.fn(()=>({select:()=>({eq:()=>({eq:()=>({single})})})}))}; }
describe("rental email delivery", () => {
  beforeEach(()=>{vi.clearAllMocks();process.env.RENTAL_NOTIFICATION_DELIVERY_SECRET="secret"});
  it("rejects callers without the delivery secret",async()=>expect((await POST(new Request("https://test",{method:"POST"}))).status).toBe(401));
  it("sends a claimed message through Resend and completes the outbox record",async()=>{const db=database(),send=vi.fn(async()=>({messageId:"email_1"}));createRentalWebhookClient.mockReturnValue(db);createResendRentalEmailProvider.mockReturnValue({send});const response=await POST(new Request("https://test",{method:"POST",headers:{authorization:"Bearer secret"}}));expect(response.status).toBe(200);expect(send).toHaveBeenCalledWith(expect.objectContaining({id:"notice_1",recipient:"tenant@example.com"}));expect(db.rpc).toHaveBeenCalledWith("complete_rental_email_delivery",expect.objectContaining({p_succeeded:true,p_provider_message_id:"email_1"}))});
  it("fails closed and releases a claimed message when the provider is not approved",async()=>{const db=database("http");createRentalWebhookClient.mockReturnValue(db);const response=await POST(new Request("https://test",{method:"POST",headers:{authorization:"Bearer secret"}}));expect(response.status).toBe(502);expect(createResendRentalEmailProvider).not.toHaveBeenCalled();expect(db.rpc).toHaveBeenCalledWith("complete_rental_email_delivery",expect.objectContaining({p_succeeded:false}))});
});
