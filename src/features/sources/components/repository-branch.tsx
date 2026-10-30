import { defaultBranch, type selectedRepository } from "../repository-overview";
export async function RepositoryBranch({ repository }: { repository: ReturnType<typeof selectedRepository> }) {
  if (repository.branch) return <>{repository.branch}</>;
  const branch = await defaultBranch(repository).catch(() => null);
  return <>{branch ?? "Default branch unavailable"}</>;
}
