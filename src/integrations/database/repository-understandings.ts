import "server-only";
import { eq } from "drizzle-orm";
import { getDatabase } from "./client";
import { repositoryUnderstandings } from "./schema";
export async function readUnderstanding(repository: string): Promise<unknown> {
  if (!process.env.DATABASE_URL) return null;
  const [row] = await getDatabase().select().from(repositoryUnderstandings).where(eq(repositoryUnderstandings.repository, repository)).limit(1);
  return row?.payload ?? null;
}
export async function writeUnderstanding(repository: string, payload: unknown) {
  await getDatabase().insert(repositoryUnderstandings).values({ repository, payload }).onConflictDoUpdate({ target: repositoryUnderstandings.repository, set: { payload } });
}
