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
      "supabase/migrations/20260808000100_create_property_condition_assessments.sql",
    ),
    "utf8",
  )
    .toLowerCase()
    .replace(/\s+/g, " ");

describe(
  "property condition assessment migration",
  () => {
    it(
      "creates owner-scoped aggregate and item tables",
      () => {
        expect(migration).toContain(
          "create table if not exists property_condition_assessments",
        );

        expect(migration).toContain(
          "create table if not exists property_condition_assessment_items",
        );

        expect(migration).toContain(
          "primary key ( owner_id, id )",
        );

        expect(migration).toContain(
          "foreign key ( owner_id, assessment_id ) references property_condition_assessments ( owner_id, id ) on delete cascade",
        );
      },
    );

    it(
      "enforces the committed domain vocabulary",
      () => {
        for (
          const value of [
            "owner_assessment",
            "licensed_inspection",
            "contractor_evaluation",
            "maintenance_review",
            "structural_systems",
            "electrical_systems",
            "hvac_systems",
            "plumbing_systems",
            "appliances",
            "optional_systems",
            "attention_needed",
            "immediate",
            "negative",
          ]
        ) {
          expect(migration).toContain(
            `'${value}'`,
          );
        }
      },
    );

    it(
      "forces owner RLS on both tables",
      () => {
        expect(migration).toContain(
          "alter table property_condition_assessments force row level security",
        );

        expect(migration).toContain(
          "alter table property_condition_assessment_items force row level security",
        );

        expect(
          migration.match(
            /owner_id = auth\.uid\(\)::text/g,
          ),
        ).toHaveLength(6);
      },
    );

    it(
      "keeps assessment snapshots immutable",
      () => {
        expect(migration).not.toContain(
          "for update",
        );

        expect(migration).toContain(
          "for select",
        );

        expect(migration).toContain(
          "for insert",
        );

        expect(migration).toContain(
          "for delete",
        );
      },
    );

    it(
      "supports history, latest, and priority queries",
      () => {
        expect(migration).toContain(
          "idx_property_condition_assessments_owner_property_effective",
        );

        expect(migration).toContain(
          "idx_property_condition_assessments_owner_effective",
        );

        expect(migration).toContain(
          "idx_property_condition_items_priority",
        );
      },
    );
  },
);
