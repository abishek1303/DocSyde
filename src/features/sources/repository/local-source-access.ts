import "server-only";
import { repositoryCoordinates } from "@/integrations/github/repository-identity";
let active = false;
export function assertAllowedRepository(owner: string, repo: string): void {
  ({ owner, repo } = repositoryCoordinates.parse({ owner, repo }));
  const allowed = (process.env.DOCSYDE_ANALYSIS_REPOSITORIES ?? "abishek1303/DocSyde")
    .split(",").map(value => value.trim().toLowerCase()).filter(Boolean);
  if (!allowed.includes(`${owner}/${repo}`.toLowerCase())) throw new Error("This repository is not allowed for local analysis.");
}
export async function withSourceAccess<T>(operation: () => Promise<T>): Promise<T> {
  if (active) throw new Error("Another analysis or source review is running. Wait for it to finish, then retry.");
  active = true;
  try { return await operation(); } finally { active = false; }
}
