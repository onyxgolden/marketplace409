import {
  readFileSync,
} from "node:fs";

import {
  resolve,
} from "node:path";

import {
  describe,
  expect,
  it,
} from "vitest";

const migration =
  readFileSync(
    resolve(
      process.cwd(),
      "supabase/migrations/20260808_add_property_condition_assessment_save_rpc.sql",
    ),
    "utf8",
  )
    .toLowerCase()
    .replace(/\s+/g, " ");

describe(
  "property condition assessment save RPC",
  () => {
    it(
      "uses the caller's RLS authority",
      () => {
        expect(migration).toContain(
          "security invoker",
        );

        expect(migration).toContain(
          "authenticated_owner_id := auth.uid()::text",
        );

        expect(migration).toContain(
          "p_owner_id <> authenticated_owner_id",
        );

        expect(migration).not.toContain(
          "security definer",
        );
      },
    );

    it(
      "inserts the assessment and items inside one function",
      () => {
        expect(migration).toContain(
          "insert into property_condition_assessments",
        );

        expect(migration).toContain(
          "insert into property_condition_assessment_items",
        );

        expect(migration).toContain(
          "jsonb_to_recordset(p_items)",
        );
      },
    );

    it(
      "derives item ownership and assessment identity inside the database",
      () => {
        expect(migration).toContain(
          "select p_owner_id, item.id, required_assessment_id",
        );

        expect(migration).not.toContain(
          "select item.owner_id, item.id, item.assessment_id",
        );
      },
    );

    it(
      "makes retries idempotent without updating historical snapshots",
      () => {
        expect(migration).toContain(
          "on conflict ( owner_id, id ) do nothing",
        );

        expect(migration).toContain(
          "'created', false",
        );

        expect(migration).not.toContain(
          "do update",
        );
      },
    );

    it(
      "limits execution to authenticated callers",
      () => {
        expect(migration).toContain(
          "revoke all on function save_property_condition_assessment",
        );

        expect(migration).toContain(
          "grant execute on function save_property_condition_assessment",
        );

        expect(migration).toContain(
          "to authenticated",
        );
      },
    );
  },
);
