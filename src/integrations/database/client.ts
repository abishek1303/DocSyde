import "server-only";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

// Reuse connections across Next.js development module reloads. Initialize lazily
// so the unconnected homepage and build never require database credentials.
const databaseGlobal = globalThis as typeof globalThis & { docsydePool?: Pool };

export function getDatabase() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required. Copy the local values from .env.example to .env.");
  }

  databaseGlobal.docsydePool ??= new Pool({
    connectionString,
    max: 5,
    connectionTimeoutMillis: 5000,
  });
  return drizzle(databaseGlobal.docsydePool);
}

export async function closeDatabase() {
  await databaseGlobal.docsydePool?.end();
  databaseGlobal.docsydePool = undefined;
}
