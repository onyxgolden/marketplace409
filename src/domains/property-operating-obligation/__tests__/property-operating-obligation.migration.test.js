import {
  readFileSync,
} from "node:fs";

import {
  fileURLToPath,
} from "node:url";

import {
  describe,
  expect,
  it,
} from "vitest";

const migrationPath =
  fileURLToPath(
    new URL(
      "../../../../supabase/migrations/20260809000100_create_property_operating_obligations.sql",
      import.meta.url,
    ),
  );

const migration =
  readFileSync(
    migrationPath,
    "utf8",
  );

describe(
  "property operating obligation migration",
  () => {
    it(
      "creates the owner-scoped obligation table",
      () => {
        expect(migration).toMatch(
          /create table if not exists\s+property_operating_obligations/i,
        );
        expect(migration).toMatch(
          /owner_id text not null/i,
        );
        expect(migration).toMatch(
          /annual_amount_cents bigint not null/i,
        );
        expect(migration).toMatch(
          /service_period_start date/i,
        );
        expect(migration).toMatch(
          /reconciled_financial_event_id text/i,
        );
      },
    );

    it(
      "constrains the supported domain vocabulary",
      () => {
        for (
          const value of [
            "personal_home_office",
            "property_tax",
            "fire_insurance",
            "windstorm_insurance",
            "flood_insurance",
            "business_liability_insurance",
            "document_verified",
            "accrual_ready",
            "policy_document",
          ]
        ) {
          expect(migration).toContain(
            `'${value}'`,
          );
        }
      },
    );

    it(
      "enforces property scope ownership",
      () => {
        expect(migration).toMatch(
          /property_operating_obligations_scope_property/i,
        );
        expect(migration).toMatch(
          /scope = 'property'[\s\S]*property_id is not null/i,
        );
        expect(migration).toMatch(
          /scope <> 'property'[\s\S]*property_id is null/i,
        );
      },
    );

    it(
      "requires complete valid accrual periods",
      () => {
        expect(migration).toMatch(
          /property_operating_obligations_service_period/i,
        );
        expect(migration).toMatch(
          /service_period_end >\s*service_period_start/i,
        );
        expect(migration).toMatch(
          /property_operating_obligations_accrual_period/i,
        );
        expect(migration).toMatch(
          /recognition_status <>\s*'accrual_ready'/i,
        );
      },
    );

    it(
      "protects money and home-office allocation values",
      () => {
        expect(migration).toMatch(
          /annual_amount_cents >= 0/i,
        );
        expect(migration).toMatch(
          /paid_amount_cents >= 0/i,
        );
        expect(migration).toMatch(
          /business_use_basis_points[\s\S]*<= 10000/i,
        );
        expect(migration).toMatch(
          /property_operating_obligations_home_office_allocation/i,
        );
      },
    );

    it(
      "prevents duplicate financial-event reconciliation",
      () => {
        expect(migration).toMatch(
          /create unique index if not exists\s+idx_property_operating_obligations_reconciled_event/i,
        );
        expect(migration).toMatch(
          /where\s+reconciled_financial_event_id\s+is not null/i,
        );
      },
    );

    it(
      "creates owner and property query indexes",
      () => {
        expect(migration).toContain(
          "idx_property_operating_obligations_owner_property_period",
        );
        expect(migration).toContain(
          "idx_property_operating_obligations_owner_scope_type",
        );
        expect(migration).toContain(
          "idx_property_operating_obligations_unreconciled",
        );
      },
    );

    it(
      "forces authenticated owner row-level security",
      () => {
        expect(migration).toMatch(
          /enable row level security/i,
        );
        expect(migration).toMatch(
          /force row level security/i,
        );

        for (
          const operation of [
            "select",
            "insert",
            "update",
            "delete",
          ]
        ) {
          expect(migration).toContain(
            `"property_operating_obligations_owner_${operation}"`,
          );
        }

        expect(
          migration.match(
            /owner_id = auth\.uid\(\)::text/g,
          )?.length,
        ).toBeGreaterThanOrEqual(5);
      },
    );
  },
);
