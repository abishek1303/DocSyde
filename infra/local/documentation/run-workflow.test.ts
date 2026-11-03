import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, inArray, sql } from "drizzle-orm";
import { reconcileDocumentationRuns, writeRunCheckpoint } from "@/features/documentation/runs/run-checkpoints";
import { runRecordV2 } from "@/features/documentation/runs/run-record";
import { getDatabase, closeDatabase } from "@/integrations/database/client";
import { documentationRuns, documentationDrafts, documentationReviews, documentationPublications } from "@/integrations/database/schema";
import { getDocumentationReview, retainDocumentationProposal } from "@/features/documentation/review/review-proposal-operations";
import { draftFixture } from "./draft-fixture";
import { reviewProposalFixture } from "./review-fixtures";
import { initialStages } from "@/features/documentation/drafts/run-progress";
import { RUN_DEADLINE_MS, RUN_HEARTBEAT_MS } from "@/features/documentation/runs/run-workflow-state";
import { transformationEntryFixture } from "./transformation-fixtures";
import type { TransformationAuthorization } from "@/features/documentation/transformation/transformation-input";
import type { SupportUnit } from "@/features/documentation/transformation/transformation-validation";

// Real PostgreSQL, feature operations, canonical validators and Chromium; only provider transport is mocked.
test("schema-v2 end-to-end orchestration and local execution boundary", { timeout: 120_000 }, async t => {
  const load = createRequire(import.meta.url);
  const forbidden = t.mock.fn(() => { throw new Error("Orchestration must never approve/save/publish"); });
  const guarded = [
    ["../../../src/features/documentation/documents/operations.ts", ["saveDocumentationDraft"]],
    ["../../../src/features/documentation/review/apply-documentation-review.ts", ["applyDocumentationReview"]],
    ["../../../src/features/documentation/publication/publication-operations.ts", ["publishDocumentation", "unpublishDocumentation"]],
    ["../../../src/integrations/database/documentation-drafts.ts", ["insertDocumentationDraft"]],
    ["../../../src/integrations/database/documentation-publications.ts", ["insertPublicationIfAbsent", "replacePublication"]],
    ["../../../src/integrations/database/documentation-reviews.ts", ["documentationReviewTransaction"]],
  ] as const;
  const restore: (() => void)[] = [];
  for (const [path, names] of guarded) {
    const resolved = load.resolve(path), original: object = load(resolved), cached = load.cache[resolved]!;
    cached.exports = { ...original, ...Object.fromEntries(names.map(name => [name, forbidden])) };
    restore.push(() => { cached.exports = original; });
  }
  t.after(() => { restore.forEach(reset => reset()); assert.equal(forbidden.mock.callCount(), 0); });
  const { createDocumentationRun, executeDocumentationRun, getDocumentationRun, runView, listDocumentationRuns, latestDocumentationRuns }: typeof import("@/features/documentation/runs/run-operations") = load("../../../src/features/documentation/runs/run-operations.ts");
  const { cancelDocumentationRun, stopRunCoordinator, RunBusyError }: typeof import("@/features/documentation/runs/run-coordinator") = load("../../../src/features/documentation/runs/run-coordinator.ts");
  const { POST }: typeof import("@/app/runs/[id]/execute/route") = load("../../../src/app/runs/[id]/execute/route.ts");
  const repo = { owner: "run-test", repo: randomUUID() }, repository = `https://github.com/${repo.owner}/${repo.repo}`;
  const env = { ...process.env }, directory = await mkdtemp(join(tmpdir(), "docsyde-run-"));
  process.env.DOCSYDE_ANALYSIS_REPOSITORIES = `${repo.owner}/${repo.repo}`;
  process.env.GITHUB_TOKEN = "fixture"; process.env.BASETEN_API_KEY = "fixture"; process.env.META_API_KEY = "fixture";
  process.env.DOCSYDE_STORAGE_DIRECTORY = directory;
  delete process.env.DOCSYDE_RUN_RUNTIME_CONFIG;
  const ids: string[] = [], proposalIds: string[] = [];
  const server = createServer((_req, res) => { res.setHeader("Content-Type", "text/html"); res.end('<h1>Request</h1><button id="open" onclick="document.querySelector(\'dialog\').showModal()">Details</button><dialog>Title is required.</dialog>'); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const counts: Record<string, number> = {};
  let mode = "actionable", hold: (() => void) | undefined, held: Promise<void> | undefined, reached: (() => void) | undefined;
  let baselineId: string | null = null;
  let same = false, phaseToHold = "source";
  const { writeUnderstanding } = await import("@/integrations/database/repository-understandings");
  const { repositoryUnderstandings } = await import("@/integrations/database/schema");
  const { eq: equals } = await import("drizzle-orm");
  await writeUnderstanding(repository, { schemaVersion: 1, repository, sha: "a".repeat(40), analyzedAt: new Date().toISOString(), files: [], summary: { purpose: "Request tracker", audience: "Unknown", terminology: [], workflows: [], surfaces: [], gaps: [] } });
  const realFetch = globalThis.fetch;
  const base = "a".repeat(40), head = "b".repeat(40);
  const patch = '@@ -0,0 +1,2 @@\n+required\n+route: "/requests/new"';
  const meta = (sha: string) => ({ sha, html_url: `${repository}/commit/${sha}`, parents: sha === head ? [{ sha: base }] : [], commit: { message: "Require a title", author: { name: "Fixture" }, committer: { date: "2026-10-30T12:00:00Z" } }, files: [] });
  const count = (key: string) => { counts[key] = (counts[key] ?? 0) + 1; };
  t.mock.method(globalThis, "fetch", async (url: unknown, init?: RequestInit) => {
    if (String(url).startsWith(baseUrl)) return realFetch(String(url), init);
    if (String(url).includes("/compare/")) return Response.json({ status: same ? "identical" : "ahead", merge_base_commit: { sha: base }, total_commits: same ? 0 : 1, commits: same ? [] : [meta(head)], files: same ? [] : [{ filename: "form.ts", status: "added", additions: 2, deletions: 0, patch }] });
    if (!String(url).includes("baseten") && !String(url).includes("meta")) return Response.json(meta(String(url).includes(`/commits/${base}`) ? base : head));
    const body = JSON.parse(String(init?.body));
    const text = String(url).includes("baseten");
    const instructions = text ? String(body.messages[0].content) : "";
    const input = text ? JSON.parse(body.messages[1].content) : null;
    let phase: string, output: unknown;
    if (!text) { phase = "vision"; output = { elements: [], observations: ["Title is required."], limitations: ["Visible state only"] }; }
    else if (instructions.includes("Interpret meaningful PRODUCT")) {
      assert.equal(input.repositoryUnderstandingAdvisory.summary.purpose, "Request tracker");
      assert.ok(!JSON.stringify(input.evidence).includes("Request tracker"));
      phase = "source"; output = { findings: [{ kind: "field-requirement-changed", description: "A title is required", before: "Optional", after: "Required", support: "directly-supported", confidence: "high", confidenceReason: "Literal source", citations: [{ evidenceId: "patch-f1", startLine: 2, endLine: 2 }], reachabilityEvidenceIds: [], assumptions: [], uncertainties: [] }], uncertainties: [] };
    } else if (Array.isArray(input.targets)) {
      phase = "decision"; output = mode === "not-needed" ? { status: "not-needed", reason: "Source is sufficient for this change", staticEvidence: "sufficient", targets: [], uncertainties: [] }
        : { status: "inspect", reason: "Inspect rendered requirement", staticEvidence: "uncertain", targets: [{ findingRef: "finding-1", targetRef: "target-0", reason: "Check the requirement label" }], uncertainties: [] };
    } else if (input.candidates) {
      phase = "selection"; output = { selected: [{ checkpointId: input.candidates[0].checkpointId, sourceRefs: ["source-1"], question: "What requirement is visible?" }] };
    } else if (input.visualReferences) {
      phase = "impact";
      assert.ok(input.runtimeInspection, "Coverage context reaches synthesis");
      output = { assessment: mode === "unresolved" ? "insufficient-evidence" : "product-change", summary: "Request requirements changed", claims: [{ description: "A title is required", kind: "behavior-change", confidence: "high", confidenceReason: "Literal source", before: "Optional", after: "Required", uncertainties: [], references: ["source-1"] }], contradictions: [], uncertainties: [] };
    } else if (input.candidateCoverage) {
      phase = "planning";
      assert.ok(input.impact.runtimeInspection, "Coverage reaches planning");
      const action = mode === "unresolved" ? "unresolved" : mode === "no-change" ? "no-change" : "add";
      output = { decisions: [{ action, documentId: mode === "no-change" ? baselineId : null, sectionId: null, reason: "Source-supported requirement needs guidance", updateIntent: action === "add" ? "Explain required title" : "", claimRefs: ["claim-1"] }, ...(mode === "mixed" || mode === "partial" ? [{ action: mode === "mixed" ? "unresolved" : "add", documentId: null, sectionId: null, reason: "Another requirement needs independent review", updateIntent: "Explain required title", claimRefs: ["claim-1"] }] : [])], uncertainties: [] };
    } else if (input.units) {
      phase = "support"; output = { verdicts: input.units.map((unit: SupportUnit) => ({ unitId: unit.id, verdict: mode === "unsupported" || mode === "partial" && unit.decisionId === "decision-2" ? "unsupported" : "supported", reason: "Fixture source requirement" })) };
    } else {
      assert.ok(input.authorizations, "Legacy draft generation is never invoked");
      phase = "transformation"; output = { entries: input.authorizations.map((auth: TransformationAuthorization) => transformationEntryFixture(auth, input.documents)) };
    }
    count(phase);
    if (phase === phaseToHold && held) {
      reached?.();
      await Promise.race([held, new Promise<never>((_resolve, reject) => {
        if (init?.signal?.aborted) reject(new Error("cancelled"));
        else init?.signal?.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
      })]);
    }
    if (mode === "provider-failure" && phase === "source" || mode === "support-failure" && phase === "support") return Response.json({}, { status: 500 });
    return Response.json({ model: "mock-run", choices: [{ finish_reason: "stop", message: { content: JSON.stringify(output) } }] });
  });
  const create = async () => { const id = await createDocumentationRun({ ...repo, base, head: same ? base : head, paths: [] }); ids.push(id); return id; };
  const read = async (id: string) => { const run = await getDocumentationRun(id); assert.ok(run); return runRecordV2.parse(run.record); };
  const wait = async (id: string) => {
    for (let i = 0; i < 1000; i++) { const record = await read(id); if (record.status === "finished") { if (record.retainedProposal) proposalIds.push(record.retainedProposal.proposalId); await new Promise(resolve => setTimeout(resolve, 10)); return record; } await new Promise(resolve => setTimeout(resolve, 20)); }
    throw new Error("Run did not finish within bounded test wait.");
  };
  const run = async () => { const id = await create(); await executeDocumentationRun(id); return { id, record: await wait(id) }; };
  const configPath = join(directory, "workflow.json");
  const configure = async (paths = ["/requests/new"], broken = false) => {
    await writeFile(configPath, JSON.stringify({ repository, id: "request", version: "1", supportedPathnames: paths,
      runtime: { mode: "attach", options: { baseUrl, startupTimeoutMs: 5000 } },
      workflow: { path: "/requests/new", steps: [{ type: "click", selector: broken ? "#missing" : "#open" }], limits: { timeoutMs: broken ? 1000 : 10_000 } }, description: "Request requirements", maxSelectedScreenshots: 1 }));
    process.env.DOCSYDE_RUN_RUNTIME_CONFIG = configPath;
  };
  t.after(async () => {
    hold?.(); await stopRunCoordinator();
    if (ids.length) await getDatabase().delete(documentationRuns).where(inArray(documentationRuns.id, ids));
    if (proposalIds.length) await getDatabase().delete(documentationReviews).where(inArray(documentationReviews.id, proposalIds));
    await getDatabase().delete(repositoryUnderstandings).where(equals(repositoryUnderstandings.repository, repository));
    await closeDatabase(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(directory, { recursive: true, force: true });
    for (const key of new Set([...Object.keys(env), ...Object.keys(process.env)])) { if (env[key] === undefined) delete process.env[key]; else process.env[key] = env[key]; }
  });

  await t.test("202, disconnect independence, busy admission, exact source-only calls and authority", async () => {
    const id = await create(), second = await create();
    const arrived = new Promise<void>(resolve => { reached = resolve; }); held = new Promise(resolve => { hold = resolve; });
    const denied = await POST(new Request(`http://localhost/runs/${id}/execute`, { method: "POST", headers: { origin: "http://other-origin", host: "localhost" } }), { params: Promise.resolve({ id }) });
    assert.equal(denied.status, 403); assert.equal((await read(id)).status, "pending");
    const requestAbort = new AbortController();
    const request = new Request(`http://localhost/runs/${id}/execute`, { method: "POST", signal: requestAbort.signal, headers: { origin: "http://localhost", host: "localhost" } });
    assert.equal((await POST(request, { params: Promise.resolve({ id }) })).status, 202);
    await Promise.race([arrived, new Promise((_, reject) => setTimeout(() => reject(new Error("Source transport not reached")), 3000))]); requestAbort.abort();
    assert.equal((await executeDocumentationRun(id)).accepted, false);
    await assert.rejects(executeDocumentationRun(second), RunBusyError);
    const busyResponse = await POST(new Request(`http://localhost/runs/${second}/execute`, { method: "POST", headers: { origin: "http://localhost", host: "localhost" } }), { params: Promise.resolve({ id: second }) });
    assert.equal(busyResponse.status, 409);
    const checkpoint = await read(id); assert.equal(checkpoint.activeStage, "source-analysis"); assert.ok(checkpoint.contextSnapshot);
    hold!(); held = undefined;
    const completed = await wait(id); assert.equal(completed.disposition, "awaiting-review", completed.reason ?? "");
    assert.equal(completed.runtime?.outcome, "unavailable"); assert.equal(completed.runtime?.decision, "not-evaluated");
    assert.deepEqual(counts, { source: 1, impact: 1, planning: 1, transformation: 1, support: 1 });
    const retained = await getDocumentationReview(completed.retainedProposal!.proposalId); assert.equal(retained.status, "found");
    if (retained.status === "found") {
      assert.equal(retained.proposalHash, completed.retainedProposal!.proposalHash);
      assert.equal(retained.review, null);
      assert.equal(retained.proposal.plan.qualifications.runtimeInspection?.outcome, "unavailable");
      assert.ok(retained.proposal.results[0].limitations.some(l => l.includes("unavailable")));
    }
    assert.ok(!JSON.stringify(completed).includes('"candidates"'));
    await executeDocumentationRun(id); assert.equal(counts.source, 1);
    await cancelDocumentationRun(second);
    assert.equal((await wait(second)).disposition, "cancelled");
  });
  await t.test("empty source comparison has zero inference", async () => {
    const before = { ...counts }; same = true;
    const { record } = await run(); same = false;
    assert.equal(record.disposition, "no-change"); assert.equal(record.reason, "no-source-differences"); assert.deepEqual(counts, before);
  });
  await t.test("unresolved and unsupported skip retention; technical support failure differs", async () => {
    for (const current of ["unresolved", "unsupported", "support-failure", "provider-failure"]) {
      mode = current; const before = { ...counts }; const { record } = await run();
      assert.equal(record.disposition, current.endsWith("failure") ? "failed" : "incomplete", record.reason ?? ""); assert.equal(record.retainedProposal, undefined);
      if (current === "unresolved") assert.equal(counts.transformation, before.transformation);
    }
    mode = "actionable";
  });
  await t.test("planner no-change and mixed/partial proposals preserve all decisions", async () => {
    const baseline = draftFixture(); baseline.provenance.repository = repository; baselineId = baseline.id;
    await getDatabase().insert(documentationDrafts).values({ id: baseline.id, document: baseline });
    try {
      mode = "no-change"; const before = { ...counts }, unchanged = await run();
      assert.equal(unchanged.record.disposition, "no-change"); assert.equal(unchanged.record.reason, "documentation-unchanged");
      assert.equal(counts.transformation, before.transformation); assert.equal(unchanged.record.retainedProposal, undefined);
    } finally { await getDatabase().delete(documentationDrafts).where(eq(documentationDrafts.id, baseline.id)); baselineId = null; }
    for (const current of ["mixed", "partial"]) {
      mode = current; const result = await run(); assert.equal(result.record.disposition, "awaiting-review", result.record.reason ?? "");
      assert.equal(result.record.transformation?.results.length, 2);
      assert.equal(result.record.transformation?.results[0].reviewReady, true);
      assert.equal(result.record.transformation?.results[1].reviewReady, false);
      const retained = await getDocumentationReview(result.record.retainedProposal!.proposalId);
      assert.equal(retained.status, "found"); if (retained.status === "found") assert.equal(retained.proposal.results.length, 2);
    }
    mode = "actionable";
  });
  await t.test("candidate overflow is semantic incomplete and skips planner inference", async () => {
    const documents = Array.from({ length: 11 }, () => {
      const d = draftFixture(); d.provenance.repository = repository; d.title = "Request requirements"; d.sections[0].title = "Title validation"; return d;
    });
    await getDatabase().insert(documentationDrafts).values(documents.map(d => ({ id: d.id, document: d })));
    try {
      const before = counts.planning;
      const id = await createDocumentationRun({ ...repo, base, head, paths: [], associations: [{ id: "route-query", kind: "route", value: "/fixture", origin: "operator" }] }); ids.push(id);
      await executeDocumentationRun(id); const result = { record: await wait(id) };
      assert.equal(result.record.disposition, "incomplete"); assert.equal(result.record.reason, "documentation-candidates-incomplete");
      assert.equal(counts.planning, before); assert.equal(result.record.transformation, undefined);
    } finally { await getDatabase().delete(documentationDrafts).where(inArray(documentationDrafts.id, documents.map(d => d.id))); }
  });
  await t.test("retention rollback never leaves authority or awaiting-review linkage", async () => {
    const id = await create(), initial = await read(id), token = randomUUID(), now = new Date().toISOString();
    await getDatabase().update(documentationRuns).set({ status: "running", payload: { ...initial, status: "running", startedAt: now, execution: { token, heartbeatAt: now, cancelRequestedAt: null } } }).where(eq(documentationRuns.id, id));
    const baseline = draftFixture(); baseline.provenance.repository = repository;
    const proposal = reviewProposalFixture(baseline, false);
    await assert.rejects(retainDocumentationProposal(proposal, { runLink: { id, token, complete() { throw new Error("Required linkage failure"); } } }), /Required linkage failure/);
    assert.equal((await getDocumentationReview(proposal.proposalId)).status, "missing");
    assert.equal((await read(id)).retainedProposal, undefined);
    await assert.rejects(retainDocumentationProposal(proposal, { runLink: { id, token: randomUUID(), complete: payload => payload } }), /ownership/);
    assert.equal((await getDocumentationReview(proposal.proposalId)).status, "missing");
    await cancelDocumentationRun(id);
    await reconcileDocumentationRuns(undefined, Date.now() + 61_000);
    assert.equal((await read(id)).disposition, "interrupted");
  });
  await t.test("requested-but-uncovered reaches impact, plan and retained limitations", async () => {
    await configure(["/unrelated"]);
    const before = { ...counts }; const { record } = await run();
    assert.equal(record.runtime?.outcome, "requested-but-uncovered"); assert.equal(record.impact?.provenance.runtimeInspection?.outcome, "requested-but-uncovered");
    assert.equal(record.disposition, "awaiting-review"); assert.equal(counts.selection, before.selection);
    mode = "unresolved"; const unresolved = await run(); assert.equal(unresolved.record.disposition, "incomplete"); mode = "actionable";
  });
  await t.test("semantic not-needed never launches; real single-workflow path and failure", async () => {
    await configure(); mode = "not-needed"; const before = { ...counts };
    const skipped = await run(); assert.equal(skipped.record.runtime?.outcome, "not-needed"); assert.equal(counts.selection, before.selection);
    mode = "actionable"; const visual = await run();
    assert.equal(visual.record.disposition, "awaiting-review", JSON.stringify({ reason: visual.record.reason, runtime: visual.record.runtime })); assert.equal(visual.record.runtime?.outcome, "completed");
    assert.equal(visual.record.artifacts.length, 2); assert.equal(counts.selection, 1); assert.equal(counts.vision, 1);
    await configure(["/requests/new"], true); const previousImpact = counts.impact;
    const failed = await run(); assert.equal(failed.record.disposition, "failed"); assert.equal(failed.record.runtime?.outcome, "attempted-and-failed"); assert.equal(counts.impact, previousImpact);
  });
  await t.test("external cancellation reaches source transport and prevents retention", async () => {
    delete process.env.DOCSYDE_RUN_RUNTIME_CONFIG;
    for (const phase of ["source", "support"]) {
      phaseToHold = phase; const arrived = new Promise<void>(resolve => { reached = resolve; }); held = new Promise(resolve => { hold = resolve; });
      const id = await create(); await executeDocumentationRun(id); await Promise.race([arrived, new Promise((_, reject) => setTimeout(() => reject(new Error("Held phase not reached")), 3000))]);
      await cancelDocumentationRun(id); const cancelled = await wait(id);
      assert.equal(cancelled.disposition, "cancelled"); assert.equal(cancelled.retainedProposal, undefined); held = undefined;
    }
  });
  await t.test("runtime cancellation cleans up before another run can start", async () => {
    await configure(["/requests/new"], true);
    const id = await create(); await executeDocumentationRun(id);
    for (let i = 0; i < 100; i++) { if ((await read(id)).activeStage === "runtime-inspection") break; await new Promise(resolve => setTimeout(resolve, 10)); }
    await cancelDocumentationRun(id); const cancelled = await wait(id);
    assert.equal(cancelled.disposition, "cancelled"); assert.equal(cancelled.retainedProposal, undefined);
    delete process.env.DOCSYDE_RUN_RUNTIME_CONFIG;
    const next = await run(); assert.equal(next.record.disposition, "awaiting-review");
  });
  await t.test("required checkpoint failure prevents the next model stage", async () => {
    const id = await create(), beforeImpact = counts.impact;
    // PostgreSQL trigger is scoped to this fixture UUID and removed in finally.
    const suffix = id.replaceAll("-", ""), functionName = `run_checkpoint_${suffix}`;
    await getDatabase().execute(sql.raw(`CREATE FUNCTION docsyde.${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id = '${id}'::uuid AND NEW.payload->>'activeStage' = 'impact-synthesis' AND NEW.status = 'running' THEN RAISE EXCEPTION 'fixture checkpoint failure'; END IF; RETURN NEW; END $$`));
    try {
      await getDatabase().execute(sql.raw(`CREATE TRIGGER ${functionName} BEFORE UPDATE ON docsyde.documentation_runs FOR EACH ROW EXECUTE FUNCTION docsyde.${functionName}()`));
      await executeDocumentationRun(id); const failed = await wait(id);
      assert.equal(failed.disposition, "failed"); assert.equal(failed.reason, "stage-failed:impact-synthesis"); assert.equal(counts.impact, beforeImpact);
      assert.ok(failed.analysis); assert.equal(failed.stages.find(s => s.key === "impact-synthesis")?.status, "failed");
    } finally {
      await getDatabase().execute(sql.raw(`DROP TRIGGER IF EXISTS ${functionName} ON docsyde.documentation_runs`));
      await getDatabase().execute(sql.raw(`DROP FUNCTION docsyde.${functionName}()`));
    }
  });
  await t.test("heartbeat control preserves checkpoints and application deadline releases admission", async sub => {
    phaseToHold = "source"; const arrived = new Promise<void>(resolve => { reached = resolve; }); held = new Promise(resolve => { hold = resolve; });
    sub.mock.timers.enable({ apis: ["setInterval", "Date"], now: Date.now() });
    const id = await create(); await executeDocumentationRun(id); await Promise.race([arrived, new Promise((_, reject) => setTimeout(() => reject(new Error("Source not reached")), 3000))]);
    const before = await read(id);
    sub.mock.timers.tick(RUN_HEARTBEAT_MS);
    await new Promise(resolve => setTimeout(resolve, 50));
    const renewed = await read(id); assert.deepEqual(renewed.stages, before.stages); assert.equal(renewed.activeStage, "source-analysis");
    assert.ok(Date.parse(renewed.execution!.heartbeatAt) > Date.parse(before.execution!.heartbeatAt));
    sub.mock.timers.reset();
    await cancelDocumentationRun(id); assert.equal((await wait(id)).disposition, "cancelled"); held = undefined;
    // Register the application deadline on a mocked clock, then advance only after transport is suspended.
    const next = await create(); const nextArrived = new Promise<void>(resolve => { reached = resolve; }); held = new Promise(resolve => { hold = resolve; });
    sub.mock.timers.enable({ apis: ["setTimeout"] });
    await executeDocumentationRun(next); await nextArrived;
    sub.mock.timers.tick(RUN_DEADLINE_MS); sub.mock.timers.reset();
    const expired = await wait(next); assert.equal(expired.disposition, "failed"); assert.equal(expired.reason, "application-deadline"); held = undefined;
  });
  await t.test("30-second heartbeat renewal failure aborts suspended inference", async sub => {
    const id = await create(), suffix = id.replaceAll("-", ""), name = `run_heartbeat_${suffix}`;
    await getDatabase().execute(sql.raw(`CREATE FUNCTION docsyde.${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id = '${id}'::uuid AND NEW.status = 'running' AND NEW.payload->'execution'->>'heartbeatAt' <> OLD.payload->'execution'->>'heartbeatAt' THEN RAISE EXCEPTION 'fixture heartbeat failure'; END IF; RETURN NEW; END $$`));
    try {
      await getDatabase().execute(sql.raw(`CREATE TRIGGER ${name} BEFORE UPDATE ON docsyde.documentation_runs FOR EACH ROW EXECUTE FUNCTION docsyde.${name}()`));
      phaseToHold = "source"; const arrived = new Promise<void>(resolve => { reached = resolve; }); held = new Promise(resolve => { hold = resolve; });
      sub.mock.timers.enable({ apis: ["setInterval", "Date"], now: Date.now() });
      await executeDocumentationRun(id); await Promise.race([arrived, new Promise((_, reject) => setTimeout(() => reject(new Error("Source not reached")), 3000))]);
      sub.mock.timers.tick(10_000); await new Promise(resolve => setTimeout(resolve, 50));
      sub.mock.timers.tick(20_000); await new Promise(resolve => setTimeout(resolve, 50)); sub.mock.timers.reset();
      const expired = await wait(id); assert.equal(expired.disposition, "failed"); assert.equal(expired.reason, "heartbeat-renewal-failed"); assert.ok(expired.contextSnapshot);
    } finally {
      sub.mock.timers.reset(); held = undefined; hold?.();
      await getDatabase().execute(sql.raw(`DROP TRIGGER IF EXISTS ${name} ON docsyde.documentation_runs`));
      await getDatabase().execute(sql.raw(`DROP FUNCTION docsyde.${name}()`));
    }
  });
  await t.test("legacy rows render their old draft contract without v2 execution", async () => {
    const id = randomUUID(); ids.push(id);
    await getDatabase().insert(documentationRuns).values({ id, repository, status: "completed", payload: { input: { ...repo, base, head, paths: [], associations: [], runContext: null }, title: "Legacy", status: "completed", startedAt: null, finishedAt: null, summary: "Historical", stages: initialStages(), result: { status: "no-draft", document: null } } });
    const historical = await getDocumentationRun(id); assert.ok(historical); assert.equal(runView(historical).schemaVersion, 1);
    const before = { ...counts }; await executeDocumentationRun(id); assert.deepEqual(counts, before);
  });
  await t.test("ownership guards, fresh restart blockage, explicit stale reconciliation, read-only GET", async () => {
    const id = await create(), initial = await read(id), token = randomUUID(), now = new Date().toISOString();
    await getDatabase().update(documentationRuns).set({ status: "running", payload: { ...initial, status: "running", startedAt: now, execution: { token, heartbeatAt: now, cancelRequestedAt: null } } }).where(eq(documentationRuns.id, id));
    const other = await create(); await assert.rejects(executeDocumentationRun(other), RunBusyError);
    await assert.rejects(writeRunCheckpoint(id, randomUUID(), r => r));
    await reconcileDocumentationRuns(undefined, Date.now()); assert.equal((await read(id)).status, "running");
    const staleAt = new Date(Date.now() - 61_000).toISOString();
    await writeRunCheckpoint(id, token, r => ({ ...r, execution: { ...r.execution!, heartbeatAt: staleAt } }));
    assert.equal((await read(id)).status, "running", "ordinary reads do not invent interruption");
    await reconcileDocumentationRuns({ id, token }); assert.equal((await read(id)).status, "running", "local owner protects execution");
    await reconcileDocumentationRuns(); assert.equal((await read(id)).disposition, "interrupted");
    assert.ok((await read(id)).stages.every(s => s.status === "skipped"));
    await assert.rejects(writeRunCheckpoint(id, token, r => r)); await cancelDocumentationRun(other);
  });
  await t.test("history, scoping and no document/publication writes", async () => {
    assert.equal((await latestDocumentationRuns(repo, [head])).length, 1);
    const page = await listDocumentationRuns({ ...repo, limit: 2 }); assert.equal(page.runs.length, 2); assert.ok(page.nextCursor);
    assert.equal(runView((await getDocumentationRun(ids[0]))!).schemaVersion, 2);
    const drafts = await getDatabase().select().from(documentationDrafts).where(sql`${documentationDrafts.document}->'provenance'->>'repository' = ${repository}`); assert.equal(drafts.length, 0);
    const publications = await getDatabase().select().from(documentationPublications).where(eq(documentationPublications.repository, repository)); assert.equal(publications.length, 0);
    process.env.DOCSYDE_ANALYSIS_REPOSITORIES = "another/repo"; await assert.rejects(getDocumentationRun(ids[0]), /not allowed/);
  });
});
