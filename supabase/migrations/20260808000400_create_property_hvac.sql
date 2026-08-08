create table if not exists
    property_hvac_systems (
        owner_id text not null,
        id text not null,
        property_id text not null,
        name text not null,

        system_type text not null
            check (
                system_type in (
                    'split_system',
                    'package_unit',
                    'mini_split',
                    'heat_pump',
                    'furnace_and_ac',
                    'window_unit',
                    'evaporative',
                    'other',
                    'unknown'
                )
            ),

        energy_source text not null
            check (
                energy_source in (
                    'electric',
                    'natural_gas',
                    'propane',
                    'dual_fuel',
                    'other',
                    'unknown'
                )
            ),

        refrigerant_type text,

        tonnage numeric
            check (
                tonnage is null
                or tonnage > 0
            ),

        efficiency_rating text,
        manufacturer text,
        model_number text,
        serial_number text,
        installed_at timestamptz,

        estimated_age_years numeric
            check (
                estimated_age_years is null
                or estimated_age_years >= 0
            ),

        location text,
        thermostat_type text,
        warranty_expiration timestamptz,

        status text not null
            check (
                status in (
                    'active',
                    'inactive',
                    'replaced',
                    'removed',
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

        notes text,

        created_at timestamptz not null
            default now(),

        primary key (
            owner_id,
            id
        )
    );

create table if not exists
    property_hvac_components (
        owner_id text not null,
        id text not null,
        system_id text not null,

        component_type text not null
            check (
                component_type in (
                    'compressor',
                    'condenser_coil',
                    'condenser_fan_motor',
                    'capacitor',
                    'contactor',
                    'control_board',
                    'pressure_switch',
                    'reversing_valve',
                    'evaporator_coil',
                    'blower_motor',
                    'ecm_module',
                    'transformer',
                    'relay_or_sequencer',
                    'heat_strip',
                    'txv_or_metering_device',
                    'drain_pan',
                    'condensate_pump',
                    'float_switch',
                    'gas_valve',
                    'igniter',
                    'flame_sensor',
                    'inducer_motor',
                    'heat_exchanger'
                )
            ),

        name text not null,
        manufacturer text,
        model_number text,
        part_number text,
        serial_number text,
        installed_at timestamptz,
        removed_at timestamptz,

        estimated_age_years numeric
            check (
                estimated_age_years is null
                or estimated_age_years >= 0
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

        status text not null
            check (
                status in (
                    'installed',
                    'removed',
                    'failed',
                    'spare',
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

        vendor_name text,
        invoice_reference text,
        warranty_expiration timestamptz,
        notes text,

        created_at timestamptz not null
            default now(),

        primary key (
            owner_id,
            id
        ),

        constraint
            property_hvac_components_system_fk
        foreign key (
            owner_id,
            system_id
        )
        references
            property_hvac_systems (
                owner_id,
                id
            )
        on delete restrict,

        constraint
            property_hvac_components_owner_system_id_unique
        unique (
            owner_id,
            system_id,
            id
        ),

        constraint
            property_hvac_component_dates_valid
        check (
            installed_at is null
            or removed_at is null
            or removed_at >= installed_at
        )
    );

create table if not exists
    property_hvac_component_events (
        owner_id text not null,
        id text not null,
        system_id text not null,
        component_id text,

        event_type text not null
            check (
                event_type in (
                    'installed',
                    'inspected',
                    'serviced',
                    'repaired',
                    'failed',
                    'replaced',
                    'removed'
                )
            ),

        occurred_at timestamptz not null,
        failure_symptoms text,
        work_performed text,

        cost_cents bigint
            check (
                cost_cents is null
                or cost_cents >= 0
            ),

        vendor_name text,
        invoice_reference text,

        photo_references text[] not null
            default array[]::text[],

        notes text,

        created_at timestamptz not null
            default now(),

        primary key (
            owner_id,
            id
        ),

        constraint
            property_hvac_events_system_fk
        foreign key (
            owner_id,
            system_id
        )
        references
            property_hvac_systems (
                owner_id,
                id
            )
        on delete restrict,

        constraint
            property_hvac_events_component_fk
        foreign key (
            owner_id,
            system_id,
            component_id
        )
        references
            property_hvac_components (
                owner_id,
                system_id,
                id
            )
        on delete restrict
    );

create index if not exists
    idx_property_hvac_systems_owner_property
on property_hvac_systems (
    owner_id,
    property_id,
    name
);

create index if not exists
    idx_property_hvac_components_owner_system
on property_hvac_components (
    owner_id,
    system_id,
    status,
    name
);

create index if not exists
    idx_property_hvac_events_owner_system_occurred
on property_hvac_component_events (
    owner_id,
    system_id,
    occurred_at desc,
    created_at desc
);

create index if not exists
    idx_property_hvac_events_owner_component_occurred
on property_hvac_component_events (
    owner_id,
    component_id,
    occurred_at desc,
    created_at desc
)
where component_id is not null;

alter table
    property_hvac_systems
enable row level security;

alter table
    property_hvac_systems
force row level security;

alter table
    property_hvac_components
enable row level security;

alter table
    property_hvac_components
force row level security;

alter table
    property_hvac_component_events
enable row level security;

alter table
    property_hvac_component_events
force row level security;

create policy
    "property_hvac_systems_owner_select"
on property_hvac_systems
for select
to authenticated
using (
    owner_id = auth.uid()::text
);

create policy
    "property_hvac_systems_owner_insert"
on property_hvac_systems
for insert
to authenticated
with check (
    owner_id = auth.uid()::text
);

create policy
    "property_hvac_systems_owner_update"
on property_hvac_systems
for update
to authenticated
using (
    owner_id = auth.uid()::text
)
with check (
    owner_id = auth.uid()::text
);

create policy
    "property_hvac_components_owner_select"
on property_hvac_components
for select
to authenticated
using (
    owner_id = auth.uid()::text
);

create policy
    "property_hvac_components_owner_insert"
on property_hvac_components
for insert
to authenticated
with check (
    owner_id = auth.uid()::text
);

create policy
    "property_hvac_components_owner_update"
on property_hvac_components
for update
to authenticated
using (
    owner_id = auth.uid()::text
)
with check (
    owner_id = auth.uid()::text
);

create policy
    "property_hvac_events_owner_select"
on property_hvac_component_events
for select
to authenticated
using (
    owner_id = auth.uid()::text
);

create policy
    "property_hvac_events_owner_insert"
on property_hvac_component_events
for insert
to authenticated
with check (
    owner_id = auth.uid()::text
);
