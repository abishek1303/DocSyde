import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { createLocalStorage } from "@/integrations/storage/local-storage";

test("environment configuration is lazy, required and resolved once per instance", async (t) => {
  const previous = process.env.DOCSYDE_STORAGE_DIRECTORY;
  const root = await fs.mkdtemp(join(tmpdir(), "docsyde-storage-config-"));
  t.after(async () => {
    if (previous === undefined) delete process.env.DOCSYDE_STORAGE_DIRECTORY;
    else process.env.DOCSYDE_STORAGE_DIRECTORY = previous;
    await fs.rm(root, { recursive: true, force: true });
  });
  delete process.env.DOCSYDE_STORAGE_DIRECTORY;
  const stat = t.mock.method(fs, "stat", fs.stat.bind(fs));
  const mkdir = t.mock.method(fs, "mkdir", fs.mkdir.bind(fs));
  const { getArtifactStorage } = await import("@/integrations/storage/storage");
  assert.equal(stat.mock.callCount(), 0);
  assert.equal(mkdir.mock.callCount(), 0);
  assert.throws(() => getArtifactStorage(), { code: "invalid-configuration" });
  for (const value of ["", "   ", "\t\n"]) {
    process.env.DOCSYDE_STORAGE_DIRECTORY = value;
    assert.throws(() => getArtifactStorage(), { code: "invalid-configuration" });
  }
  const directory = join(root, "artifacts");
  process.env.DOCSYDE_STORAGE_DIRECTORY = relative(process.cwd(), directory);
  const storage = getArtifactStorage();
  assert.equal(mkdir.mock.callCount(), 0);
  process.env.DOCSYDE_STORAGE_DIRECTORY = join(root, "different");
  // Changing cwd after construction must not move this instance's root.
  const cwd = t.mock.method(process, "cwd", () => tmpdir());
  const { key } = await storage.store(new Uint8Array([0, 255]));
  cwd.mock.restore();
  assert.deepEqual(await createLocalStorage(directory).read(key), Buffer.from([0, 255]));
  assert.deepEqual(await storage.read(key), Buffer.from([0, 255]));
  await assert.rejects(fs.stat(join(root, "different")), { code: "ENOENT" });
});

test("explicit roots reject blank and NUL configuration without filesystem access", () => {
  for (const value of ["", "  ", "bad\0path"]) {
    assert.throws(() => createLocalStorage(value), { code: "invalid-configuration" });
  }
});
