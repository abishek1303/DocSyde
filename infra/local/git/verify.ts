import { compareCommits, readFileAtCommit } from "@/integrations/local-git/source-reader";
async function main() {
  const [repositoryPath, base, head, flag, path] = process.argv.slice(2);
  if (!repositoryPath || !base || !head || (flag && (flag !== "--path" || !path))) throw new Error("Usage: git:verify -- <repository> <base> <head> [--path <file>]");
  const comparison = await compareCommits({ repositoryPath, base, head });
  console.log(JSON.stringify({ comparison, file: path ? await readFileAtCommit({ repositoryPath, commitId: comparison.head.commitId, path }) : undefined }, null, 2));
}
main().catch(() => { console.error("Local Git verification failed; check repository, revisions, and file path."); process.exitCode = 1; });
