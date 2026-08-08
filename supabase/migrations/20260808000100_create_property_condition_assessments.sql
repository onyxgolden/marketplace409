create table if not exists
    property_condition_assessments (
        owner_id text not null,

        id text not null,

        property_id text not null,

        assessment_type text not null
            check (
                assessment_type in (
                    'owner_assessment',
                    'licensed_inspection',
                    'contractor_evaluation',
                    'maintenance_review'
                )
            ),

        effective_at timestamptz not null,

        created_at timestamptz not null
            default now(),

        assessor_name text,

        assessor_credential text,

        source_reference text,

        summary text,

        primary key (
            owner_id,
            id
        )
    );

create table if not exists
    property_condition_assessment_items (
        owner_id text not null,

        id text not null,

        assessment_id text not null,

        section text not null
            check (
                section in (
                    'structural_systems',
                    'electrical_systems',
                    'hvac_systems',
                    'plumbing_systems',
                    'appliances',
                    'optional_systems'
                )
            ),

        system_key text not null,

        item_key text not null,

        label text not null,

        observation_status text not null
            check (
                observation_status in (
                    'observed',
                    'not_observed',
                    'not_present',
                    'attention_needed',
                    'unknown'
                )
            ),

        condition text not null
            check (
                condition in (
                    'good',
                    'serviceable',
                    'marginal',
                    'poor',
                    'failed',
                    'unknown'
                )
            ),

        replacement_priority text not null
            check (
                replacement_priority in (
                    'routine',
                    'monitor',
                    'planned',
                    'urgent',
                    'immediate',
                    'unknown'
                )
            ),

        estimated_replacement_cost_cents bigint
            check (
                estimated_replacement_cost_cents
                    is null
                or
                estimated_replacement_cost_cents
                    >= 0
            ),

        planned_replacement_year integer
            check (
                planned_replacement_year
                    is null
                or (
                    planned_replacement_year
                        >= 1900
                    and
                    planned_replacement_year
                        <= 2200
                )
            ),

        valuation_impact text not null
            check (
                valuation_impact in (
                    'positive',
                    'none',
                    'negative',
                    'unknown'
                )
            ),

        notes text,

        primary key (
            owner_id,
            id
        ),

        constraint
            property_condition_items_assessment_fk
        foreign key (
            owner_id,
            assessment_id
        )
        references
            property_condition_assessments (
                owner_id,
                id
            )
        on delete cascade,

        constraint
            property_condition_items_system_item_unique
        unique (
            owner_id,
            assessment_id,
            system_key,
            item_key
        )
    );

create index if not exists
    idx_property_condition_assessments_owner_property_effective
on property_condition_assessments (
    owner_id,
    property_id,
    effective_at desc,
    created_at desc
);

create index if not exists
    idx_property_condition_assessments_owner_effective
on property_condition_assessments (
    owner_id,
    effective_at desc
);

create index if not exists
    idx_property_condition_items_assessment
on property_condition_assessment_items (
    owner_id,
    assessment_id
);

create index if not exists
    idx_property_condition_items_priority
on property_condition_assessment_items (
    owner_id,
    replacement_priority
);

alter table
    property_condition_assessments
enable row level security;

alter table
    property_condition_assessments
force row level security;

alter table
    property_condition_assessment_items
enable row level security;

alter table
    property_condition_assessment_items
force row level security;

create policy
    "property_condition_assessments_owner_select"
on property_condition_assessments
for select
to authenticated
using (
    owner_id = auth.uid()::text
);

create policy
    "property_condition_assessments_owner_insert"
on property_condition_assessments
for insert
to authenticated
with check (
    owner_id = auth.uid()::text
);

create policy
    "property_condition_assessments_owner_delete"
on property_condition_assessments
for delete
to authenticated
using (
    owner_id = auth.uid()::text
);

create policy
    "property_condition_items_owner_select"
on property_condition_assessment_items
for select
to authenticated
using (
    owner_id = auth.uid()::text
);

create policy
    "property_condition_items_owner_insert"
on property_condition_assessment_items
for insert
to authenticated
with check (
    owner_id = auth.uid()::text
);

create policy
    "property_condition_items_owner_delete"
on property_condition_assessment_items
for delete
to authenticated
using (
    owner_id = auth.uid()::text
);
