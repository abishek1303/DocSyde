import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test, type TestContext } from "node:test";
import { compareCommits, readFileAtCommit } from "@/integrations/github/source-reader";
import { SourceReadError, type SourceReadErrorCode } from "@/integrations/github/errors";

const BASE = "a".repeat(40);
const HEAD = "b".repeat(40);
const TREE = "c".repeat(40);
const BLOB = "d".repeat(40);
const repository = { owner: "example", repo: "product" };
const comparisonInput = { ...repository, base: "release/v1", head: "main" };
const fileInput = { ...repository, commitSha: HEAD, path: "file.ts" };

function commit(sha: string) {
  return {
    sha,
    commit: {
      message: `Commit ${sha[0]}`, author: { name: "Developer" },
      committer: { date: "2026-10-28T12:00:00Z" }, tree: { sha: TREE },
    },
    tree: { sha: TREE },
    html_url: "https://github.com/example/product/commit/provider-only",
  };
}

function file(status = "modified") {
  return { filename: "file.ts", status, additions: 2, deletions: 1, patch: "@@ -1 +1 @@\n-old\n+new" };
}

function comparison(overrides: Record<string, unknown> = {}) {
  return {
    status: "ahead", merge_base_commit: commit(BASE), total_commits: 1,
    commits: [commit(HEAD)], files: [file()], ...overrides,
  };
}

type Reply = { body: unknown; status?: number; headers?: Record<string, string> };
type RecordedRequest = { url: URL; init: RequestInit | undefined };

function mockGithub(t: TestContext, respond: (url: URL) => Reply) {
  const previousToken = process.env.GITHUB_TOKEN;
  process.env.GITHUB_TOKEN = "test-token-never-print";
  t.after(() => {
    if (previousToken === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = previousToken;
  });
  const calls: RecordedRequest[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
    calls.push({ url, init });
    assert.equal(url.origin, "https://api.github.com");
    assert.equal(init?.method, "GET");
    assert.ok(init?.signal instanceof AbortSignal);
    assert.equal(init.redirect, "error");
    const reply = respond(url);
    return new Response(JSON.stringify(reply.body), {
      status: reply.status ?? 200,
      headers: { "content-type": "application/json", ...reply.headers },
    });
  });
  return calls;
}

function compareReply(url: URL, body: unknown = comparison()): Reply {
  const path = decodeURIComponent(url.pathname);
  if (path.endsWith("/commits/release/v1")) return { body: commit(BASE) };
  if (path.endsWith("/commits/main")) return { body: commit(HEAD) };
  assert.ok(path.endsWith(`/compare/${BASE}...${HEAD}`), `Unexpected request: ${path}`);
  assert.equal(url.searchParams.get("per_page"), "100");
  return { body };
}

function fileReply(url: URL, options: {
  mode?: string; type?: string; size?: number; bytes?: Buffer; truncated?: boolean;
  blob?: Record<string, unknown>;
} = {}): Reply {
  const bytes = options.bytes ?? Buffer.from("export const value = 1;\n");
  if (url.pathname.endsWith(`/git/commits/${HEAD}`)) return { body: commit(HEAD) };
  if (url.pathname.endsWith(`/git/trees/${TREE}`)) return { body: {
    truncated: options.truncated ?? false,
    tree: [{ path: "file.ts", mode: options.mode ?? "100644", type: options.type ?? "blob",
      sha: BLOB, size: options.size ?? bytes.length }],
  } };
  assert.ok(url.pathname.endsWith(`/git/blobs/${BLOB}`));
  return { body: { sha: BLOB, size: bytes.length, encoding: "base64", content: bytes.toString("base64"), ...options.blob } };
}

function hasCode(code: SourceReadErrorCode) {
  return (error: unknown) => error instanceof SourceReadError && error.code === code;
}

test("pins refs, preserves all paths and normalizes changes into neutral evidence", async (t) => {
  const statuses = ["added", "removed", "modified", "renamed", "copied", "changed"];
  const calls = mockGithub(t, (url) => compareReply(url, comparison({
    files: statuses.map((status, index) => ({ ...file(status), filename: `${index} space/λ.ts`,
      ...(status === "renamed" ? { previous_filename: "old.ts" } : {}),
      ...(status === "added" ? { patch: "" } : status === "removed" ? { patch: undefined } : {}),
    })),
  })));
  const result = await compareCommits(comparisonInput);
  assert.deepEqual(result.base, {
    commitId: BASE, message: "Commit a", author: "Developer", committedAt: "2026-10-28T12:00:00Z",
  });
  assert.equal(result.head.commitId, HEAD);
  assert.deepEqual(result.commits, [result.head]);
  assert.deepEqual(result.files.map((entry) => entry.kind), ["added", "deleted", "modified", "renamed", "copied", "type-changed"]);
  assert.equal(result.files[0].patch, "");
  assert.equal(result.files[1].patch, null);
  assert.equal(result.files[3].previousPath, "old.ts");
  assert.equal(result.files[0].path, "0 space/λ.ts");
  assert.deepEqual(Object.keys(result).sort(), ["base", "commits", "files", "head", "repository"]);
  assert.ok(!JSON.stringify(result).includes("html_url"));
  assert.equal(calls.length, 3);
  assert.equal(new Headers(calls[0].init?.headers).get("authorization"), "token test-token-never-print");
});

test("identical endpoints return empty evidence after resolving refs", async (t) => {
  const calls = mockGithub(t, () => ({ body: commit(BASE) }));
  const result = await compareCommits(comparisonInput);
  assert.deepEqual(result.files, []);
  assert.deepEqual(result.commits, []);
  assert.equal(calls.length, 2);
});

test("paginates commits and preserves first-page files", async (t) => {
  const commits = Array.from({ length: 100 }, (_, index) => commit(index.toString(16).padStart(40, "0")));
  const calls = mockGithub(t, (url) => compareReply(url,
    url.searchParams.get("page") === "2"
      ? comparison({ total_commits: 101, commits: [commit(HEAD)], files: undefined })
      : comparison({ total_commits: 101, commits }),
  ));
  const result = await compareCommits(comparisonInput);
  assert.equal(result.commits.length, 101);
  assert.equal(result.commits.at(-1)?.commitId, HEAD);
  assert.equal(result.files.length, 1);
  assert.equal(calls.length, 4);
});

for (const status of ["behind", "diverged"]) {
  test(`rejects ${status} histories`, async (t) => {
    mockGithub(t, (url) => compareReply(url, comparison({ status })));
    await assert.rejects(compareCommits(comparisonInput), hasCode("unsupported-comparison"));
  });
}

test("rejects merge-base differences even if the status says ahead", async (t) => {
  mockGithub(t, (url) => compareReply(url, comparison({ merge_base_commit: commit(HEAD) })));
  await assert.rejects(compareCommits(comparisonInput), hasCode("unsupported-comparison"));
});

for (const [name, overrides] of Object.entries({
  "file-list cap": { files: Array.from({ length: 300 }, () => file()) },
  "missing files": { files: undefined },
  "unknown status": { files: [file("unrecognized")] },
  "rename without previous path": { files: [file("renamed")] },
  "empty commit page": { total_commits: 2, commits: [] },
  "duplicate commits": { total_commits: 2, commits: [commit(HEAD), commit(HEAD)] },
  "missing head": { commits: [commit(BASE)] },
  "excess commits": { total_commits: 1, commits: [commit(BASE), commit(HEAD)] },
})) {
  test(`rejects incomplete evidence: ${name}`, async (t) => {
    mockGithub(t, (url) => compareReply(url, comparison(overrides)));
    await assert.rejects(compareCommits(comparisonInput), hasCode("incomplete-evidence"));
  });
}

test("rejects a missing later commit page", async (t) => {
  mockGithub(t, (url) => compareReply(url, comparison({ total_commits: 2,
    commits: url.searchParams.get("page") === "2" ? [] : [commit(BASE)],
  })));
  await assert.rejects(compareCommits(comparisonInput), hasCode("incomplete-evidence"));
});

test("reads exact UTF-8 text including BOM and empty content", async (t) => {
  let bytes = Buffer.from("\ufeffexport const value = 'λ';\n");
  mockGithub(t, (url) => fileReply(url, { bytes }));
  assert.deepEqual(await readFileAtCommit(fileInput), {
    path: "file.ts", commitId: HEAD, contentId: BLOB, size: bytes.length,
    status: "available", text: bytes.toString("utf8"),
  });
  bytes = Buffer.alloc(0);
  const empty = await readFileAtCommit(fileInput);
  assert.equal(empty.status, "available");
  if (empty.status === "available") assert.equal(empty.text, "");
});

test("walks directories at immutable tree IDs", async (t) => {
  mockGithub(t, (url) => {
    if (url.pathname.endsWith(`/git/trees/${TREE}`)) return { body: {
      tree: [{ path: "src", mode: "040000", type: "tree", sha: BASE }], truncated: false,
    } };
    if (url.pathname.endsWith(`/git/trees/${BASE}`)) {
      const replacement = new URL(url);
      replacement.pathname = replacement.pathname.replace(BASE, TREE);
      return fileReply(replacement);
    }
    return fileReply(url);
  });
  const result = await readFileAtCommit({ ...fileInput, path: "src/file.ts" });
  assert.equal(result.status, "available");
});

for (const [mode, type, reason] of [
  ["120000", "blob", "symlink"], ["160000", "commit", "submodule"],
  ["040000", "tree", "directory"], ["unknown", "blob", "file-type"],
]) {
  test(`does not fetch contents of ${reason}`, async (t) => {
    const calls = mockGithub(t, (url) => fileReply(url, { mode, type }));
    const result = await readFileAtCommit(fileInput);
    assert.equal(result.status, "unsupported");
    if (result.status === "unsupported") assert.equal(result.reason, reason);
    assert.equal(calls.length, 2);
  });
}

test("does not follow a symlink in a parent path", async (t) => {
  const calls = mockGithub(t, (url) => fileReply(url, { mode: "120000" }));
  const result = await readFileAtCommit({ ...fileInput, path: "file.ts/child" });
  assert.equal(result.status, "unsupported");
  if (result.status === "unsupported") assert.equal(result.reason, "symlink");
  assert.equal(calls.length, 2);
});

test("rejects oversized text before fetching its blob", async (t) => {
  const calls = mockGithub(t, (url) => fileReply(url, { size: 1024 * 1024 + 1 }));
  const result = await readFileAtCommit(fileInput);
  assert.equal(result.status, "unsupported");
  if (result.status === "unsupported") assert.equal(result.reason, "too-large");
  assert.equal(calls.length, 2);
});

test("accepts text exactly at the size limit", async (t) => {
  mockGithub(t, (url) => fileReply(url, { bytes: Buffer.alloc(1024 * 1024, "x") }));
  assert.equal((await readFileAtCommit(fileInput)).status, "available");
});

for (const bytes of [Buffer.from([0xff]), Buffer.from("a\0b")]) {
  test(`reports binary contents (${bytes.toString("hex")})`, async (t) => {
    mockGithub(t, (url) => fileReply(url, { bytes }));
    const result = await readFileAtCommit(fileInput);
    assert.equal(result.status, "unsupported");
    if (result.status === "unsupported") assert.equal(result.reason, "binary");
  });
}

test("rejects truncated trees and inconsistent blobs", async (t) => {
  let truncated = true;
  mockGithub(t, (url) => fileReply(url, { truncated, blob: { size: 999 } }));
  await assert.rejects(readFileAtCommit(fileInput), hasCode("incomplete-evidence"));
  truncated = false;
  await assert.rejects(readFileAtCommit(fileInput), hasCode("incomplete-evidence"));
});

test("reports missing files", async (t) => {
  mockGithub(t, (url) => fileReply(url));
  await assert.rejects(readFileAtCommit({ ...fileInput, path: "missing.ts" }), hasCode("not-found"));
});

test("validates input before credentials or HTTP access", async (t) => {
  const calls = mockGithub(t, () => { throw new Error("No request expected"); });
  for (const base of ["", "a...b", "../main", "owner:main", "main\n"]) {
    await assert.rejects(compareCommits({ ...comparisonInput, base }), hasCode("invalid-input"));
  }
  for (const path of ["", "/absolute", "../secret", "src/../secret", "src\\file", "file\0"]) {
    await assert.rejects(readFileAtCommit({ ...fileInput, path }), hasCode("invalid-input"));
  }
  await assert.rejects(readFileAtCommit({ ...fileInput, commitSha: "main" }), hasCode("invalid-input"));
  await assert.rejects(compareCommits({ ...comparisonInput, owner: "bad/owner" }), hasCode("invalid-input"));
  assert.equal(calls.length, 0);
  delete process.env.GITHUB_TOKEN;
  await assert.rejects(compareCommits(comparisonInput), hasCode("missing-credentials"));
  assert.equal(calls.length, 0);
});

for (const [status, code] of [[401, "unauthorized"], [403, "forbidden"], [404, "not-found"],
  [422, "invalid-input"], [500, "upstream"], [503, "upstream"]] as const) {
  test(`sanitizes HTTP ${status} and does not retry`, async (t) => {
    const calls = mockGithub(t, () => ({ status, body: { message: "provider body test-token-never-print" } }));
    await assert.rejects(readFileAtCommit(fileInput), (error: unknown) => {
      assert.ok(error instanceof SourceReadError);
      assert.equal(error.code, code);
      assert.ok(!error.message.includes("test-token-never-print"));
      assert.ok(!("request" in error));
      return true;
    });
    assert.equal(calls.length, 1);
  });
}

for (const status of [403, 429]) {
  test(`reports rate limits and retry timing (${status})`, async (t) => {
    mockGithub(t, () => ({ status, body: { message: "rate limit" },
      headers: { "retry-after": "60", "x-ratelimit-remaining": "0" } }));
    await assert.rejects(readFileAtCommit(fileInput), (error: unknown) =>
      error instanceof SourceReadError && error.code === "rate-limited" && error.retryAfterSeconds === 60);
  });
}

test("maps transport timeouts without exposing raw errors", async (t) => {
  const calls = mockGithub(t, () => { throw new DOMException("raw error", "TimeoutError"); });
  await assert.rejects(readFileAtCommit(fileInput), hasCode("timeout"));
  assert.equal(calls.length, 1);
});

test("CLI reports invalid arguments and missing credentials on stderr", () => {
  for (const args of [[], ["example", "product", "main", "main", "--wrong", "file"],
    ["example", "product", "main", "main"]]) {
    const result = spawnSync(process.execPath, ["--conditions=react-server", "--import", "tsx",
      "infra/local/github/verify-source.ts", ...args], {
      encoding: "utf8", env: { ...process.env, GITHUB_TOKEN: "" },
    });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.equal(JSON.parse(result.stderr).code, args.length === 4 ? "missing-credentials" : "invalid-input");
  }
});

test("optional commit budget rejects before requesting further pages", async t => {
  const calls = mockGithub(t, url => compareReply(url, comparison({ total_commits: 101 })));
  await assert.rejects(compareCommits(comparisonInput, { maxCommits: 100 }), hasCode("incomplete-evidence"));
  assert.equal(calls.length, 3);
});
test("optional cancellation reaches the request signal", async t => {
  const controller = new AbortController(); controller.abort();
  const previous = process.env.GITHUB_TOKEN; process.env.GITHUB_TOKEN = "test";
  t.after(() => { if(previous === undefined) delete process.env.GITHUB_TOKEN; else process.env.GITHUB_TOKEN = previous; });
  t.mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => {
    assert.equal(init?.signal?.aborted, true);
    throw new DOMException("cancelled", "AbortError");
  });
  await assert.rejects(compareCommits(comparisonInput, { signal: controller.signal }), hasCode("timeout"));
});
