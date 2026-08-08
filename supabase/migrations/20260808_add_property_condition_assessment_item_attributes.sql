alter table
    property_condition_assessment_items
add column if not exists
    attributes jsonb not null
    default '{}'::jsonb
    check (
        jsonb_typeof(attributes)
            = 'object'
    );

create or replace function
    save_property_condition_assessment (
        p_owner_id text,
        p_assessment jsonb,
        p_items jsonb
    )
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
    authenticated_owner_id text;
    required_assessment_id text;
    inserted_assessment_id text;
begin
    authenticated_owner_id :=
        auth.uid()::text;

    if authenticated_owner_id is null then
        raise exception
            'Authenticated owner id is required.'
            using errcode = '42501';
    end if;

    if
        p_owner_id is null
        or btrim(p_owner_id) = ''
        or p_owner_id <> authenticated_owner_id
    then
        raise exception
            'Property condition assessment owner does not match authenticated owner.'
            using errcode = '42501';
    end if;

    required_assessment_id :=
        nullif(
            btrim(
                p_assessment ->> 'id'
            ),
            ''
        );

    if required_assessment_id is null then
        raise exception
            'Property condition assessment id is required.'
            using errcode = '22023';
    end if;

    if
        p_items is null
        or jsonb_typeof(p_items) <> 'array'
    then
        raise exception
            'Property condition assessment items must be an array.'
            using errcode = '22023';
    end if;

    insert into
        property_condition_assessments (
            owner_id,
            id,
            property_id,
            assessment_type,
            effective_at,
            created_at,
            assessor_name,
            assessor_credential,
            source_reference,
            summary
        )
    values (
        p_owner_id,
        required_assessment_id,
        p_assessment ->> 'property_id',
        p_assessment ->> 'assessment_type',
        (
            p_assessment ->> 'effective_at'
        )::timestamptz,
        (
            p_assessment ->> 'created_at'
        )::timestamptz,
        p_assessment ->> 'assessor_name',
        p_assessment ->> 'assessor_credential',
        p_assessment ->> 'source_reference',
        p_assessment ->> 'summary'
    )
    on conflict (
        owner_id,
        id
    )
    do nothing
    returning id
    into inserted_assessment_id;

    if inserted_assessment_id is null then
        return jsonb_build_object(
            'assessment_id',
            required_assessment_id,
            'created',
            false
        );
    end if;

    insert into
        property_condition_assessment_items (
            owner_id,
            id,
            assessment_id,
            section,
            system_key,
            item_key,
            label,
            observation_status,
            condition,
            replacement_priority,
            estimated_replacement_cost_cents,
            planned_replacement_year,
            valuation_impact,
            attributes,
            notes
        )
    select
        p_owner_id,
        item.id,
        required_assessment_id,
        item.section,
        item.system_key,
        item.item_key,
        item.label,
        item.observation_status,
        item.condition,
        item.replacement_priority,
        item.estimated_replacement_cost_cents,
        item.planned_replacement_year,
        item.valuation_impact,
        coalesce(
            item.attributes,
            '{}'::jsonb
        ),
        item.notes
    from jsonb_to_recordset(p_items)
    as item (
        id text,
        assessment_id text,
        owner_id text,
        section text,
        system_key text,
        item_key text,
        label text,
        observation_status text,
        condition text,
        replacement_priority text,
        estimated_replacement_cost_cents bigint,
        planned_replacement_year integer,
        valuation_impact text,
        attributes jsonb,
        notes text
    );

    return jsonb_build_object(
        'assessment_id',
        required_assessment_id,
        'created',
        true
    );
end;
$$;

revoke all
on function
    save_property_condition_assessment (
        text,
        jsonb,
        jsonb
    )
from public;

grant execute
on function
    save_property_condition_assessment (
        text,
        jsonb,
        jsonb
    )
to authenticated;
