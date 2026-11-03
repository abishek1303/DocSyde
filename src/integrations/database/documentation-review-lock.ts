import "server-only";
import { sql } from "drizzle-orm";
import type { DatabaseExecutor } from "./client";

/** Project-scoped lifecycle lock, acquired before run/review row locks. */
export async function lockDocumentationProject(database: DatabaseExecutor, repository: string) {
  await database.execute(sql`SELECT pg_advisory_xact_lock(178524, hashtext(${repository}))`);
}
