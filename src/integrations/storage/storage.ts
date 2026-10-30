import "server-only";

import type { ArtifactStorage } from "@/integrations/storage/artifact-storage";
import { StorageError } from "@/integrations/storage/artifact-storage";
import { createLocalStorage } from "@/integrations/storage/local-storage";

export function getArtifactStorage(): ArtifactStorage {
  const directory = process.env.DOCSYDE_STORAGE_DIRECTORY;
  if (!directory?.trim()) {
    throw new StorageError("invalid-configuration", "DOCSYDE_STORAGE_DIRECTORY is required.");
  }
  return createLocalStorage(directory);
}
