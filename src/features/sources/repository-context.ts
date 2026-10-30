import "server-only";
import { repositoryCoordinates, repositoryLocation } from "@/integrations/github/repository-identity";
import { readRepositoryContext, writeRepositoryContext } from "@/integrations/database/repository-contexts";
import { assertAllowedRepository } from "./local-source-access";
import { repositoryContextText, runContextText, type GenerationContextSnapshot } from "./generation-context";
function allowedIdentity(raw: unknown) {
  const coordinates = repositoryCoordinates.parse(raw);
  assertAllowedRepository(coordinates.owner, coordinates.repo);
  return repositoryLocation(coordinates);
}
export async function getRepositoryContext(raw: unknown) { return repositoryContextText.parse(await readRepositoryContext(allowedIdentity(raw))); }
export async function saveRepositoryContext(raw: unknown, text: unknown) { const repository = allowedIdentity(raw); const value = repositoryContextText.parse(text); await writeRepositoryContext(repository, value); return value; }
export async function captureGenerationContext(raw: unknown, runText: unknown): Promise<GenerationContextSnapshot> {
  const runContextUsed = runContextText.parse(runText);
  const repositoryContextUsed = await getRepositoryContext(raw);
  return Object.freeze({ repositoryContextUsed, runContextUsed });
}
