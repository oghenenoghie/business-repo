import pg from "pg";

const { Client } = pg;

// Connects to the `postgres` maintenance database and creates the target
// database if it doesn't exist yet. CREATE DATABASE can't run inside a
// migration transaction, so this is a separate step from migrate.ts.
async function main() {
  const targetUrl = new URL(
    process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/bp_core",
  );
  const dbName = targetUrl.pathname.replace(/^\//, "");
  if (!dbName) throw new Error(`DATABASE_URL is missing a database name: ${targetUrl}`);

  const adminUrl = new URL(targetUrl);
  adminUrl.pathname = "/postgres";

  const admin = new Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    const { rows } = await admin.query("select 1 from pg_database where datname = $1", [dbName]);
    if (rows.length === 0) {
      // Database names can't be parameterized; dbName comes from our own
      // DATABASE_URL, not untrusted input.
      await admin.query(`create database "${dbName.replace(/"/g, '""')}"`);
      console.log(`created database ${dbName}`);
    } else {
      console.log(`database ${dbName} already exists`);
    }
  } finally {
    await admin.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
