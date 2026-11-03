// Controlled integration producer: real masked Playwright pixels; source/vision outputs are deterministic fixtures.
import { createServer } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { captureRuntimeTrace } from "@/integrations/browser/capture-trace";
import { getArtifactStorage } from "@/integrations/storage/storage";
import { insertDocumentationRun, mutateDocumentationRun } from "@/integrations/database/documentation-runs";
import { publishDocumentation, getPublication } from "@/features/documentation/publication/publication-operations";
import { saveDocumentationDraft } from "@/features/documentation/documents/operations";
import { retainDocumentationProposal } from "@/features/documentation/review/review-proposal-operations";
import { initialWorkflowStages } from "@/features/documentation/runs/run-workflow-state";
import { runRecordV2 } from "@/features/documentation/runs/run-record";
import type { DocumentationDocument } from "@/features/documentation/documents/document";
import { RUNTIME_REVISION_WARNING } from "@/features/sources/runtime/runtime-visual-evidence";
import { draftFixture } from "./draft-fixture";
import { transformationImpactFixture } from "./transformation-fixtures";
import { reviewProposalFixture } from "./review-fixtures";

export async function imageProposalFixture(owner: string, repo: string, baseline?: DocumentationDocument, withVisualReference: boolean | "selected-source" = true) {
  const repository = `https://github.com/${owner}/${repo}`, storage = getArtifactStorage();
  const host = createServer((_request, response) => { response.setHeader("Content-Type", "text/html"); response.end(`<!doctype html><html><head><style>body{font:18px system-ui;background:#f5f8fc;color:#182436;padding:40px}article{max-width:650px;margin:auto;padding:32px;background:white;border:1px solid #dce6ee;border-radius:16px}h1{font-size:30px}input{display:block;width:90%;padding:12px;margin:12px 0}aside{padding:16px;background:#eff8fa;border-left:3px solid teal}</style></head><body><article><h1>Issue details</h1><p>Describe the issue so your team can track it.</p><label for="title">Issue title</label><input id="title" value="Private user input"><aside role="note">A request title is required.</aside></article></body></html>`); });
  await new Promise<void>(resolve => host.listen(0, "127.0.0.1", resolve));
  const address = host.address(); if (!address || typeof address === "string") throw new Error("Missing fixture origin");
  let trace;
  try { trace = await captureRuntimeTrace({ baseUrl: `http://127.0.0.1:${address.port}`, path: "/requests/new", readySelector: "h1", viewport: { width: 1000, height: 700 }, sensitiveSelectors: ["input"], steps: [{ type: "checkpoint" }] }, storage); }
  finally { await new Promise<void>(resolve => host.close(() => resolve())); }
  const cp = trace.checkpoints.filter(cp => cp.eligible && cp.screenshot).at(-1)!;
  if (!cp?.screenshot) throw new Error("Real masked capture failed");
  const evidence = { captureId: cp.captureId, requestedPathname: trace.requestedPathname, finalPathname: trace.states.find(state => state.stateId === cp.stateId)!.snapshot.pathname,
    capturedAt: cp.capturedAt, artifactKey: cp.screenshot.artifactKey, screenshotSha256: cp.screenshot.sha256,
    vision: { model: "mock-vision-fixture", elapsedMs: 1, data: { elements: [], observations: ["A request title is required."], limitations: ["Controlled test fixture; no paid vision inference."] } } };
  const impact = transformationImpactFixture(); impact.provenance.source.repository = repository;
  const { data: _data, ...timing } = evidence.vision; void _data;
  impact.provenance.captures = [{ ...evidence, vision: timing }];
  const visualRef = `visual:${cp.captureId}:observations:0`;
  impact.provenance.visualReferences = [{ id: visualRef, captureId: cp.captureId, collection: "observations", index: 0 }];
  if (withVisualReference === true) impact.claims[0].references.push(visualRef);
  impact.uncertainties.push(RUNTIME_REVISION_WARNING);
  const document = baseline ?? draftFixture(); document.provenance.repository = repository;
  document.title = "Issue Management"; document.context.find(context => context.kind === "route")!.value = "/requests/new";
  await saveDocumentationDraft(document);
  const live = await getPublication({ owner, repo, route: "/requests/new" });
  if (live && live.draftId !== document.id) throw new Error("Fixture baseline is stale");
  if (!live) await publishDocumentation({ owner, repo, route: "/requests/new", draftId: document.id });
  const proposal = reviewProposalFixture(document, false, 0, impact), retained = await retainDocumentationProposal(proposal);
  const runId = randomUUID();
  const artifact = async (kind: "runtime-trace" | "runtime-analysis", value: unknown) => { const bytes = Buffer.from(JSON.stringify(value)); return { kind, ...(await storage.store(bytes)), sha256: createHash("sha256").update(bytes).digest("hex") }; };
  const record = runRecordV2.parse({ schemaVersion: 2, input: { owner, repo, base: impact.provenance.source.base, head: impact.provenance.source.head, paths: [], associations: [] },
    title: "Controlled screenshot integration fixture (mocked source and vision)", status: "finished", disposition: "awaiting-review", activeStage: null, execution: null, reason: "fixture", summary: "Real masked capture; deterministic analysis fixtures.", startedAt: trace.startedAt, finishedAt: trace.finishedAt,
    stages: initialWorkflowStages().map(stage => ({ ...stage, status: "skipped", summary: "Controlled integration fixture, not a live inference run." })),
    runtime: { decision: "inspect", outcome: "completed", reason: "fixture-capture-complete", requestedTargets: ["/requests/new"], uncoveredTargets: [], unresolvedQuestions: [], limitations: [RUNTIME_REVISION_WARNING] },
    artifacts: [await artifact("runtime-trace", { trace }), await artifact("runtime-analysis", { runtime: [evidence], selection: { selection: { version: 3, selected: [{ checkpointId: cp.captureId, sourceRefs: withVisualReference ? ["source-1"] : [], question: "What title guidance is visible?" }] } } })],
    impact, plan: proposal.plan, retainedProposal: { proposalId: proposal.proposalId, proposalHash: retained.proposalHash, registeredAt: retained.registeredAt, expiresAt: retained.expiresAt }, models: [], warnings: [] });
  await insertDocumentationRun(runId, repository, record);
  await mutateDocumentationRun(runId, () => ({ status: "finished", payload: record }));
  return { document, proposal, runId, trace, evidence };
}
