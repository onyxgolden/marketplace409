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
      "supabase/migrations/20260808_add_property_condition_assessment_item_attributes.sql",
    ),
    "utf8",
  )
    .toLowerCase()
    .replace(/\s+/g, " ");

describe(
  "property condition assessment item attributes migration",
  () => {
    it(
      "adds backward-compatible object attributes",
      () => {
        expect(migration).toContain(
          "add column if not exists attributes jsonb not null default '{}'::jsonb",
        );

        expect(migration).toContain(
          "jsonb_typeof(attributes) = 'object'",
        );
      },
    );

    it(
      "replaces the atomic save function with attribute support",
      () => {
        expect(migration).toContain(
          "create or replace function save_property_condition_assessment",
        );

        expect(migration).toContain(
          "coalesce( item.attributes, '{}'::jsonb )",
        );

        expect(migration).toContain(
          "attributes jsonb",
        );
      },
    );

    it(
      "preserves authenticated invoker authority",
      () => {
        expect(migration).toContain(
          "security invoker",
        );

        expect(migration).toContain(
          "p_owner_id <> authenticated_owner_id",
        );

        expect(migration).not.toContain(
          "security definer",
        );
      },
    );
  },
);
