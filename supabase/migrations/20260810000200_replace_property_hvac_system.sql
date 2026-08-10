create or replace function replace_property_hvac_system (
    p_owner_id text,
    p_transition jsonb,
    p_predecessor_system jsonb,
    p_replacement_system jsonb,
    p_failure_event jsonb,
    p_installation_event jsonb,
    p_initial_components jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
    authenticated_owner_id text;
    required_transition_id text := nullif(btrim(p_transition ->> 'id'), '');
    required_property_id text := nullif(btrim(p_transition ->> 'property_id'), '');
    required_old_id text := nullif(btrim(p_transition ->> 'predecessor_system_id'), '');
    required_new_id text := nullif(btrim(p_transition ->> 'replacement_system_id'), '');
    required_failure_id text := nullif(btrim(p_transition ->> 'failure_event_id'), '');
    required_installation_id text := nullif(btrim(p_transition ->> 'installation_event_id'), '');
    required_evidence_id text := nullif(btrim(p_transition ->> 'evidence_id'), '');
    existing_transition property_hvac_system_replacements%rowtype;
    saved_old property_hvac_systems%rowtype;
    saved_new property_hvac_systems%rowtype;
    saved_failure property_hvac_component_events%rowtype;
    saved_installation property_hvac_component_events%rowtype;
    saved_transition property_hvac_system_replacements%rowtype;
    saved_evidence property_evidence%rowtype;
    component_value jsonb;
    saved_components jsonb;
begin
    authenticated_owner_id := auth.uid()::text;
    if authenticated_owner_id is null then
        raise exception 'Authenticated owner id is required.' using errcode = '42501';
    end if;
    if p_owner_id is null or btrim(p_owner_id) = '' or p_owner_id <> authenticated_owner_id then
        raise exception 'Property HVAC owner does not match authenticated owner.' using errcode = '42501';
    end if;
    if required_transition_id is null or required_property_id is null or required_old_id is null
       or required_new_id is null or required_failure_id is null or required_installation_id is null then
        raise exception 'Complete HVAC replacement identities are required.' using errcode = '22023';
    end if;
    if required_old_id = required_new_id then
        raise exception 'Replacement HVAC system must be separate from its predecessor.' using errcode = '22023';
    end if;
    if p_initial_components is null or jsonb_typeof(p_initial_components) <> 'array' then
        raise exception 'Initial HVAC components must be an array.' using errcode = '22023';
    end if;

    select * into existing_transition
    from property_hvac_system_replacements
    where owner_id = p_owner_id and id = required_transition_id;

    if found then
        if existing_transition.property_id <> required_property_id
           or existing_transition.predecessor_system_id <> required_old_id
           or existing_transition.replacement_system_id <> required_new_id
           or existing_transition.failure_event_id <> required_failure_id
           or existing_transition.installation_event_id <> required_installation_id
           or existing_transition.evidence_id is distinct from required_evidence_id then
            raise exception 'HVAC replacement id already exists with different facts.' using errcode = '22023';
        end if;
        select * into saved_old from property_hvac_systems
        where owner_id = p_owner_id and id = required_old_id;
        select * into saved_new from property_hvac_systems
        where owner_id = p_owner_id and id = required_new_id;
        select * into saved_failure from property_hvac_component_events
        where owner_id = p_owner_id and id = required_failure_id;
        select * into saved_installation from property_hvac_component_events
        where owner_id = p_owner_id and id = required_installation_id;
        select coalesce(jsonb_agg(to_jsonb(c) order by c.id), '[]'::jsonb)
        into saved_components from property_hvac_components c
        where c.owner_id = p_owner_id and c.system_id = required_new_id;
        return jsonb_build_object(
            'transition', to_jsonb(existing_transition),
            'predecessor_system', to_jsonb(saved_old),
            'replacement_system', to_jsonb(saved_new),
            'failure_event', to_jsonb(saved_failure),
            'installation_event', to_jsonb(saved_installation),
            'initial_components', saved_components,
            'created', false
        );
    end if;

    select * into saved_old from property_hvac_systems
    where owner_id = p_owner_id and id = required_old_id for update;
    if not found then
        raise exception 'Predecessor HVAC system was not found.' using errcode = 'P0002';
    end if;
    if saved_old.property_id <> required_property_id then
        raise exception 'HVAC replacement property does not match predecessor.' using errcode = '22023';
    end if;
    if saved_old.status in ('replaced', 'removed') then
        raise exception 'Only a current HVAC system can be replaced.' using errcode = '22023';
    end if;
    if p_predecessor_system ->> 'id' <> required_old_id
       or p_predecessor_system ->> 'property_id' <> required_property_id
       or p_predecessor_system ->> 'status' <> 'replaced'
       or p_predecessor_system ->> 'condition' <> 'failed' then
        raise exception 'Invalid predecessor HVAC replacement state.' using errcode = '22023';
    end if;
    if p_replacement_system ->> 'id' <> required_new_id
       or p_replacement_system ->> 'property_id' <> required_property_id
       or p_replacement_system ->> 'status' <> 'active' then
        raise exception 'Invalid replacement HVAC system state.' using errcode = '22023';
    end if;
    if p_failure_event ->> 'id' <> required_failure_id
       or p_failure_event ->> 'system_id' <> required_old_id
       or p_failure_event ->> 'event_type' <> 'failed'
       or nullif(btrim(p_failure_event ->> 'component_id'), '') is not null then
        raise exception 'Invalid predecessor HVAC failure event.' using errcode = '22023';
    end if;
    if p_installation_event ->> 'id' <> required_installation_id
       or p_installation_event ->> 'system_id' <> required_new_id
       or p_installation_event ->> 'event_type' <> 'installed'
       or nullif(btrim(p_installation_event ->> 'component_id'), '') is not null then
        raise exception 'Invalid replacement HVAC installation event.' using errcode = '22023';
    end if;

    if required_evidence_id is not null then
        select * into saved_evidence from property_evidence
        where owner_id = p_owner_id and id = required_evidence_id for update;
        if not found then
            raise exception 'Property evidence was not found.' using errcode = 'P0002';
        end if;
        if saved_evidence.property_id <> required_property_id
           or (saved_evidence.hvac_system_id is not null and saved_evidence.hvac_system_id <> required_old_id) then
            raise exception 'Property evidence does not belong to the predecessor HVAC system.' using errcode = '22023';
        end if;
        if saved_evidence.review_status <> 'pending_review' or saved_evidence.hvac_event_id is not null then
            raise exception 'Property evidence is not pending review.' using errcode = '22023';
        end if;
    end if;

    update property_hvac_systems set status = 'replaced', condition = 'failed'
    where owner_id = p_owner_id and id = required_old_id returning * into saved_old;

    insert into property_hvac_systems
    select * from jsonb_populate_record(
        null::property_hvac_systems,
        p_replacement_system || jsonb_build_object(
            'owner_id', p_owner_id, 'id', required_new_id,
            'property_id', required_property_id, 'status', 'active'
        )
    ) returning * into saved_new;

    insert into property_hvac_component_events
    select * from jsonb_populate_record(
        null::property_hvac_component_events,
        p_failure_event || jsonb_build_object(
            'owner_id', p_owner_id, 'id', required_failure_id,
            'system_id', required_old_id, 'component_id', null, 'event_type', 'failed'
        )
    ) returning * into saved_failure;

    insert into property_hvac_component_events
    select * from jsonb_populate_record(
        null::property_hvac_component_events,
        p_installation_event || jsonb_build_object(
            'owner_id', p_owner_id, 'id', required_installation_id,
            'system_id', required_new_id, 'component_id', null, 'event_type', 'installed'
        )
    ) returning * into saved_installation;

    for component_value in select value from jsonb_array_elements(p_initial_components)
    loop
        insert into property_hvac_components
        select * from jsonb_populate_record(
            null::property_hvac_components,
            component_value || jsonb_build_object('owner_id', p_owner_id, 'system_id', required_new_id)
        );
    end loop;

    insert into property_hvac_system_replacements
    select * from jsonb_populate_record(
        null::property_hvac_system_replacements,
        p_transition || jsonb_build_object(
            'owner_id', p_owner_id, 'id', required_transition_id,
            'property_id', required_property_id,
            'predecessor_system_id', required_old_id,
            'replacement_system_id', required_new_id,
            'failure_event_id', required_failure_id,
            'installation_event_id', required_installation_id,
            'evidence_id', required_evidence_id
        )
    ) returning * into saved_transition;

    if required_evidence_id is not null then
        update property_evidence set
            hvac_system_id = required_old_id,
            hvac_event_id = required_failure_id,
            review_status = 'approved',
            updated_at = now()
        where owner_id = p_owner_id and id = required_evidence_id;
    end if;

    select coalesce(jsonb_agg(to_jsonb(c) order by c.id), '[]'::jsonb)
    into saved_components from property_hvac_components c
    where c.owner_id = p_owner_id and c.system_id = required_new_id;

    return jsonb_build_object(
        'transition', to_jsonb(saved_transition),
        'predecessor_system', to_jsonb(saved_old),
        'replacement_system', to_jsonb(saved_new),
        'failure_event', to_jsonb(saved_failure),
        'installation_event', to_jsonb(saved_installation),
        'initial_components', saved_components,
        'created', true
    );
end;
$$;

revoke all on function replace_property_hvac_system(text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) from public;
grant execute on function replace_property_hvac_system(text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) to authenticated;
