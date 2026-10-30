import "server-only";
import { repositoryCoordinates, repositoryLocation } from "@/integrations/github/repository-identity";
import { readRecentCommits, readRepositoryMetadata } from "@/integrations/github/browse";
import { revisionInput } from "@/integrations/github/source-reader";
import { assertAllowedRepository } from "./local-source-access";
export type RepositorySearch = { repository?: string; branch?: string; before?: string; id?: string; page?: string };
export function selectedRepository(search: RepositorySearch) {
  const configured = (process.env.DOCSYDE_ANALYSIS_REPOSITORIES ?? "abishek1303/DocSyde").split(",").map(value => value.trim()).filter(Boolean);
  const value = search.repository ?? configured[0];
  if (!value || value.split("/").length !== 2) throw new Error("No valid repository is selected.");
  const [owner, repo] = value.split("/");
  const coordinates = repositoryCoordinates.parse({ owner, repo });
  assertAllowedRepository(coordinates.owner, coordinates.repo);
  const branch = search.branch === undefined ? undefined : revisionInput.parse(search.branch);
  return { ...coordinates, name: `${coordinates.owner}/${coordinates.repo}`, location: repositoryLocation(coordinates), branch };
}
export async function recentChanges(repository: ReturnType<typeof selectedRepository>, limit = 20, page = 1) {
  assertAllowedRepository(repository.owner, repository.repo);
  return readRecentCommits(repository, repository.branch, limit, page);
}

export async function defaultBranch(repository: ReturnType<typeof selectedRepository>) {
  assertAllowedRepository(repository.owner, repository.repo);
  return (await readRepositoryMetadata(repository.owner, repository.repo)).defaultBranch;
}
