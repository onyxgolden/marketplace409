import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const sql = fs.readFileSync(
  path.join(process.cwd(), "supabase/migrations/20260930235500_rental_work_order_messaging.sql"), "utf8");

describe("work-order messaging migration", () => {
  it("attaches work-order threads to the existing conversation tables", () => {
    expect(sql).toContain("add column if not exists work_order_id text");
    expect(sql).toContain("uq_rental_conversations_work_order");
    expect(sql).toContain("uq_rental_conversations_general");
    expect(sql).toContain("where work_order_id is not null");
    expect(sql).toContain("where work_order_id is null");
    // The outbox stays a single table -- the new ping reuses it, no new email infrastructure.
    expect(sql).toContain("work_order_message");
  });

  it("provides owner and tenant message RPCs plus read receipts", () => {
    expect(sql).toContain("send_rental_work_order_owner_message");
    expect(sql).toContain("send_rental_work_order_tenant_message");
    expect(sql).toContain("mark_rental_work_order_read_by_owner");
    expect(sql).toContain("mark_rental_work_order_read_by_tenant");
    expect(sql).toContain("read_rental_work_order_tenant_messages");
  });

  it("keeps the threads strictly two-party and owner-scoped", () => {
    // Tenant RPCs resolve the tenant from auth and join through the request's tenant --
    // a tenant can never address another tenant's work order.
    expect(sql).toContain("r.tenant_id = v_tenant.id");
    // Owner messages always go to the request's own tenant, derived from the work order's
    // request row -- never an arbitrary recipient from the client.
    expect(sql).toContain("v_request.tenant_id");
    // Message bodies are guarded against empty input on both sides, matching the
    // general thread RPCs (no max-length cap -- same as the existing threads).
    expect(sql).toContain("length(btrim(coalesce(p_body, ''))) = 0");
  });

  it("resolves the owner notification email without exposing it to tenants", () => {
    expect(sql).toContain("get_rental_owner_notification_email");
    // No owner-id argument: the RPC resolves the landlord from the caller's own tenant row,
    // so there is nothing to harvest and the RPC result shape carries only an id for the
    // read audit, never an address.
    expect(sql).toContain("get_rental_owner_notification_email()");
    expect(sql).not.toContain("get_rental_owner_notification_email(p_owner_id");
    expect(sql).toContain("security definer");
  });

  it("opens a work-order thread by marking it read, matching the general inbox", () => {
    expect(sql).toContain("owner_last_read_at = now()");
    expect(sql).toContain("tenant_last_read_at = now()");
    expect(sql).toContain("work_order_id = p_work_order_id");
  });

  it("grants execute only to the roles each RPC is meant for", () => {
    expect(sql).toContain("grant execute on function send_rental_work_order_tenant_message");
    expect(sql).toContain("grant execute on function read_rental_work_order_tenant_messages");
    expect(sql).toContain("grant execute on function mark_rental_work_order_read_by_tenant");
    expect(sql).toContain("grant execute on function get_rental_owner_notification_email()");
    // Owner RPCs stay owner-side: the tenant send/read RPCs resolve the tenant from auth,
    // and the owner send RPC requires workspace access internally.
    expect(sql).toContain("has_workspace_access(v_owner_id)");
  });
});
