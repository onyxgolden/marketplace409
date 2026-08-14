import { describe, expect, it, vi } from "vitest";
import { createResendRentalEmailProvider } from "./ResendRentalEmailProvider";
describe("Resend rental email provider", () => {
  it("requires a server-side Resend API key", () => expect(() => createResendRentalEmailProvider({}, vi.fn())).toThrow("RESEND_API_KEY"));
  it("uses the verified sender format and an idempotency key", async () => { const request=vi.fn(async()=>new Response(JSON.stringify({id:"email_1"}),{status:200})),provider=createResendRentalEmailProvider({RESEND_API_KEY:"re_secret"},request);await expect(provider.send({id:"notice_1",senderName:"FORGE Rentals",senderEmail:"rentals@mail.409marketplace.online",recipient:"tenant@example.com",subject:"Rent reminder",bodyText:"Rent is due."})).resolves.toEqual({messageId:"email_1"});const options=request.mock.calls[0][1],body=JSON.parse(options.body);expect(options.headers.authorization).toBe("Bearer re_secret");expect(options.headers["Idempotency-Key"]).toBe("rental-notice_1");expect(body).toEqual(expect.objectContaining({from:"FORGE Rentals <rentals@mail.409marketplace.online>",to:["tenant@example.com"],text:"Rent is due."}))});
});
