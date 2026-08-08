alter table
    property_hvac_components
drop constraint if exists
    property_hvac_components_component_type_check;

alter table
    property_hvac_components
add constraint
    property_hvac_components_component_type_check
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
        'filter_drier',
        'refrigerant_line_set',
        'low_voltage_wiring',
        'heat_exchanger'
    )
);

alter table
    property_hvac_component_events
add column if not exists
    component_actions jsonb not null
        default '[]'::jsonb;

alter table
    property_hvac_component_events
drop constraint if exists
    property_hvac_events_component_actions_array;

alter table
    property_hvac_component_events
add constraint
    property_hvac_events_component_actions_array
check (
    jsonb_typeof(component_actions)
        = 'array'
);
