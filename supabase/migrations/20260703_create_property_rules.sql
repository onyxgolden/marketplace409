create table if not exists property_rules (
    id text primary key,

    type text not null,

    property_id text not null,

    property_snapshot jsonb not null,

    priority integer not null default 0,

    owner_id text,

    organization_id text,

    enabled boolean not null default true,

    match_field text not null,

    match_value text not null,

    match_mode text not null,

    created_at timestamptz not null default now(),

    updated_at timestamptz not null default now()
);

create index if not exists idx_property_rules_priority
    on property_rules(priority desc);

create index if not exists idx_property_rules_owner
    on property_rules(owner_id);

create index if not exists idx_property_rules_organization
    on property_rules(organization_id);

create index if not exists idx_property_rules_match
    on property_rules(match_field, match_value);
