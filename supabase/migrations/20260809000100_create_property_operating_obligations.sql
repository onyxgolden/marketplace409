create table if not exists
property_operating_obligations (
    id text primary key,

    owner_id text not null,

    scope text not null
        check (
            scope in (
                'property',
                'portfolio',
                'personal_home_office'
            )
        ),

    property_id text,

    subject_label text not null
        check (
            btrim(subject_label) <> ''
        ),

    obligation_type text not null
        check (
            obligation_type in (
                'property_tax',
                'fire_insurance',
                'windstorm_insurance',
                'flood_insurance',
                'bundled_fire_windstorm_insurance',
                'business_liability_insurance',
                'other_insurance'
            )
        ),

    annual_amount_cents bigint not null
        check (
            annual_amount_cents >= 0
        ),

    currency_code text not null
        check (
            currency_code =
                upper(currency_code)
            and char_length(
                currency_code
            ) = 3
        ),

    service_period_start date,

    service_period_end date,

    payment_date date,

    paid_amount_cents bigint
        check (
            paid_amount_cents is null
            or paid_amount_cents >= 0
        ),

    status text not null
        check (
            status in (
                'provisional',
                'active',
                'cancelled',
                'expired'
            )
        ),

    verification_status text not null
        check (
            verification_status in (
                'unverified',
                'owner_confirmed',
                'document_verified'
            )
        ),

    recognition_status text not null
        check (
            recognition_status in (
                'pending',
                'accrual_ready',
                'cash_only'
            )
        ),

    business_use_basis_points integer
        check (
            business_use_basis_points
                is null
            or (
                business_use_basis_points
                    >= 0
                and
                business_use_basis_points
                    <= 10000
            )
        ),

    source text not null
        check (
            source in (
                'manual',
                'spreadsheet',
                'county_records',
                'policy_document',
                'financial_event'
            )
        ),

    provider_name text,

    provider_reference text,

    evidence_id text,

    reconciled_financial_event_id text,

    cancelled_at timestamptz,

    created_at timestamptz not null
        default now(),

    updated_at timestamptz not null
        default now(),

    notes text,

    constraint
    property_operating_obligations_scope_property
    check (
        (
            scope = 'property'
            and property_id is not null
            and btrim(property_id) <> ''
        )
        or (
            scope <> 'property'
            and property_id is null
        )
    ),

    constraint
    property_operating_obligations_service_period
    check (
        (
            service_period_start is null
            and service_period_end is null
        )
        or (
            service_period_start is not null
            and service_period_end is not null
            and service_period_end >
                service_period_start
        )
    ),

    constraint
    property_operating_obligations_accrual_period
    check (
        recognition_status <>
            'accrual_ready'
        or (
            service_period_start is not null
            and service_period_end is not null
        )
    ),

    constraint
    property_operating_obligations_home_office_allocation
    check (
        scope <>
            'personal_home_office'
        or recognition_status <>
            'accrual_ready'
        or business_use_basis_points
            is not null
    )
);

create unique index if not exists
idx_property_operating_obligations_owner_id
on property_operating_obligations (
    owner_id,
    id
);

create unique index if not exists
idx_property_operating_obligations_reconciled_event
on property_operating_obligations (
    owner_id,
    reconciled_financial_event_id
)
where
    reconciled_financial_event_id
        is not null;

create index if not exists
idx_property_operating_obligations_owner_property_period
on property_operating_obligations (
    owner_id,
    property_id,
    service_period_start desc
);

create index if not exists
idx_property_operating_obligations_owner_scope_type
on property_operating_obligations (
    owner_id,
    scope,
    obligation_type
);

create index if not exists
idx_property_operating_obligations_owner_status
on property_operating_obligations (
    owner_id,
    status,
    recognition_status
);

create index if not exists
idx_property_operating_obligations_unreconciled
on property_operating_obligations (
    owner_id,
    payment_date
)
where
    reconciled_financial_event_id
        is null;

alter table
property_operating_obligations
enable row level security;

alter table
property_operating_obligations
force row level security;

create policy
"property_operating_obligations_owner_select"
on property_operating_obligations
for select
to authenticated
using (
    owner_id = auth.uid()::text
);

create policy
"property_operating_obligations_owner_insert"
on property_operating_obligations
for insert
to authenticated
with check (
    owner_id = auth.uid()::text
);

create policy
"property_operating_obligations_owner_update"
on property_operating_obligations
for update
to authenticated
using (
    owner_id = auth.uid()::text
)
with check (
    owner_id = auth.uid()::text
);

create policy
"property_operating_obligations_owner_delete"
on property_operating_obligations
for delete
to authenticated
using (
    owner_id = auth.uid()::text
);
