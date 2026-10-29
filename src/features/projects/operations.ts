import "server-only";

import { z } from "zod";
import { findProjectById, insertProject } from "@/integrations/database/projects";
import type { Project } from "@/features/projects/project";

const projectName = z.string().trim().min(1).max(200);
const projectId = z.uuid();

// Local CLI proof only. Add resource authorization here before exposing these
// operations through a user-facing action or endpoint.
export async function createProject(name: unknown): Promise<Project> {
  return insertProject(projectName.parse(name));
}

export async function getProject(id: unknown): Promise<Project | null> {
  return findProjectById(projectId.parse(id));
}
