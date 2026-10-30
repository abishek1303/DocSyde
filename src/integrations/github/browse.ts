import "server-only";
import { z } from "zod";
import { cache } from "react";
import { createGithubClient, withGithubErrors } from "./client";
import { repositoryCoordinates } from "./repository-identity";
import { revisionInput } from "./source-reader";

export const readRepositoryMetadata = cache(async (owner: string, repo: string) => withGithubErrors(async () => {
  const client = await createGithubClient();
  const { data } = await client.rest.repos.get(repositoryCoordinates.parse({ owner, repo }));
  return { defaultBranch: data.default_branch };
}));

export async function readRecentCommits(raw: unknown, branch?: string, limit = 20, page = 1) {
  z.number().int().min(1).max(100).parse(limit);
  z.number().int().min(1).max(10000).parse(page);
  const coordinates = repositoryCoordinates.parse(raw);
  const selected = branch === undefined ? undefined : revisionInput.parse(branch);
  return withGithubErrors(async () => {
    const client = await createGithubClient();
    const repository = await readRepositoryMetadata(coordinates.owner, coordinates.repo);
    const ref = selected ?? repository.defaultBranch;
    const response = await client.rest.repos.listCommits({ ...coordinates, sha: ref, per_page: limit, page }).catch((error: unknown) => {
      // GitHub returns 409 for an empty repository, rather than an empty list.
      if (error instanceof Error && "status" in error && error.status === 409 && /repository is empty/i.test(error.message)) return { data: [], headers: { link: undefined } };
      throw error;
    });
    const { data } = response;
    return { branch: ref, hasNext: /<[^>]+>;\s*rel="next"/.test(response.headers.link ?? ""), commits: data.map(commit => ({ sha: commit.sha, message: commit.commit.message.split("\n")[0], author: commit.commit.author?.name ?? "Unknown author", date: commit.commit.committer?.date ?? null, url: commit.html_url })) };
  });
}
