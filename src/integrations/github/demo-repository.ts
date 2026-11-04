import "server-only";
import { repositoryCoordinates } from "./repository-identity";
import { SourceReadError } from "./errors";

export function demoSingleRepoOnly() {
  return process.env.DOCSYDE_DEMO_SINGLE_REPO_ONLY === "true";
}

/** This limits DocSyde's target; it does not inspect the token's repository grants. */
export function demoRepository() {
  if (!demoSingleRepoOnly()) return null;
  const configured = [...new Set((process.env.DOCSYDE_ANALYSIS_REPOSITORIES ?? "").split(",").map(value => value.trim().toLowerCase()).filter(Boolean))];
  const parts = configured[0]?.split("/");
  const parsed = parts?.length === 2 ? repositoryCoordinates.safeParse({ owner: parts[0], repo: parts[1] }) : null;
  if (configured.length !== 1 || !parsed?.success) throw new SourceReadError("invalid-input", "Demo mode requires exactly one owner/repository in DOCSYDE_ANALYSIS_REPOSITORIES.");
  return parsed.data;
}

export function assertDemoRepository(owner: string, repo: string) {
  const target = demoRepository();
  if (target && (owner.toLowerCase() !== target.owner || repo.toLowerCase() !== target.repo)) {
    throw new SourceReadError("forbidden", "Demo mode only allows access to the configured target repository.");
  }
}
