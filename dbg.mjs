import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const sql = readFileSync('supabase/migrations/20261013225000_auth_rate_limit_buckets.sql', 'utf8');
const db = new PGlite();
await db.exec(`do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;`);
await db.exec(sql);
await db.query("insert into public.auth_operation_log (operation_id, action, bucket_keys, outcome) values ('op-dbg2', 'signin', '{}', 'executing')");
try {
  const r1 = await db.query("select public.auth_record_attempt_outcome('op-dbg2', 'credential_succeeded', 'acct-1') as recorded");
  console.log('record:', JSON.stringify(r1.rows[0]));
} catch (e) {
  console.log('ERROR:', e.message);
}
