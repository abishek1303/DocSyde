import "server-only";
import { eq } from "drizzle-orm";
import { getDatabase } from "./client";
import { repositoryContexts } from "./schema";
export async function readRepositoryContext(repository: string) {
  if (!process.env.DATABASE_URL) return null;
  const [row] = await getDatabase().select().from(repositoryContexts).where(eq(repositoryContexts.repository, repository)).limit(1);
  return row?.text ?? null;
}
export async function writeRepositoryContext(repository: string, text: string | null) {
  if (text === null) { await getDatabase().delete(repositoryContexts).where(eq(repositoryContexts.repository, repository)); return; }
  await getDatabase().insert(repositoryContexts).values({ repository, text }).onConflictDoUpdate({ target: repositoryContexts.repository, set: { text, updatedAt: new Date() } });
}
