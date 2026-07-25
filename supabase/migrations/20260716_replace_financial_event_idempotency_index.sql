drop index if exists idx_financial_events_owner_source_record;

create unique index idx_financial_events_owner_source_record
    on financial_events(owner_id, source_system, source_record_id);
