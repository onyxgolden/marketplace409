create table if not exists property_valuations (
    id text primary key,

    owner_id text not null,

    property_id text not null,

    valuation_type text not null
        check (
            valuation_type in (
                'purchase_price',
                'owner_estimate',
                'appraisal',
                'assessed_value',
                'provider_estimate'
            )
        ),

    source text not null
        check (
            source in (
                'manual',
                'spreadsheet',
                'county_records',
                'zillow',
                'other_provider'
            )
        ),

    provider_name text,

    provider_reference text,

    amount_cents bigint not null
        check (amount_cents >= 0),

    currency_code text not null
        check (
            currency_code = upper(currency_code)
            and char_length(currency_code) = 3
        ),

    effective_at timestamptz not null,

    created_at timestamptz not null
        default now(),

    notes text
);

create unique index if not exists
    idx_property_valuations_owner_snapshot
on property_valuations (
    owner_id,
    property_id,
    valuation_type,
    source,
    effective_at
);

create index if not exists
    idx_property_valuations_owner
on property_valuations(owner_id);

create index if not exists
    idx_property_valuations_owner_property_effective
on property_valuations(
    owner_id,
    property_id,
    effective_at desc
);

create index if not exists
    idx_property_valuations_source
on property_valuations(
    owner_id,
    source
);

alter table property_valuations
    enable row level security;

alter table property_valuations
    force row level security;

create policy "property_valuations_owner_select"
on property_valuations
for select
to authenticated
using (
    owner_id = auth.uid()::text
);

create policy "property_valuations_owner_insert"
on property_valuations
for insert
to authenticated
with check (
    owner_id = auth.uid()::text
);

create policy "property_valuations_owner_delete"
on property_valuations
for delete
to authenticated
using (
    owner_id = auth.uid()::text
);
