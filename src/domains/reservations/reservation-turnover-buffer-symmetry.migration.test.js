import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  new URL(
    "../../../supabase/migrations/20260901000600_fix_reservation_turnover_buffer_symmetry.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("reservation turnover-buffer symmetry repair", () => {
  it("redefines confirm_owner_reservation with the same signature", () => {
    expect(sql).toContain("create or replace function confirm_owner_reservation(");
    expect(sql).toContain("security definer set search_path = public");
  });

  it("requires the buffer gap before an existing reservation's check-in, not just after its checkout", () => {
    expect(sql).toContain(
      "check_in_date < p_check_out_date + v_buffer_days and check_out_date + v_buffer_days > p_check_in_date",
    );
    expect(sql).not.toContain(
      "check_in_date < p_check_out_date and check_out_date + v_buffer_days > p_check_in_date",
    );
  });

  it("applies the same symmetric buffer to calendar blocks", () => {
    expect(sql).toContain(
      "start_date < p_check_out_date + v_buffer_days and end_date + v_buffer_days > p_check_in_date",
    );
  });

  it("keeps execute revoked from public and granted only to authenticated", () => {
    const signature = "confirm_owner_reservation(text,text,text,text,text,text,text,date,date,integer,bigint,bigint,bigint,bigint,bigint,text,text,text)";
    expect(sql).toContain(`revoke all on function ${signature} from public;`);
    expect(sql).toContain(`grant execute on function ${signature} to authenticated;`);
  });
});
