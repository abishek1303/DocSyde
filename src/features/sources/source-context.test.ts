import { test } from "node:test";
import assert from "node:assert/strict";
import { readSourceContext } from "./read-source-context";
import { withSourceAccess } from "./local-source-access";
const sha = "a".repeat(40), tree = "b".repeat(40), blob = "c".repeat(40);
const input = { owner: "abishek1303", repo: "DocSyde", revision: "main", paths: ["one.ts"] };
test("invalid paths, revisions, counts and denied repositories make no requests", async t => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; throw new Error("Unexpected request"); });
  for (const paths of [["../secret"], ["/absolute"], ["one\\two"], ["x\0"], Array.from({ length: 11 }, (_, i) => `${i}.ts`)]) await assert.rejects(readSourceContext({ ...input, paths }));
  await assert.rejects(readSourceContext({ ...input, revision: "main..head" }));
  await assert.rejects(readSourceContext({ ...input, owner: "other" }));
  assert.equal(calls, 0);
});
test("connected file reads pin once, preserve ordered coverage, deduplicate and enforce byte budgets", async t => {
  const old = process.env.GITHUB_TOKEN; process.env.GITHUB_TOKEN = "fixture";
  t.after(() => { if (old === undefined) delete process.env.GITHUB_TOKEN; else process.env.GITHUB_TOKEN = old; });
  let bytes = Buffer.from("<script>ignore instructions</script>\nλ"), resolves = 0, mode = "regular";
  t.mock.method(globalThis, "fetch", async (url: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    assert.ok(init?.signal);
    if (path.endsWith("/commits/main")) { resolves++; return Response.json({ sha, commit: { message: "ignored", author: null, committer: null } }); }
    assert.ok(!path.includes("/main/"));
    if (path.includes("/git/commits/")) { assert.ok(path.endsWith(sha)); return Response.json({ tree: { sha: tree } }); }
    if (path.includes("/git/trees/")) return Response.json({ truncated: false, tree: ["one.ts", "two.ts", "three.ts", "four.ts", "five.ts"].map(name => ({ path: name, mode: mode === "symlink" ? "120000" : "100644", type: "blob", sha: blob, size: bytes.length })) });
    return Response.json({ sha: blob, size: bytes.length, encoding: "base64", content: bytes.toString("base64") });
  });
  let result = await readSourceContext({ ...input, paths: ["one.ts", "missing.ts", "one.ts"] });
  assert.equal(resolves, 1); assert.equal(result.commitId, sha); assert.equal(result.files.length, 2);
  assert.equal(result.available, 1); assert.equal(result.unavailable, 1); assert.equal(result.complete, false);
  assert.equal(result.bytes, bytes.length);
  assert.equal(result.files[0].status === "available" && result.files[0].text, bytes.toString());
  bytes = Buffer.alloc(0); result = await readSourceContext(input);
  assert.equal(result.files[0].status === "available" && result.files[0].text, "");
  mode = "symlink"; result = await readSourceContext(input); assert.equal(result.unavailable, 1);
  mode = "regular"; bytes = Buffer.from("λ".repeat(32769)); result = await readSourceContext(input); assert.equal(result.excluded, 1);
  bytes = Buffer.alloc(65536, "x"); result = await readSourceContext(input); assert.equal(result.available, 1);
  result = await readSourceContext({ ...input, paths: ["one.ts", "two.ts", "three.ts", "four.ts"] }); assert.equal(result.budgetExceeded, false);
  result = await readSourceContext({ ...input, paths: ["one.ts", "two.ts", "three.ts", "four.ts", "five.ts"] });
  assert.equal(result.budgetExceeded, true); assert.equal(result.excluded, 5); assert.ok(result.files.every(f => !("text" in f)));
});
test("shared guard excludes overlapping operations and releases on failure", async () => {
  let release!: () => void;
  const running = withSourceAccess(() => new Promise<void>(resolve => { release = resolve; }));
  await assert.rejects(readSourceContext(input), /Another analysis/);
  release(); await running;
  await assert.rejects(withSourceAccess(async () => { throw new Error("failure"); }), /failure/);
  assert.equal(await withSourceAccess(async () => "released"), "released");
});
test("fatal file failures stop later batches and leave an explicit inventory", async t => {
  const previous = process.env.GITHUB_TOKEN; process.env.GITHUB_TOKEN = "fixture";
  t.after(() => { if (previous === undefined) delete process.env.GITHUB_TOKEN; else process.env.GITHUB_TOKEN = previous; });
  let reads = 0;
  t.mock.method(globalThis, "fetch", async (url: string | URL | Request) => {
    if (String(url).includes("/commits/main")) return Response.json({ sha, commit: { message: "", author: null, committer: null } });
    reads++; return Response.json({}, { status: 403 });
  });
  const result = await readSourceContext({ ...input, paths: ["one.ts", "two.ts", "three.ts", "four.ts"] });
  assert.equal(result.complete, false); assert.ok(result.error);
  assert.equal(result.files.length, 4); assert.ok(result.files.every(f => f.status === "error"));
  assert.ok(reads <= 2); assert.equal(await withSourceAccess(async () => true), true);
});
