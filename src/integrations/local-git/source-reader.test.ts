import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, realpath, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { compareCommits, readFileAtCommit } from "@/integrations/local-git/source-reader";
test("committed evidence ignores working tree and supports renames, binary and empty files", async () => {
  const repositoryPath = await mkdtemp(join(tmpdir(), "docsyde-git-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repositoryPath }).toString().trim();
  try {
    git("init", "-q"); git("config", "user.name", "Proof"); git("config", "user.email", "proof@example.test");
    await writeFile(join(repositoryPath, "old.txt"), "original\n"); git("add", "."); git("commit", "-qm", "base"); const base = git("rev-parse", "HEAD");
    git("mv", "old.txt", "new name.txt"); await writeFile(join(repositoryPath, "binary"), Buffer.from([0, 255])); await writeFile(join(repositoryPath, "empty"), "");
    git("add", "."); git("commit", "-qm", "head"); const head = git("rev-parse", "HEAD");
    await writeFile(join(repositoryPath, "new name.txt"), "dirty"); const before = git("status", "--porcelain");
    const evidence = await compareCommits({ repositoryPath, base, head });
    assert.equal(evidence.files.find((file) => file.kind === "renamed")?.previousPath, "old.txt");
    const file = await readFileAtCommit({ repositoryPath, commitId: head, path: "new name.txt" });
    assert.equal(file.status === "available" && file.text, "original\n");
    assert.equal((await readFileAtCommit({ repositoryPath, commitId: head, path: "binary" })).status, "unsupported");
    assert.deepEqual((await compareCommits({ repositoryPath, base, head: base })).files, []);
    await assert.rejects(compareCommits({ repositoryPath, base: head, head: base }));
    assert.equal(git("status", "--porcelain"), before);
  } finally { await rm(repositoryPath, { recursive: true, force: true }); }
});

test("subdirectory inputs compare and read paths relative to the repository root", async () => {
  const root = await mkdtemp(join(tmpdir(), "docsyde-root-"));
  const nested = join(root, "nested");
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root }).toString().trim();
  try {
    git("init", "-q"); git("config", "user.name", "Proof"); git("config", "user.email", "proof@example.test");
    await mkdir(nested);
    await writeFile(join(root, "file.txt"), "root before\n");
    await writeFile(join(nested, "file.txt"), "nested before\n");
    git("add", "."); git("commit", "-qm", "base"); const base = git("rev-parse", "HEAD");
    await writeFile(join(root, "file.txt"), "root after\n");
    await writeFile(join(nested, "file.txt"), "nested after\n");
    git("add", "."); git("commit", "-qm", "head"); const head = git("rev-parse", "HEAD");

    const fromRoot = await compareCommits({ repositoryPath: root, base, head });
    const fromNested = await compareCommits({ repositoryPath: nested, base, head });
    assert.deepEqual(fromNested, fromRoot);
    assert.equal(fromNested.repository.location, pathToFileURL(await realpath(root)).href);
    for (const change of fromNested.files) {
      const fromNestedRead = await readFileAtCommit({ repositoryPath: nested, commitId: head, path: change.path });
      assert.deepEqual(fromNestedRead, await readFileAtCommit({ repositoryPath: root, commitId: head, path: change.path }));
      assert.equal(fromNestedRead.status === "available" && fromNestedRead.text,
        change.path === "file.txt" ? "root after\n" : "nested after\n");
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

for (const oldPath of ["a", "a[1]"]) {
  test(`rename evidence excludes changes beneath the former file path ${oldPath}`, async () => {
    const repositoryPath = await mkdtemp(join(tmpdir(), "docsyde-rename-"));
    const git = (...args: string[]) => execFileSync("git", args, { cwd: repositoryPath }).toString().trim();
    try {
      git("init", "-q"); git("config", "user.name", "Proof"); git("config", "user.email", "proof@example.test");
      await writeFile(join(repositoryPath, oldPath), "unchanged renamed content\n");
      git("add", "."); git("commit", "-qm", "base"); const base = git("rev-parse", "HEAD");
      git("mv", oldPath, "z"); await mkdir(join(repositoryPath, oldPath));
      await writeFile(join(repositoryPath, oldPath, "child"), "unrelated child\nsecond line\n");
      git("add", "."); git("commit", "-qm", "head"); const head = git("rev-parse", "HEAD");

      const evidence = await compareCommits({ repositoryPath, base, head });
      assert.equal(evidence.files.length, 2);
      const renamed = evidence.files.find((file) => file.kind === "renamed");
      assert.ok(renamed);
      assert.equal(renamed.path, "z"); assert.equal(renamed.previousPath, oldPath);
      assert.equal(renamed.additions, 0); assert.equal(renamed.deletions, 0);
      assert.equal(renamed.patch, `diff --git a/${oldPath} b/z\nsimilarity index 100%\nrename from ${oldPath}\nrename to z\n`);
      const child = evidence.files.find((file) => file.path === `${oldPath}/child`);
      assert.ok(child); assert.equal(child.additions, 2); assert.equal(child.deletions, 0);
      assert.match(child.patch ?? "", /\+unrelated child/);
      assert.doesNotMatch(child.patch ?? "", /rename from/);
    } finally { await rm(repositoryPath, { recursive: true, force: true }); }
  });
}
