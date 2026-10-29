import "server-only";

import { eq } from "drizzle-orm";
import { getDatabase } from "@/integrations/database/client";
import { projects } from "@/integrations/database/schema";

export async function insertProject(name: string) {
  const [project] = await getDatabase().insert(projects).values({ name }).returning();
  if (!project) throw new Error("Project insert returned no row.");
  return project;
}

export async function findProjectById(id: string) {
  const [project] = await getDatabase().select().from(projects)
    .where(eq(projects.id, id)).limit(1);
  return project ?? null;
}
