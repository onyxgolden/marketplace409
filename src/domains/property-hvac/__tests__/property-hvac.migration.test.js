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
      "supabase/migrations/20260808000400_create_property_hvac.sql",
    ),
    "utf8",
  )
    .toLowerCase()
    .replace(/\s+/g, " ");

describe(
  "property HVAC migration",
  () => {
    it(
      "creates system, component, and event tables",
      () => {
        expect(migration).toContain(
          "create table if not exists property_hvac_systems",
        );

        expect(migration).toContain(
          "create table if not exists property_hvac_components",
        );

        expect(migration).toContain(
          "create table if not exists property_hvac_component_events",
        );
      },
    );

    it(
      "uses composite owner identities throughout",
      () => {
        expect(
          migration.match(
            /primary key \( owner_id, id \)/g,
          ),
        ).toHaveLength(3);

        expect(migration).toContain(
          "foreign key ( owner_id, system_id ) references property_hvac_systems ( owner_id, id )",
        );

        expect(migration).toContain(
          "foreign key ( owner_id, system_id, component_id ) references property_hvac_components ( owner_id, system_id, id )",
        );
      },
    );

    it(
      "enforces component and event relationships",
      () => {
        expect(migration).toContain(
          "property_hvac_components_owner_system_id_unique",
        );

        expect(migration).toContain(
          "property_hvac_component_dates_valid",
        );

        expect(
          migration.match(
            /on delete restrict/g,
          ),
        ).toHaveLength(3);
      },
    );

    it(
      "forces owner RLS on all three tables",
      () => {
        expect(migration).toContain(
          "alter table property_hvac_systems force row level security",
        );

        expect(migration).toContain(
          "alter table property_hvac_components force row level security",
        );

        expect(migration).toContain(
          "alter table property_hvac_component_events force row level security",
        );
      },
    );

    it(
      "prevents deletion from erasing lifecycle history",
      () => {
        expect(migration).not.toContain(
          "on delete cascade",
        );

        expect(migration).not.toContain(
          "property_hvac_systems_owner_delete",
        );

        expect(migration).not.toContain(
          "property_hvac_components_owner_delete",
        );

        expect(migration).not.toContain(
          "property_hvac_events_owner_delete",
        );
      },
    );

    it(
      "keeps events append-only",
      () => {
        expect(migration).toContain(
          "property_hvac_events_owner_select",
        );

        expect(migration).toContain(
          "property_hvac_events_owner_insert",
        );

        expect(migration).not.toContain(
          "property_hvac_events_owner_update",
        );

        expect(migration).not.toContain(
          "property_hvac_events_owner_delete",
        );
      },
    );

    it(
      "indexes property and lifecycle history queries",
      () => {
        expect(migration).toContain(
          "idx_property_hvac_systems_owner_property",
        );

        expect(migration).toContain(
          "idx_property_hvac_components_owner_system",
        );

        expect(migration).toContain(
          "idx_property_hvac_events_owner_system_occurred",
        );

        expect(migration).toContain(
          "idx_property_hvac_events_owner_component_occurred",
        );
      },
    );
  },
);
