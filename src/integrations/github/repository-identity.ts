import { z } from "zod";
// Shared provider coordinates: Sources trims them; access checks are case-insensitive.
export const repositoryCoordinates = z.object({
  owner: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9-]*$/).transform(value => value.toLowerCase()),
  repo: z.string().trim().regex(/^[A-Za-z0-9_.-]+$/).refine(value => value !== "." && value !== "..").transform(value => value.toLowerCase()),
});
export function repositoryLocation(raw: unknown): string {
  const { owner, repo } = repositoryCoordinates.parse(raw);
  return `https://github.com/${owner}/${repo}`;
}
