import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { constants } from "node:fs";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createLocalStorage } from "@/integrations/storage/local-storage";

const key = "12345678-1234-4234-8234-123456789abc";

async function fixture(t: TestContext) {
  const root = await fs.mkdtemp(join(tmpdir(), "docsyde-storage-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

test("binary and empty artifacts persist across adapter instances with private files", async (t) => {
  const root = join(await fixture(t), "fresh", "storage");
  const storage = createLocalStorage(root);
  const open = fs.open.bind(fs);
  const calls = t.mock.method(fs, "open", open);
  for (const bytes of [new Uint8Array([0, 255, 128, 10, 0]), new Uint8Array()]) {
    const result = await storage.store(bytes);
    assert.match(result.key, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.deepEqual(await createLocalStorage(root).read(result.key), Buffer.from(bytes));
    if (process.platform !== "win32") {
      assert.equal((await fs.stat(join(root, result.key))).mode & 0o777, 0o600);
    }
  }
  const writes = calls.mock.calls.filter(call => call.arguments[1] === "wx");
  assert.equal(writes.length, 2);
  assert.ok(writes.every(call => call.arguments[2] === 0o600));
  assert.equal((await fs.readdir(root)).length, 2);
});

test("concurrent collisions use exclusive creation and never overwrite or unlink", async (t) => {
  const root = await fixture(t);
  t.mock.method(crypto, "randomUUID", () => key);
  const unlink = t.mock.method(fs, "unlink", fs.unlink.bind(fs));
  const storage = createLocalStorage(root);
  const results = await Promise.allSettled([
    storage.store(new Uint8Array([1])), storage.store(new Uint8Array([2])),
  ]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  const failure = results.find(result => result.status === "rejected");
  assert.ok(failure?.status === "rejected");
  assert.equal(failure.reason.code, "EEXIST");
  const original = await storage.read(key);
  await assert.rejects(storage.store(new Uint8Array([3])), { code: "EEXIST" });
  assert.deepEqual(await storage.read(key), original);
  assert.equal(unlink.mock.callCount(), 0);
});

test("failed writes clean only their created partial artifact and preserve the I/O error", async (t) => {
  const root = await fixture(t);
  const existingKey = crypto.randomUUID();
  await fs.writeFile(join(root, existingKey), "existing");
  t.mock.method(crypto, "randomUUID", () => key);
  const open = fs.open.bind(fs);
  const failure = Object.assign(new Error("write failed"), { code: "ENOSPC" });
  t.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
    const file = await open(...args);
    t.mock.method(file, "writeFile", async () => {
      await file.write(new Uint8Array([9]));
      throw failure;
    });
    return file;
  });
  await assert.rejects(createLocalStorage(root).store(new Uint8Array([1])), error => error === failure);
  assert.deepEqual(await fs.readdir(root), [existingKey]);
  assert.equal(await fs.readFile(join(root, existingKey), "utf8"), "existing");
});

test("failed exclusive opens never clean up, including non-collision I/O errors", async (t) => {
  const root = await fixture(t);
  await fs.writeFile(join(root, key), "keep");
  t.mock.method(crypto, "randomUUID", () => key);
  const failure = Object.assign(new Error("denied"), { code: "EACCES" });
  t.mock.method(fs, "open", async () => { throw failure; });
  const unlink = t.mock.method(fs, "unlink", fs.unlink.bind(fs));
  await assert.rejects(createLocalStorage(root).store(new Uint8Array()), error => error === failure);
  assert.equal(unlink.mock.callCount(), 0);
  assert.equal(await fs.readFile(join(root, key), "utf8"), "keep");
});

test("malformed keys fail before any filesystem access", async (t) => {
  const storage = createLocalStorage(await fixture(t));
  const unexpected = async () => { throw new Error("Unexpected filesystem access"); };
  const mocks = [t.mock.method(fs, "stat", unexpected), t.mock.method(fs, "lstat", unexpected),
    t.mock.method(fs, "open", unexpected)];
  for (const value of ["", "..", `../${key}`, `/${key}`, `${key}/child`, `${key}\\child`,
    key.toUpperCase(), key.replace("-4234-", "-1234-"), key.replace("-8234-", "-7234-"),
    `${key}\n`, `${key}\0`, `%2e%2e/${key}`, `${key}.png`]) {
    await assert.rejects(storage.read(value), { code: "invalid-key" });
  }
  assert.ok(mocks.every(mock => mock.mock.callCount() === 0));
});

test("only an absent artifact returns null; missing or unusable roots fail", async (t) => {
  const root = await fixture(t);
  assert.equal(await createLocalStorage(root).read(key), null);
  const missing = join(root, "missing");
  await assert.rejects(createLocalStorage(missing).read(key), { code: "ENOENT" });
  await fs.writeFile(join(root, "file"), "root is not a directory");
  await assert.rejects(createLocalStorage(join(root, "file")).read(key), { code: "invalid-configuration" });
  await assert.rejects(createLocalStorage(join(root, "file", "child")).read(key), { code: "ENOTDIR" });
});

test("native read open failures remain distinguishable", async (t) => {
  const storage = createLocalStorage(await fixture(t));
  for (const code of ["EACCES", "EPERM", "EIO", "ENOTDIR"]) {
    const failure = Object.assign(new Error(code), { code });
    const mock = t.mock.method(fs, "open", async () => { throw failure; });
    await assert.rejects(storage.read(key), error => error === failure);
    mock.mock.restore();
  }
});

test("ENOENT after opening a file is an error, not absence", async (t) => {
  const root = await fixture(t);
  await fs.writeFile(join(root, key), "data");
  const open = fs.open.bind(fs);
  const failure = Object.assign(new Error("read failed"), { code: "ENOENT" });
  t.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
    const file = await open(...args);
    t.mock.method(file, "readFile", async () => { throw failure; });
    return file;
  });
  await assert.rejects(createLocalStorage(root).read(key), error => error === failure);
});

test("a root removed between validation and open does not return null", async (t) => {
  const root = join(await fixture(t), "storage");
  await fs.mkdir(root);
  const open = fs.open.bind(fs);
  t.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
    await fs.rmdir(root);
    return open(...args);
  });
  await assert.rejects(createLocalStorage(root).read(key), { code: "ENOENT" });
});

test("symlinks (including dangling links) and directories are rejected", {
  skip: process.platform === "win32" ? "Symlink creation requires Windows privileges" : false,
}, async (t) => {
  const root = await fixture(t);
  const storage = createLocalStorage(root);
  await fs.writeFile(join(root, "target"), "do not follow");
  for (const target of ["target", "absent"]) {
    await fs.symlink(target, join(root, key));
    await assert.rejects(storage.read(key), { code: constants.O_NOFOLLOW ? "ELOOP" : "not-a-file" });
    await fs.unlink(join(root, key));
  }
  await fs.mkdir(join(root, key));
  await assert.rejects(storage.read(key), { code: "not-a-file" });
});

test("FIFOs are rejected without blocking", { skip: process.platform === "win32" }, async (t) => {
  const root = await fixture(t);
  execFileSync("mkfifo", [join(root, key)]);
  await assert.rejects(createLocalStorage(root).read(key), { code: "not-a-file" });
});
