import "server-only";
import { createGithubClient, withGithubErrors } from "./client";
import { repositoryCoordinates } from "./repository-identity";
import { z } from "zod";
/** One bounded metadata request; never silently treat a truncated tree as complete. */
export async function readRepositoryTree(raw: unknown, sha: string) {
 const coordinates = repositoryCoordinates.parse(raw);
 z.string().regex(/^[a-f0-9]{40}$/i).parse(sha);
 return withGithubErrors(async () => {
  const client = await createGithubClient();
  const { data } = await client.rest.git.getTree({ ...coordinates, tree_sha: sha, recursive: "1" });
  if (data.truncated || data.tree.length > 12000) throw new Error("Repository tree exceeds onboarding metadata budget.");
  return data.tree.filter(entry => entry.type === "blob" && ["100644", "100755"].includes(entry.mode ?? "") && entry.path && entry.path.length <= 512).map(entry => entry.path!).sort();
 });
}
