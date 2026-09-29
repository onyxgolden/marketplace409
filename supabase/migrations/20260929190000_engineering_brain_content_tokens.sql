-- Engineering Brain retrieval-recall fix: store bounded content tokens per index record.
--
-- The query path's pass-1 retrieval gates on metadata (path/symbol) token overlap, so a file
-- whose name never mentions the query's words was invisible no matter how relevant its content.
-- content_tokens carries the deterministic token list mined by extractContentTokens.mjs, letting
-- content terms participate in initial candidate retrieval -- on Vercel there is no git checkout,
-- so this column is the ONLY content signal the deployed query path gets.
--
-- Nullable: runs synced before this column existed (or records mined without tokens) read back
-- as null, and the query path treats missing tokens as metadata-only -- no backfill required.

alter table engineering_brain_records
    add column if not exists content_tokens jsonb;
