import {
  readFileSync,
} from "node:fs";

import {
  describe,
  expect,
  it,
} from "vitest";

const migration = readFileSync(
  new URL(
    "../../../../supabase/migrations/20260808000500_add_property_hvac_event_actions.sql",
    import.meta.url,
  ),
  "utf8",
);

describe(
  "property HVAC event actions migration",
  () => {
    it(
      "expands the controlled component catalog",
      () => {
        expect(migration).toContain(
          "'filter_drier'",
        );

        expect(migration).toContain(
          "'refrigerant_line_set'",
        );

        expect(migration).toContain(
          "'low_voltage_wiring'",
        );
      },
    );

    it(
      "adds a JSON action collection to service events",
      () => {
        expect(migration).toMatch(
          /add column if not exists\s+component_actions jsonb not null\s+default '\[\]'::jsonb/i,
        );

        expect(migration).toMatch(
          /jsonb_typeof\(component_actions\)\s*=\s*'array'/i,
        );
      },
    );

    it(
      "alters both deployed HVAC tables",
      () => {
        expect(migration).toMatch(
          /alter table\s+property_hvac_components/i,
        );

        expect(migration).toMatch(
          /alter table\s+property_hvac_component_events/i,
        );
      },
    );
  },
);
