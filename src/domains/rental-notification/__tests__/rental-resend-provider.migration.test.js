import { readFileSync } from "node:fs";import { describe, expect, it } from "vitest";
const sql=readFileSync("supabase/migrations/20260814000100_allow_resend_rental_email_provider.sql","utf8").toLowerCase();
describe("rental Resend provider migration",()=>it("allows Resend while preserving explicit legacy provider state",()=>{expect(sql).toContain("set default 'resend'");expect(sql).toContain("provider in ('http','resend')")}));
