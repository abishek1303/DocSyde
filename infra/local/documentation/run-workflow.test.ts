import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { createDocumentationRun, executeDocumentationRun, getDocumentationRun, listDocumentationRuns, latestDocumentationRuns } from "@/features/documentation/run-operations";
import { getDatabase, closeDatabase } from "@/integrations/database/client";
import { documentationRuns, documentationDrafts } from "@/integrations/database/schema";
import { saveDraftPreview } from "@/app/documentation/draft/save-actions";
import { POST } from "@/app/runs/[id]/execute/route";

test("durable run: atomic execution, real stages, review/save retry, outcomes, scope and interruption", async t => {
  const repo = { owner: "run-test", repo: randomUUID() };
  const previous = { allow: process.env.DOCSYDE_ANALYSIS_REPOSITORIES, ai: process.env.BASETEN_API_KEY, github: process.env.GITHUB_TOKEN, signing: process.env.DOCSYDE_DRAFT_SIGNING_KEY, database: process.env.DATABASE_URL };
  process.env.DOCSYDE_ANALYSIS_REPOSITORIES = `${repo.owner}/${repo.repo}`;
  process.env.GITHUB_TOKEN = "fixture"; process.env.BASETEN_API_KEY = "fixture";
  process.env.DOCSYDE_DRAFT_SIGNING_KEY = "run-workflow-test-key-at-least-32-characters";
  const ids: string[] = [], documents: string[] = [];
  t.after(async () => {
    process.env.DATABASE_URL = previous.database;
    await closeDatabase();
    try {
      if (ids.length) await getDatabase().delete(documentationRuns).where(inArray(documentationRuns.id, ids));
      if (documents.length) await getDatabase().delete(documentationDrafts).where(inArray(documentationDrafts.id, documents));
    } finally {
      await closeDatabase();
      for (const [name, value] of Object.entries({ DOCSYDE_ANALYSIS_REPOSITORIES: previous.allow, GITHUB_TOKEN: previous.github, BASETEN_API_KEY: previous.ai, DOCSYDE_DRAFT_SIGNING_KEY: previous.signing })) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    }
  });
  let mode = "success", analyses = 0, drafts = 0;
  const base = "a".repeat(40), head = "b".repeat(40);
  const meta = (sha: string) => ({ sha, html_url: `https://github.com/${repo.owner}/${repo.repo}/commit/${sha}`, parents: sha === head ? [{ sha: base }] : [], commit: { message: "Require a title", author: { name: "Test author" }, committer: { date: "2026-10-30T12:00:00Z" } }, files: [] });
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("baseten")) {
      const body = JSON.parse(String(init?.body));
      if (body.messages[0].content.includes("Interpret meaningful PRODUCT")) {
        analyses++;
        if (mode === "failed") return Response.json({ error: "fixture" }, { status: 500 });
        return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ assessment: "product-change", findings: [{ kind: "behavior-modified", description: "A title is required", before: "Optional", after: "Required", support: "directly-supported", confidence: "high", confidenceReason: "Source schema", citations: [{ evidenceId: "patch-f1", startLine: 1, endLine: 1, excerpt: "+required" }], reachabilityEvidenceIds: [], assumptions: [], uncertainties: [] }], uncertainties: [] }) } }] });
      }
      drafts++;
      return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ title: "Title requirements", associations: [], sections: [{ title: "Create a request", kind: "requirements", associations: [], content: [{ markdown: "A title is required.", factRefs: [mode === "draft-invalid" ? "invented-fact" : "finding-1-after"] }] }] }) } }] });
    }
    if (url.includes("/compare/")) return Response.json({ status: "ahead", merge_base_commit: { sha: base }, total_commits: 1, commits: [meta(head)], files: [{ filename: "form.ts", status: "modified", additions: 1, deletions: 0, ...(mode === "insufficient" ? {} : { patch: "+required" }) }] });
    return Response.json(meta(url.includes(`/commits/${base}`) ? base : head));
  });
  const create = async (same = false) => { const id = await createDocumentationRun({ ...repo, base, head: same ? base : head, paths: [], runContext: "Keep it practical" }); ids.push(id); return id; };
  const id = await create();
  const denied = await POST(new Request(`http://localhost/runs/${id}/execute`, { method: "POST", headers: { origin: "http://other-origin" } }), { params: Promise.resolve({ id }) });
  assert.equal(denied.status, 403);
  assert.equal((await getDocumentationRun(id))?.record.status, "pending");
  const allowed = POST(new Request(`http://localhost/runs/${id}/execute`, { method: "POST", headers: { origin: "http://127.0.0.1:3000", host: "127.0.0.1:3000" } }), { params: Promise.resolve({ id }) });
  await Promise.all([allowed, executeDocumentationRun(id)]);
  assert.equal((await allowed).status, 200);
  let run = await getDocumentationRun(id);
  assert.equal(run?.record.status, "completed", run?.record.summary);
  assert.ok(run?.record.stages.every(stage => stage.status === "completed"));
  assert.equal(analyses, 1); assert.equal(drafts, 1);
  await executeDocumentationRun(id);
  await closeDatabase();
  run = await getDocumentationRun(id);
  assert.equal(analyses, 1); assert.equal(drafts, 1);
  const result = run?.record.result;
  assert.ok(result?.document); assert.ok(result.preview); documents.push(result.document.id);
  const form = new FormData(); form.set("serialized", result.preview.serialized); form.set("signature", result.preview.signature);
  await closeDatabase(); process.env.DATABASE_URL = "postgresql://invalid:invalid@127.0.0.1:1/invalid";
  assert.equal((await saveDraftPreview({ status: "idle" }, form)).status, "error");
  await closeDatabase(); process.env.DATABASE_URL = previous.database;
  assert.equal((await saveDraftPreview({ status: "idle" }, form)).status, "saved");
  assert.ok((await getDocumentationRun(id))?.savedAt);
  assert.equal(analyses, 1); assert.equal(drafts, 1);
  const noChange = await create(true); await executeDocumentationRun(noChange);
  const unchanged = await getDocumentationRun(noChange);
  assert.equal(unchanged?.record.status, "no-change");
  assert.ok(unchanged?.record.stages.slice(2).every(stage => stage.status === "skipped"));
  mode = "insufficient"; const insufficient = await create(); await executeDocumentationRun(insufficient);
  assert.equal((await getDocumentationRun(insufficient))?.record.status, "insufficient-evidence");
  assert.equal(analyses, 1); assert.equal(drafts, 1);
  mode = "failed"; const failed = await create(); await executeDocumentationRun(failed);
  const rejection = await getDocumentationRun(failed);
  assert.equal(rejection?.record.status, "failed");
  assert.equal(rejection?.record.stages[2].status, "failed");
  assert.ok(rejection?.record.stages.slice(3).every(stage => stage.status === "skipped"));
  mode = "draft-invalid"; const invalidDraft = await create(); await executeDocumentationRun(invalidDraft);
  const invalid = await getDocumentationRun(invalidDraft);
  assert.equal(invalid?.record.status, "failed");
  assert.ok(invalid?.record.stages.slice(0, 4).every(stage => stage.status === "completed"));
  assert.equal(invalid?.record.stages[4].status, "failed");
  assert.equal(invalid?.record.result?.document, null);
  const stale = await create(); const original = await getDocumentationRun(stale); assert.ok(original);
  await getDatabase().update(documentationRuns).set({ status: "running", payload: { ...original.record, status: "running", startedAt: new Date(Date.now() - 8 * 60_000).toISOString() } }).where(eq(documentationRuns.id, stale));
  assert.equal((await getDocumentationRun(stale))?.record.status, "interrupted");
  await executeDocumentationRun(stale); assert.equal(drafts, 2);
  assert.equal((await latestDocumentationRuns(repo, [head])).length, 1);
  const first = await listDocumentationRuns({ ...repo, limit: 2 }); assert.equal(first.runs.length, 2); assert.ok(first.nextCursor);
  const second = await listDocumentationRuns({ ...repo, limit: 2, before: first.nextCursor }); assert.equal(second.runs.length, 2); assert.ok(second.runs.every(run => !first.runs.some(previous => previous.id === run.id)));
  process.env.DOCSYDE_ANALYSIS_REPOSITORIES = "another/repo";
  await assert.rejects(() => getDocumentationRun(id), /not allowed/);
  await assert.rejects(() => create(), /not allowed/);
});
