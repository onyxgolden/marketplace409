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
      "supabase/migrations/20260808000700_record_hvac_event_with_evidence.sql",
    ),
    "utf8",
  )
    .toLowerCase()
    .replace(/\s+/g, " ");

describe(
  "record HVAC event with evidence RPC",
  () => {
    it(
      "uses authenticated caller authority",
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
      "locks and validates owner-scoped pending evidence",
      () => {
        expect(migration).toContain(
          "select * into saved_evidence from property_evidence where owner_id = p_owner_id and id = required_evidence_id for update",
        );

        expect(migration).toContain(
          "saved_evidence.review_status <> 'pending_review'",
        );

        expect(migration).toContain(
          "saved_evidence.hvac_system_id <> required_system_id",
        );
      },
    );

    it(
      "inserts the append-only event and approves evidence in one function",
      () => {
        expect(migration).toContain(
          "insert into property_hvac_component_events",
        );

        expect(migration).toContain(
          "update property_evidence set hvac_event_id = required_event_id, review_status = 'approved'",
        );

        expect(migration).not.toContain(
          "on conflict",
        );

        expect(migration).not.toContain(
          "delete from",
        );
      },
    );

    it(
      "derives ownership and evidence identity inside the database",
      () => {
        expect(migration).toContain(
          "values ( p_owner_id, required_event_id, required_system_id",
        );

        expect(migration).toContain(
          "where owner_id = p_owner_id and id = required_evidence_id",
        );

        expect(migration).not.toContain(
          "p_event ->> 'owner_id'",
        );
      },
    );

    it(
      "makes committed retries idempotent",
      () => {
        expect(migration).toContain(
          "saved_evidence.review_status = 'approved'",
        );

        expect(migration).toContain(
          "saved_evidence.hvac_event_id = required_event_id",
        );

        expect(migration).toContain(
          "'created', false",
        );

        expect(migration).toContain(
          "'created', true",
        );
      },
    );

    it(
      "preserves structured actions and photo references",
      () => {
        expect(migration).toContain(
          "p_event -> 'component_actions'",
        );

        expect(migration).toContain(
          "jsonb_array_elements_text",
        );

        expect(migration).toContain(
          "'photo_references'",
        );
      },
    );

    it(
      "limits execution to authenticated callers",
      () => {
        expect(migration).toContain(
          "revoke all on function record_property_hvac_event_with_evidence",
        );

        expect(migration).toContain(
          "grant execute on function record_property_hvac_event_with_evidence",
        );

        expect(migration).toContain(
          "to authenticated",
        );
      },
    );
  },
);
