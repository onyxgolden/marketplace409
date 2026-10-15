// Team Brain slice 1 — schema snapshot generator.
//
// Renders the live schema (from migrations/001_team_brain_schema.sql) into a
// deterministic markdown snapshot: migrations/schema.snapshot.md. A test
// regenerates this file and requires a byte-for-byte match, so the snapshot
// is proof — not a hand-written claim — of what the migration creates.

export async function generateSchemaSnapshot(db) {
  const lines = [];
  lines.push("# Team Brain schema snapshot");
  lines.push("");
  lines.push("Generated from `migrations/001_team_brain_schema.sql`. Do not hand-edit;");
  lines.push("regenerate with `node scripts/team-brain/report/generateSchemaSnapshot.mjs` (local only).");
  lines.push("");

  const tables = await db.query(
    `select table_name from information_schema.tables
     where table_schema = 'public' and table_name like 'team_brain_%'
     order by table_name`,
  );
  lines.push(`## tables (${tables.rows.length})`);
  for (const t of tables.rows) {
    lines.push(`- ${t.table_name}`);
  }
  lines.push("");

  for (const t of tables.rows) {
    const name = t.table_name;
    lines.push(`## ${name}`);
    lines.push("");
    const cols = await db.query(
      `select column_name, data_type, is_nullable, column_default, is_identity, identity_generation
       from information_schema.columns
       where table_schema = 'public' and table_name = $1
       order by ordinal_position`,
      [name],
    );
    lines.push("columns:");
    for (const c of cols.rows) {
      const identity = c.is_identity === "YES" ? ` identity(${c.identity_generation})` : "";
      lines.push(`- ${c.column_name}: ${c.data_type}${identity} nullable=${c.is_nullable} default=${c.column_default ?? "none"}`);
    }
    const cons = await db.query(
      `select tc.constraint_name, tc.constraint_type, cc.check_clause
       from information_schema.table_constraints tc
       left join information_schema.check_constraints cc
         on cc.constraint_name = tc.constraint_name and cc.constraint_schema = tc.constraint_schema
       where tc.table_schema = 'public' and tc.table_name = $1
       order by tc.constraint_name`,
      [name],
    );
    lines.push("constraints:");
    for (const k of cons.rows) {
      const clause = k.check_clause ? ` check(${k.check_clause})` : "";
      lines.push(`- ${k.constraint_name}: ${k.constraint_type}${clause}`);
    }
    const idx = await db.query(
      `select indexname from pg_indexes where schemaname = 'public' and tablename = $1 order by indexname`,
      [name],
    );
    lines.push("indexes:");
    for (const i of idx.rows) {
      lines.push(`- ${i.indexname}`);
    }
    lines.push("");
  }
  return `${lines.join("\n")}`;
}
