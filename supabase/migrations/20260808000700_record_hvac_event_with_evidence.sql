create or replace function
    record_property_hvac_event_with_evidence (
        p_owner_id text,
        p_event jsonb,
        p_evidence_id text
    )
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
    authenticated_owner_id text;
    required_event_id text;
    required_system_id text;
    required_evidence_id text;
    saved_evidence
        property_evidence%rowtype;
    saved_event
        property_hvac_component_events%rowtype;
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
        or p_owner_id <>
            authenticated_owner_id
    then
        raise exception
            'Property HVAC owner does not match authenticated owner.'
            using errcode = '42501';
    end if;

    required_event_id :=
        nullif(
            btrim(
                p_event ->> 'id'
            ),
            ''
        );

    if required_event_id is null then
        raise exception
            'HVAC event id is required.'
            using errcode = '22023';
    end if;

    required_system_id :=
        nullif(
            btrim(
                p_event ->>
                    'system_id'
            ),
            ''
        );

    if required_system_id is null then
        raise exception
            'HVAC system id is required.'
            using errcode = '22023';
    end if;

    required_evidence_id :=
        nullif(
            btrim(
                p_evidence_id
            ),
            ''
        );

    if required_evidence_id is null then
        raise exception
            'Property evidence id is required.'
            using errcode = '22023';
    end if;

    select *
    into saved_evidence
    from property_evidence
    where
        owner_id = p_owner_id
        and id =
            required_evidence_id
    for update;

    if not found then
        raise exception
            'Property evidence was not found.'
            using errcode = 'P0002';
    end if;

    if
        saved_evidence.review_status =
            'approved'
        and
        saved_evidence.hvac_event_id =
            required_event_id
    then
        select *
        into saved_event
        from
            property_hvac_component_events
        where
            owner_id = p_owner_id
            and id =
                required_event_id;

        if not found then
            raise exception
                'Approved property evidence references a missing HVAC event.'
                using errcode = 'P0002';
        end if;

        return jsonb_build_object(
            'event',
            to_jsonb(saved_event),
            'evidence_id',
            required_evidence_id,
            'created',
            false
        );
    end if;

    if
        saved_evidence.review_status <>
            'pending_review'
        or
        saved_evidence.hvac_event_id
            is not null
    then
        raise exception
            'Property evidence is not pending review.'
            using errcode = '22023';
    end if;

    if
        saved_evidence.hvac_system_id
            is not null
        and
        saved_evidence.hvac_system_id <>
            required_system_id
    then
        raise exception
            'Property evidence does not belong to the HVAC system.'
            using errcode = '22023';
    end if;

    insert into
        property_hvac_component_events (
            owner_id,
            id,
            system_id,
            component_id,
            event_type,
            occurred_at,
            failure_symptoms,
            work_performed,
            cost_cents,
            vendor_name,
            invoice_reference,
            photo_references,
            component_actions,
            notes,
            created_at
        )
    values (
        p_owner_id,
        required_event_id,
        required_system_id,
        nullif(
            btrim(
                p_event ->>
                    'component_id'
            ),
            ''
        ),
        p_event ->> 'event_type',
        (
            p_event ->>
                'occurred_at'
        )::timestamptz,
        p_event ->>
            'failure_symptoms',
        p_event ->>
            'work_performed',
        (
            p_event ->>
                'cost_cents'
        )::bigint,
        p_event ->>
            'vendor_name',
        p_event ->>
            'invoice_reference',
        coalesce(
            array(
                select
                    jsonb_array_elements_text(
                        coalesce(
                            p_event ->
                                'photo_references',
                            '[]'::jsonb
                        )
                    )
            ),
            array[]::text[]
        ),
        coalesce(
            p_event ->
                'component_actions',
            '[]'::jsonb
        ),
        p_event ->> 'notes',
        (
            p_event ->>
                'created_at'
        )::timestamptz
    )
    returning *
    into saved_event;

    update property_evidence
    set
        hvac_event_id =
            required_event_id,
        review_status =
            'approved',
        updated_at =
            now()
    where
        owner_id = p_owner_id
        and id =
            required_evidence_id;

    return jsonb_build_object(
        'event',
        to_jsonb(saved_event),
        'evidence_id',
        required_evidence_id,
        'created',
        true
    );
end;
$$;

revoke all
on function
    record_property_hvac_event_with_evidence (
        text,
        jsonb,
        text
    )
from public;

grant execute
on function
    record_property_hvac_event_with_evidence (
        text,
        jsonb,
        text
    )
to authenticated;
