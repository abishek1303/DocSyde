import "server-only";
import { assertDemoRepository } from "@/integrations/github/demo-repository";
import { repositoryCoordinates } from "@/integrations/github/repository-identity";
let active = false;
export function assertAllowedRepository(owner: string, repo: string): void {
  ({ owner, repo } = repositoryCoordinates.parse({ owner, repo }));
  assertDemoRepository(owner, repo);

}
export async function withSourceAccess<T>(operation: () => Promise<T>): Promise<T> {
  if (active) throw new Error("Another analysis or source review is running. Wait for it to finish, then retry.");
  active = true;
  try { return await operation(); } finally { active = false; }
}
