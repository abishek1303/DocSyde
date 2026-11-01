import "server-only";
import { compareCommits } from "@/integrations/github/source-reader";
import { assertAllowedRepository } from "../repository-access";
import { summaryInput } from "../summary/change-summary";

/** Read-only preview: no inference, persistence or execution. */
export async function previewSourceComparison(raw: unknown) {
  const input = summaryInput.parse(raw);
  assertAllowedRepository(input.owner, input.repo);
  const comparison = await compareCommits(input, { maxCommits: 100, signal: AbortSignal.timeout(60000) });
  return { base: comparison.base.commitId, head: comparison.head.commitId, files: comparison.files, commits: comparison.commits.length };
}
