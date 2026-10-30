export interface ArtifactStorage {
  store(bytes: Uint8Array): Promise<{ key: string }>;
  read(key: string): Promise<Uint8Array | null>;
}

export class StorageError extends Error {
  constructor(
    public readonly code: "invalid-key" | "invalid-configuration" | "not-a-file",
    message: string,
  ) {
    super(message);
    this.name = "StorageError";
  }
}
