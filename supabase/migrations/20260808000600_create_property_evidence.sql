insert into storage.buckets (
    id,
    name,
    public,
    file_size_limit,
    allowed_mime_types
)
values (
    'property-evidence',
    'property-evidence',
    false,
    10485760,
    array[
        'application/pdf',
        'image/jpeg',
        'image/png'
    ]
)
on conflict (id)
do update set
    public = excluded.public,
    file_size_limit =
        excluded.file_size_limit,
    allowed_mime_types =
        excluded.allowed_mime_types;

create table if not exists
    property_evidence (
        owner_id text not null,
        id text not null,
        property_id text not null,
        hvac_system_id text,
        hvac_event_id text,

        bucket text not null
            default 'property-evidence'
            check (
                bucket =
                    'property-evidence'
            ),

        object_path text not null,
        original_filename text not null,
        mime_type text not null
            check (
                mime_type in (
                    'application/pdf',
                    'image/jpeg',
                    'image/png'
                )
            ),

        byte_size bigint not null
            check (
                byte_size > 0
                and byte_size <= 10485760
            ),

        extraction_method text not null
            check (
                extraction_method in (
                    'pending',
                    'native_pdf',
                    'google_cloud_vision',
                    'manual'
                )
            ),

        parser_version text,

        review_status text not null
            check (
                review_status in (
                    'pending_review',
                    'approved',
                    'rejected',
                    'extraction_failed'
                )
            ),

        created_at timestamptz not null
            default now(),

        updated_at timestamptz not null
            default now(),

        primary key (
            owner_id,
            id
        ),

        constraint
            property_evidence_object_unique
        unique (
            bucket,
            object_path
        ),

        constraint
            property_evidence_owner_path
        check (
            split_part(
                object_path,
                '/',
                1
            ) = owner_id
        ),

        constraint
            property_evidence_hvac_system_fk
        foreign key (
            owner_id,
            hvac_system_id
        )
        references
            property_hvac_systems (
                owner_id,
                id
            )
        on delete restrict,

        constraint
            property_evidence_hvac_event_fk
        foreign key (
            owner_id,
            hvac_event_id
        )
        references
            property_hvac_component_events (
                owner_id,
                id
            )
        on delete restrict
    );

create index if not exists
    idx_property_evidence_owner_property_created
on property_evidence (
    owner_id,
    property_id,
    created_at desc
);

create index if not exists
    idx_property_evidence_owner_system_created
on property_evidence (
    owner_id,
    hvac_system_id,
    created_at desc
)
where hvac_system_id is not null;

create index if not exists
    idx_property_evidence_owner_event
on property_evidence (
    owner_id,
    hvac_event_id
)
where hvac_event_id is not null;

create index if not exists
    idx_property_evidence_owner_review
on property_evidence (
    owner_id,
    review_status,
    created_at desc
);

alter table
    property_evidence
enable row level security;

alter table
    property_evidence
force row level security;

create policy
    "property_evidence_owner_select"
on property_evidence
for select
to authenticated
using (
    owner_id = auth.uid()::text
);

create policy
    "property_evidence_owner_insert"
on property_evidence
for insert
to authenticated
with check (
    owner_id = auth.uid()::text
);

create policy
    "property_evidence_owner_update"
on property_evidence
for update
to authenticated
using (
    owner_id = auth.uid()::text
)
with check (
    owner_id = auth.uid()::text
);

create policy
    "property_evidence_objects_owner_select"
on storage.objects
for select
to authenticated
using (
    bucket_id =
        'property-evidence'
    and
    (storage.foldername(name))[1]
        = auth.uid()::text
);

create policy
    "property_evidence_objects_owner_insert"
on storage.objects
for insert
to authenticated
with check (
    bucket_id =
        'property-evidence'
    and
    (storage.foldername(name))[1]
        = auth.uid()::text
);
