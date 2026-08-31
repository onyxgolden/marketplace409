import fs from "node:fs";import path from "node:path";import{describe,expect,it}from"vitest";
const sql=fs.readFileSync(path.join(process.cwd(),"supabase/migrations/20260901000200_create_reservations_and_atomic_confirmation.sql"),"utf8");
describe("reservation confirmation migration",()=>{
 it("locks inventory and rejects overlapping active stays including turnover buffers",()=>{expect(sql).toContain("for update");expect(sql).toContain("check_in_date < p_check_out_date and check_out_date + v_buffer_days > p_check_in_date");expect(sql).toContain("ceil(v_settings.turnover_buffer_hours / 24.0)");expect(sql).toContain("Reservation dates are no longer available")});
 it("creates the guest, reservation, immutable event, and calendar block atomically",()=>{expect(sql).toContain("insert into reservation_guests");expect(sql).toContain("insert into reservations");expect(sql).toContain("insert into reservation_events");expect(sql).toContain("insert into reservation_calendar_blocks");expect(sql).toContain("Reservation events are immutable")});
 it("returns an exact retry before evaluating overlap",()=>{expect(sql).toContain("where owner_id=p_owner_id and id=p_reservation_id");expect(sql).toContain("if found then return v_result")});
 it("keeps guest records private to authenticated workspace members",()=>{expect(sql).toContain('reservation_guests_workspace_read');expect(sql).not.toMatch(/grant .* to anon/i);expect(sql).toContain("has_workspace_access(p_owner_id)")});
});
