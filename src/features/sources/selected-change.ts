import "server-only";
import { z } from "zod";
import { readCommitDetails } from "@/integrations/github/browse";
import { repositoryCoordinates } from "@/integrations/github/repository-identity";
import { resolveRevision, repositoryPathInput } from "@/integrations/github/source-reader";
import { assertAllowedRepository } from "./local-source-access";
import { productChangeInput } from "./product-change-analysis";

export function comparisonBase(parents: string[]) { return parents[0] ?? null; }
export async function readSelectedChange(raw: unknown, sha: unknown) {
  const coordinates = repositoryCoordinates.parse(raw);
  assertAllowedRepository(coordinates.owner, coordinates.repo);
  const commit = await readCommitDetails(coordinates, z.string().regex(/^[a-f0-9]{40}$/i).parse(sha));
  return { ...commit, base: comparisonBase(commit.parents), merge: commit.parents.length > 1 };
}
export async function pinChangeInput(raw: unknown) {
  const input = productChangeInput.parse(raw);
  assertAllowedRepository(input.owner, input.repo);
  input.paths.forEach(path => repositoryPathInput.parse(path));
  const [base, head] = await Promise.all([
    resolveRevision({ ...input, revision: input.base }), resolveRevision({ ...input, revision: input.head }),
  ]);
  return { ...input, base: base.commitId, head: head.commitId };
}
