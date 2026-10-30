import "server-only";

import crypto from "node:crypto";
import { constants } from "node:fs";
import fs from "node:fs/promises";
import { join, resolve } from "node:path";
import { StorageError, type ArtifactStorage } from "@/integrations/storage/artifact-storage";

const artifactKey = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function validateKey(key: string) {
  if (typeof key !== "string" || !artifactKey.test(key)) {
    throw new StorageError("invalid-key", "Expected a canonical lowercase UUID v4 artifact key.");
  }
}

export function createLocalStorage(directory: string): ArtifactStorage {
  if (typeof directory !== "string" || !directory.trim() || directory.includes("\0")) {
    throw new StorageError("invalid-configuration", "A storage directory is required.");
  }
  const root = resolve(directory);

  async function requireRoot() {
    if (!(await fs.stat(root)).isDirectory()) {
      throw new StorageError("invalid-configuration", "Storage root must be a directory.");
    }
  }

  return {
    async store(bytes) {
      const key = crypto.randomUUID();
      validateKey(key);
      const path = join(root, key);
      await fs.mkdir(root, { recursive: true });
      // Exclusive open is the ownership boundary: failed opens never reach cleanup.
      const file = await fs.open(path, "wx", 0o600);
      try {
        await file.writeFile(bytes);
        await file.close();
        return { key };
      } catch (error) {
        // Preserve the original I/O error even if best-effort cleanup also fails.
        await file.close().catch(() => {});
        await fs.unlink(path).catch(() => {});
        throw error;
      }
    },

    async read(key) {
      validateKey(key);
      const path = join(root, key);
      await requireRoot();
      let file;
      try {
        // On platforms without O_NOFOLLOW, reject links before opening instead.
        if (!constants.O_NOFOLLOW && (await fs.lstat(path)).isSymbolicLink()) {
          throw new StorageError("not-a-file", "Artifact must be a regular file.");
        }
        // Nonblocking open lets us reject FIFOs without waiting for a writer.
        file = await fs.open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") {
          // A removed/unusable root must not look like a missing artifact.
          await requireRoot();
          return null;
        }
        throw error;
      }
      try {
        if (!(await file.stat()).isFile()) {
          throw new StorageError("not-a-file", "Artifact must be a regular file.");
        }
        return await file.readFile();
      } finally {
        await file.close();
      }
    },
  };
}
