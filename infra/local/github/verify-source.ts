import "dotenv/config";
import { compareCommits, readFileAtCommit } from "@/integrations/github/source-reader";
import { SourceReadError } from "@/integrations/github/errors";

async function main() {
  const [owner, repo, base, head, flag, path, ...extra] = process.argv.slice(2);
  if (!owner || !repo || !base || !head || extra.length ||
    (flag !== undefined && (flag !== "--path" || !path))) {
    throw new SourceReadError("invalid-input", "Usage: npm run github:verify -- <owner> <repo> <base> <head> [--path <path>]");
  }
  const comparison = await compareCommits({ owner, repo, base, head });
  const file = path ? await readFileAtCommit({ owner, repo, commitSha: comparison.head.commitId, path }) : undefined;
  console.log(JSON.stringify({ comparison, ...(file ? { file } : {}) }, null, 2));
}

main().catch((error: unknown) => {
  const failure = error instanceof SourceReadError ? error
    : new SourceReadError("upstream", "Source verification failed.");
  console.error(JSON.stringify({ code: failure.code, message: failure.message, retryAfterSeconds: failure.retryAfterSeconds }));
  process.exitCode = 1;
});
