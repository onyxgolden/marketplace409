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
      "supabase/migrations/20260808000600_create_property_evidence.sql",
    ),
    "utf8",
  )
    .toLowerCase()
    .replace(/\s+/g, " ");

describe(
  "property evidence migration",
  () => {
    it(
      "creates a private constrained storage bucket",
      () => {
        expect(migration).toContain(
          "insert into storage.buckets",
        );

        expect(migration).toContain(
          "'property-evidence', 'property-evidence', false, 10485760",
        );

        expect(migration).toContain(
          "'application/pdf'",
        );

        expect(migration).toContain(
          "'image/jpeg'",
        );

        expect(migration).toContain(
          "'image/png'",
        );
      },
    );

    it(
      "creates owner-scoped evidence metadata",
      () => {
        expect(migration).toContain(
          "create table if not exists property_evidence",
        );

        expect(migration).toContain(
          "primary key ( owner_id, id )",
        );

        expect(migration).toContain(
          "unique ( bucket, object_path )",
        );

        expect(migration).toContain(
          "split_part( object_path, '/', 1 ) = owner_id",
        );
      },
    );

    it(
      "links evidence to HVAC systems and approved events",
      () => {
        expect(migration).toContain(
          "foreign key ( owner_id, hvac_system_id ) references property_hvac_systems ( owner_id, id ) on delete restrict",
        );

        expect(migration).toContain(
          "foreign key ( owner_id, hvac_event_id ) references property_hvac_component_events ( owner_id, id ) on delete restrict",
        );
      },
    );

    it(
      "retains extraction and review provenance",
      () => {
        for (
          const value of [
            "pending",
            "native_pdf",
            "google_cloud_vision",
            "manual",
            "pending_review",
            "approved",
            "rejected",
            "extraction_failed",
          ]
        ) {
          expect(migration).toContain(
            `'${value}'`,
          );
        }

        expect(migration).toContain(
          "parser_version text",
        );

        expect(migration).toContain(
          "original_filename text not null",
        );
      },
    );

    it(
      "forces owner RLS on evidence metadata",
      () => {
        expect(migration).toContain(
          "alter table property_evidence enable row level security",
        );

        expect(migration).toContain(
          "alter table property_evidence force row level security",
        );

        expect(migration).toContain(
          "property_evidence_owner_select",
        );

        expect(migration).toContain(
          "property_evidence_owner_insert",
        );

        expect(migration).toContain(
          "property_evidence_owner_update",
        );

        expect(migration).not.toContain(
          "property_evidence_owner_delete",
        );
      },
    );

    it(
      "restricts storage objects to the authenticated owner path",
      () => {
        expect(migration).toContain(
          "property_evidence_objects_owner_select",
        );

        expect(migration).toContain(
          "property_evidence_objects_owner_insert",
        );

        expect(
          migration.match(
            /\(storage\.foldername\(name\)\)\[1\] = auth\.uid\(\)::text/g,
          ),
        ).toHaveLength(2);

        expect(migration).not.toContain(
          "getpublicurl",
        );

        expect(migration).not.toContain(
          "property_evidence_objects_owner_delete",
        );
      },
    );

    it(
      "indexes property, system, event, and review queries",
      () => {
        expect(migration).toContain(
          "idx_property_evidence_owner_property_created",
        );

        expect(migration).toContain(
          "idx_property_evidence_owner_system_created",
        );

        expect(migration).toContain(
          "idx_property_evidence_owner_event",
        );

        expect(migration).toContain(
          "idx_property_evidence_owner_review",
        );
      },
    );
  },
);
