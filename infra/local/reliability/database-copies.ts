import { requireReliabilityContext } from "@/integrations/reliability/execution-context";
import { reliabilityEnvironment } from "@/integrations/reliability/subprocess-environment";
import { Client } from "pg";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { reliabilityBaselineSchema, bytesHash, databaseServerIdentity, baselineInventory } from "@/features/documentation/runs/reliability-baseline";
import { isDeepStrictEqual } from "node:util";
const exec = promisify(execFile);

/** Explicit preparation command. Creates new databases only; never restores over an existing one. */
export async function createDatabaseCopies(baselinePath: string, outputDirectory: string, prefix: string) {
  const context = requireReliabilityContext(["provision"]);
  if (!/^docsyde_reliability_[a-z0-9_]{1,35}$/.test(prefix)) throw new Error("Invalid isolated database prefix.");
  const baseline = reliabilityBaselineSchema.parse(JSON.parse(await readFile(baselinePath, "utf8")));
  const inventory = await baselineInventory(baseline.repository);
  if (inventory.databaseName !== baseline.sourceDatabase || databaseServerIdentity() !== baseline.serverIdentity
    || !isDeepStrictEqual(inventory.documents, baseline.documents) || !isDeepStrictEqual(inventory.publications, baseline.publications)
    || inventory.schemaFingerprintVersion !== baseline.schemaFingerprintVersion || inventory.contextSha256 !== baseline.contextSha256 || inventory.schemaSha256 !== baseline.schemaSha256) throw new Error("Source baseline drift; do not clone.");
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (url.search) throw new Error("Connection options require an operator-reviewed pg_dump environment; automatic copy refuses to guess them.");
  const names = ["a", "b", "c"].map(suffix => `${prefix}_${suffix}`);
  const admin = new Client({ connectionString: url.href }); await admin.connect();
  const directory = resolve(outputDirectory);
  try {
    const existing = await admin.query("SELECT datname FROM pg_database WHERE datname = ANY($1::text[])", [names]);
    if (existing.rowCount) throw new Error("An experiment database already exists; never overwrite it.");
    await mkdir(directory, { recursive: false, mode: 0o700 });
    const archive = join(directory, "baseline.dump");
    // Credentials stay in child environment, never process arguments, manifests or diagnostics.
    const env = reliabilityEnvironment(context, process.env.DOCSYDE_RELIABILITY_CONTEXT!, "postgres", { PGHOST: url.hostname, PGPORT: url.port || "5432", PGUSER: decodeURIComponent(url.username),
      PGPASSWORD: decodeURIComponent(url.password), PGDATABASE: inventory.databaseName });
    await exec("pg_dump", ["--format=custom", "--no-owner", "--no-acl", `--file=${archive}`], { env });
    for (const name of names) {
      // The validated fixed-prefix name is the only interpolated SQL identifier.
      await admin.query(`CREATE DATABASE "${name}"`);
      await exec("pg_restore", ["--exit-on-error", "--no-owner", "--no-acl", `--dbname=${name}`, archive], { env });
    }
    await writeFile(join(directory, "copies.json"), JSON.stringify({ sourceDatabase: inventory.databaseName,
      archiveSha256: bytesHash(await readFile(archive)), databases: names, createdAt: new Date().toISOString(),
      note: "Retain databases as evidence. Each must independently pass baseline admission before inference." }, null, 2), { flag: "wx", mode: 0o600 });
  } finally { await admin.end(); }
}
