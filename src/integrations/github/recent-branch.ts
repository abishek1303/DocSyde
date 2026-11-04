import "server-only";
import { branchSelectionQuery } from "./branch-query";
import { cache } from "react";
import { z } from "zod";
import { createGithubClient, withGithubErrors } from "./client";
import { SourceReadError } from "./errors";
import { repositoryCoordinates } from "./repository-identity";

const branchPage = z.object({
  repository: z.object({
    defaultBranchRef: z.object({ name: z.string() }).nullable(),
    refs: z.object({ nodes: z.array(z.object({ name: z.string(), target: z.object({ committedDate: z.string().datetime(), messageHeadline: z.string() }) })), pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }) }),
  }).nullable()
});

/** One request per 100 branches avoids a separate commit request for every head. */
export const readRecentBranchSelection = cache(async (owner: string, repo: string) => withGithubErrors(async () => {
  const coordinates = repositoryCoordinates.parse({ owner, repo });
  const client = await createGithubClient(AbortSignal.timeout(30000));
  const tips: { name: string; date: number; title: string }[] = [];
  const cursors = new Set<string>();
  let after: string | null = null, defaultBranch: string | null = null;
  for (let page = 0; page < 10; page++) {
    const raw: unknown = await client.graphql(branchSelectionQuery, { ...coordinates, after });
    const { repository } = branchPage.parse(raw);
    if (!repository) throw new SourceReadError("not-found", "Repository is unavailable.");
    defaultBranch = repository.defaultBranchRef?.name ?? null;
    tips.push(...repository.refs.nodes.map(branch => ({ name: branch.name, date: Date.parse(branch.target.committedDate), title: branch.target.messageHeadline.slice(0, 600) })));
    if (!repository.refs.pageInfo.hasNextPage) {
      if (new Set(tips.map(tip => tip.name)).size !== tips.length) throw new SourceReadError("incomplete-evidence", "Branch listing changed while it was read.");
      tips.sort((a, b) => b.date - a.date || (a.name === defaultBranch ? -1 : b.name === defaultBranch ? 1 : a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      return { selected: tips[0]?.name ?? null, names: tips.map(tip => tip.name), changes: tips.map(tip => ({ branch: tip.name, title: tip.title })) };
    }
    const cursor = repository.refs.pageInfo.endCursor;
    if (!cursor || cursors.has(cursor)) throw new SourceReadError("incomplete-evidence", "Branch listing is incomplete.");
    cursors.add(cursor); after = cursor;
  }
  throw new SourceReadError("incomplete-evidence", "Automatic selection supports up to 1000 branches. Select a branch explicitly.");
}));
