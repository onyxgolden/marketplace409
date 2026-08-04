alter table property_rules
    enable row level security;

alter table property_rules
    force row level security;

create policy "property_rules_authenticated_select"
on property_rules
for select
to authenticated
using (
    owner_id is null
    or owner_id = auth.uid()::text
);

create policy "property_rules_owner_insert"
on property_rules
for insert
to authenticated
with check (
    owner_id = auth.uid()::text
);

create policy "property_rules_owner_update"
on property_rules
for update
to authenticated
using (
    owner_id = auth.uid()::text
)
with check (
    owner_id = auth.uid()::text
);

create policy "property_rules_owner_delete"
on property_rules
for delete
to authenticated
using (
    owner_id = auth.uid()::text
);
