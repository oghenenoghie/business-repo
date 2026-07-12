import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client } = pg;

const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// An app database is core's schema + ledger's schema (+ the app's own),
// composed together (see the root README: "one database per app"). Ledger's
// RLS policies call core's has_org_role(), which queries core's
// `memberships` table — so a from-scratch database needs core's migrations
// applied first.
const migrationSets = [
  { pkg: "core", dir: path.join(packageRoot, "..", "core", "migrations") },
  { pkg: "ledger", dir: path.join(packageRoot, "migrations") },
];

async function main() {
  const databaseUrl = process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/bp_ledger";
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await client.query(`
      create table if not exists schema_migrations (
        filename   text primary key,
        applied_at timestamptz not null default now()
      )
    `);

    for (const set of migrationSets) {
      const files = (await readdir(set.dir)).filter((f) => f.endsWith(".sql")).sort();
      for (const file of files) {
        const key = `${set.pkg}/${file}`;
        const { rows } = await client.query("select 1 from schema_migrations where filename = $1", [key]);
        if (rows.length > 0) continue;

        const sql = await readFile(path.join(set.dir, file), "utf8");
        console.log(`applying ${key}`);
        await client.query("begin");
        try {
          await client.query(sql);
          await client.query("insert into schema_migrations (filename) values ($1)", [key]);
          await client.query("commit");
        } catch (err) {
          await client.query("rollback");
          throw err;
        }
      }
    }

    // Local/dev/test convenience only — a real deployment rotates this
    // outside version control and sets CORE_APP_USER_PASSWORD from a secret.
    const appUserPassword = process.env.CORE_APP_USER_PASSWORD ?? "app_user";
    const literal = `'${appUserPassword.replace(/'/g, "''")}'`;
    await client.query(`alter role app_user with password ${literal}`);
    console.log("app_user password set");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
