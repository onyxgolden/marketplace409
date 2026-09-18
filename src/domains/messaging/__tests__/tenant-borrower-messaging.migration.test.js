import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260918000000_add_tenant_borrower_messaging.sql"), "utf8")
  .toLowerCase().replace(/\s+/g, " ");

describe("tenant/borrower messaging migration", () => {
  it("stores exactly one continuous conversation per owner+tenant and per owner+borrower relationship", () => {
    expect(sql).toContain("create table if not exists rental_conversations");
    expect(sql).toContain("unique (owner_id, tenant_id)");
    expect(sql).toContain("create table if not exists private_financing_conversations");
    expect(sql).toContain("unique (owner_id, borrower_id)");
  });

  it("requires a non-empty message body and only allows the two optional categories", () => {
    expect(sql).toContain("body text not null check (btrim(body) <> '')");
    expect(sql).toContain("category text check (category is null or category in ('issue', 'suggestion'))");
  });

  it("protects every table with forced RLS and read-only policies -- no insert/update/delete grant to any role", () => {
    for (const table of ["rental_conversations", "rental_conversation_messages", "private_financing_conversations", "private_financing_conversation_messages"]) {
      expect(sql).toContain(`alter table ${table} enable row level security`);
      expect(sql).toContain(`alter table ${table} force row level security`);
      expect(sql).not.toMatch(new RegExp(`create policy[^;]*${table}[^;]*for (insert|update|delete)`));
    }
  });

  it("grants the table-level select authenticated needs -- RLS policies alone are not sufficient in Postgres", () => {
    expect(sql).toContain("grant select on rental_conversations to authenticated");
    expect(sql).toContain("grant select on rental_conversation_messages to authenticated");
    expect(sql).toContain("grant select on private_financing_conversations to authenticated");
    expect(sql).toContain("grant select on private_financing_conversation_messages to authenticated");
  });

  it("owner visibility uses workspace access; tenant/borrower visibility matches their own linked identity", () => {
    expect(sql).toContain('create policy "rental_conversations_owner_select" on rental_conversations for select to authenticated using (has_workspace_access(owner_id))');
    expect(sql).toContain("t.owner_id = rental_conversations.owner_id and t.id = rental_conversations.tenant_id and t.auth_user_id = auth.uid()");
    expect(sql).toContain('create policy "pf_conversations_owner_select" on private_financing_conversations for select to authenticated using (has_workspace_access(owner_id))');
    expect(sql).toContain("b.owner_id = private_financing_conversations.owner_id and b.id = private_financing_conversations.borrower_id and b.auth_user_id = auth.uid()");
  });

  it("owner-authored messages derive owner identity server-side via resolve_effective_owner_id -- never a client-supplied owner id", () => {
    expect(sql).toContain("create or replace function send_rental_conversation_owner_message(p_tenant_id text, p_body text)");
    expect(sql).toContain("v_owner_id text := resolve_effective_owner_id()");
    expect(sql).toContain("create or replace function send_pf_conversation_owner_message(p_borrower_id text, p_body text)");
  });

  it("a borrower may disambiguate which of their own owner relationships to act under, but only when more than one exists", () => {
    expect(sql).toContain("create or replace function send_pf_conversation_borrower_message(p_body text, p_category text default null, p_owner_id text default null)");
    expect(sql).toContain("create or replace function mark_pf_conversation_read_by_borrower(p_owner_id text default null)");
    expect(sql).toContain("raise exception 'multiple borrower relationships exist; an owner id is required.'");
  });

  it("tenant/borrower-authored messages derive their own identity from auth.uid(), never a client-supplied tenant/borrower id", () => {
    expect(sql).toContain("create or replace function send_rental_conversation_tenant_message(p_body text, p_category text default null)");
    expect(sql).toContain("select * into v_tenant from rental_tenants where auth_user_id = auth.uid()");
    expect(sql).toContain("create or replace function send_pf_conversation_borrower_message(p_body text, p_category text default null, p_owner_id text default null)");
    expect(sql).toContain("select * into v_borrower from private_financing_borrowers where auth_user_id = auth.uid()");
    expect(sql).not.toContain("p_tenant_id text, p_body text, p_category");
    expect(sql).not.toContain("p_borrower_id text, p_body text, p_category");
  });

  it("rejects an unrecognized message category from a tenant or borrower", () => {
    expect(sql).toContain("if p_category is not null and p_category not in ('issue', 'suggestion') then");
    expect(sql).toContain("raise exception 'invalid message category.'");
  });

  it("owner messages are never categorized -- the owner-side insert never sets a category value", () => {
    expect(sql).toContain("insert into rental_conversation_messages (owner_id, id, conversation_id, sender_type, body, created_at) values (v_owner_id");
    expect(sql).toContain("insert into private_financing_conversation_messages (owner_id, id, conversation_id, sender_type, body, created_at) values (v_owner_id");
  });

  it("sending a message creates the conversation on first contact and reuses it afterward via upsert, keeping exactly one row per relationship", () => {
    expect(sql).toContain("on conflict (owner_id, tenant_id) do update set");
    expect(sql).toContain("on conflict (owner_id, borrower_id) do update set");
  });

  it("sending updates the sender's own last-read timestamp but never the other side's", () => {
    expect(sql).toContain("last_message_sender_type = 'owner', owner_last_read_at = now()");
    expect(sql).toContain("last_message_sender_type = 'tenant', tenant_last_read_at = now()");
    expect(sql).toContain("last_message_sender_type = 'borrower', borrower_last_read_at = now()");
  });

  it("mark-as-read is a separate, identity-derived action for each of the four roles", () => {
    expect(sql).toContain("create or replace function mark_rental_conversation_read_by_owner(p_tenant_id text)");
    expect(sql).toContain("create or replace function mark_rental_conversation_read_by_tenant()");
    expect(sql).toContain("create or replace function mark_pf_conversation_read_by_owner(p_borrower_id text)");
    expect(sql).toContain("create or replace function mark_pf_conversation_read_by_borrower(p_owner_id text default null)");
  });

  it("limits execution of every RPC to authenticated callers only", () => {
    const functions = [
      "send_rental_conversation_owner_message(text, text)",
      "send_rental_conversation_tenant_message(text, text)",
      "mark_rental_conversation_read_by_owner(text)",
      "mark_rental_conversation_read_by_tenant()",
      "send_pf_conversation_owner_message(text, text)",
      "send_pf_conversation_borrower_message(text, text, text)",
      "mark_pf_conversation_read_by_owner(text)",
      "mark_pf_conversation_read_by_borrower(text)",
    ];
    for (const fn of functions) {
      expect(sql).toContain(`revoke all on function ${fn} from public, anon`);
      expect(sql).toContain(`grant execute on function ${fn} to authenticated`);
    }
  });
});
