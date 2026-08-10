alter table property_hvac_systems add constraint property_hvac_systems_owner_property_id_unique unique (owner_id, property_id, id);
alter table property_hvac_component_events add constraint property_hvac_events_owner_system_id_unique unique (owner_id, system_id, id);
alter table property_evidence add constraint property_evidence_owner_property_id_unique unique (owner_id, property_id, id);

create table if not exists property_hvac_system_replacements (
    owner_id text not null,
    id text not null,
    property_id text not null,
    predecessor_system_id text not null,
    replacement_system_id text not null,
    failure_event_id text not null,
    installation_event_id text not null,
    evidence_id text,
    occurred_at timestamptz not null,
    created_at timestamptz not null default now(),
    primary key (owner_id, id),
    constraint property_hvac_replacement_distinct_systems check (predecessor_system_id <> replacement_system_id),
    constraint property_hvac_replacement_predecessor_unique unique (owner_id, predecessor_system_id),
    constraint property_hvac_replacement_successor_unique unique (owner_id, replacement_system_id),
    constraint property_hvac_replacement_predecessor_fk foreign key (owner_id, property_id, predecessor_system_id) references property_hvac_systems (owner_id, property_id, id) on delete restrict,
    constraint property_hvac_replacement_successor_fk foreign key (owner_id, property_id, replacement_system_id) references property_hvac_systems (owner_id, property_id, id) on delete restrict,
    constraint property_hvac_replacement_failure_event_fk foreign key (owner_id, predecessor_system_id, failure_event_id) references property_hvac_component_events (owner_id, system_id, id) on delete restrict,
    constraint property_hvac_replacement_installation_event_fk foreign key (owner_id, replacement_system_id, installation_event_id) references property_hvac_component_events (owner_id, system_id, id) on delete restrict,
    constraint property_hvac_replacement_evidence_fk foreign key (owner_id, property_id, evidence_id) references property_evidence (owner_id, property_id, id) on delete restrict
);

create unique index if not exists idx_property_hvac_replacements_owner_evidence on property_hvac_system_replacements (owner_id, evidence_id) where evidence_id is not null;
create index if not exists idx_property_hvac_replacements_owner_property on property_hvac_system_replacements (owner_id, property_id, occurred_at desc);
create index if not exists idx_property_hvac_replacements_owner_predecessor on property_hvac_system_replacements (owner_id, predecessor_system_id);
create index if not exists idx_property_hvac_replacements_owner_successor on property_hvac_system_replacements (owner_id, replacement_system_id);

alter table property_hvac_system_replacements enable row level security;
alter table property_hvac_system_replacements force row level security;

create policy "property_hvac_replacements_owner_select" on property_hvac_system_replacements for select to authenticated using (owner_id = auth.uid()::text);
create policy "property_hvac_replacements_owner_insert" on property_hvac_system_replacements for insert to authenticated with check (owner_id = auth.uid()::text);
