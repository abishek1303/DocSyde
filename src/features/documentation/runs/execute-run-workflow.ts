import "server-only";
import { ManagedRuntimeUnavailable } from "@/runner/runtime/managed-configuration";
import { observe, type RuntimeObserver } from "@/integrations/browser/runtime-observation";
import { createHash } from "node:crypto";
import { readInspectionContext, analyzeProductChanges, captureGenerationContext, decideRuntimeInspection, synthesizeProductImpact, analyzeRuntimeVisuals, validateProductResult, type RuntimeInspectionContext } from "@/features/sources/product-analysis";
import { captureWorkflowWithRuntime } from "@/runner/runtime/capture-workflow";
import { documentationHash } from "../documents/document-identity";
import { loadRunRuntimeConfig } from "./run-runtime-config";
import { writeRunCheckpoint, finishRun, RunOwnershipLost } from "./run-checkpoints";
import { runRecordV2, type RunRecordV2 } from "./run-record";
import { changeWorkflowStage, type WorkflowStage } from "./run-workflow-state";
import { planDocumentationImpact } from "../planning/plan-documentation-impact";
import { transformDocumentation } from "../transformation/transform-documentation";
import { retainDocumentationProposal } from "../review/review-proposal-operations";

import { modelFailureCode } from "./classify-run-failure";
import { shortResponse } from "./run-stage-response";
import type { RunFailure } from "./run-failure";

export class RunStageError extends Error {
  constructor(public readonly stage: WorkflowStage["key"], public readonly cause: unknown) { super(`Run stage failed: ${stage}`); }
}

/** Product composition only. Runner owns processes/browser; capabilities own validation/inference. */
export async function executeRunWorkflow(id: string, token: string, signal: AbortSignal, control: () => Promise<void>, observer?: RuntimeObserver) {
  const invocation = (stage: WorkflowStage["key"]) => ({ runId: id, stage, operation: stage });
  const check = async () => { signal.throwIfAborted(); await control(); signal.throwIfAborted(); };
  let record: RunRecordV2;
  const checkpoint = async (change: (r: RunRecordV2) => RunRecordV2) => {
    await check(); record = await writeRunCheckpoint(id, token, change); return record;
  };
  const stage = async (key: WorkflowStage["key"], action: () => Promise<Partial<RunRecordV2>>) => {
    try {
      await checkpoint(r => ({ ...r, activeStage: key, stages: changeWorkflowStage(r.stages, key, "running", `Running ${key}.`) }));
      const result = await action();
      await checkpoint(r => ({ ...r, ...result, stages: changeWorkflowStage(r.stages, key, "completed", `Completed ${key}.`) }));
    } catch (error) { if (error instanceof RunOwnershipLost || signal.aborted) throw error; throw new RunStageError(key, error); }
  };
  const skip = async (key: WorkflowStage["key"], reason: string) => checkpoint(r => ({ ...r, stages: changeWorkflowStage(r.stages, key, "skipped", reason) }));
  const finish = async (disposition: "no-change" | "incomplete" | "failed", reason: string, failure?: RunFailure) => checkpoint(r => finishRun(r, disposition, reason, failure));
  const model = (stage: WorkflowStage["key"], value: { model?: string; elapsedMs?: number }) => value.model && value.elapsedMs !== undefined ? [{ stage, model: value.model, elapsedMs: value.elapsedMs }] : [];
  let configuration: Awaited<ReturnType<typeof loadRunRuntimeConfig>>;
  await stage("prepare-context", async () => {
    const current = await checkpoint(r => r);
    const contextSnapshot = await captureGenerationContext(current.input, current.input.runContext);
    configuration = await loadRunRuntimeConfig(`https://github.com/${current.input.owner.toLowerCase()}/${current.input.repo.toLowerCase()}`);
    const runtime: RuntimeInspectionContext = { decision: "not-evaluated", outcome: "unavailable", reason: configuration.available ? "inspection-not-yet-evaluated" : configuration.reason,
      requestedTargets: [], uncoveredTargets: [], unresolvedQuestions: [], workflow: configuration.descriptor,
      limitations: configuration.available ? [] : [`Runtime inspection unavailable: ${configuration.reason}; rendered state is unobserved.`] };
    return { contextSnapshot, runtime };
  });
  let source: Awaited<ReturnType<typeof analyzeProductChanges>>;
  await stage("source-analysis", async () => {
    const { owner, repo, base, head, paths } = record.input;
    source = await analyzeProductChanges({ owner, repo, base, head, paths }, record.contextSnapshot, undefined, { signal, invocation: invocation("source-analysis"), currentState: record.input.mode === "current-state" });
    await check();
    // Error results are useful diagnostics but are not accepted as downstream evidence.
    return { analysis: source, analysisSha256: documentationHash(source), models: [...record.models, ...model("source-analysis", source)] };
  });
  if (source!.status === "error") { await finish("failed", "source-analysis-failed", { stage: "source-analysis", ...(source!.diagnostic ? { diagnostic: source!.diagnostic } : {}), code: source!.rejection?.stage === "model-output" ? modelFailureCode(source!.rejection.code) : source!.rejection ? "evidence-validation" : "stage-failed" }); return; }
  const validatedSource = validateProductResult(source!);
  if (validatedSource.status === "no-change") {
    await checkpoint(r => ({ ...r, runtime: { decision: "not-needed", outcome: "not-needed", reason: "no-source-differences", requestedTargets: [], uncoveredTargets: [], unresolvedQuestions: [], limitations: [] } }));
    await finish("no-change", "no-source-differences"); return;
  }
  await stage("runtime-decision", async () => {
    if (!configuration!.available) return {};
    const supportingContext = await readInspectionContext(record.input, configuration.config.supportingSourcePaths, signal);
    const result = await decideRuntimeInspection(validatedSource, { signal, invocation: invocation("runtime-decision"), supportingContext,
      operatorCapabilities: { workflow: configuration.descriptor, capabilities: configuration.config.capabilities } });
    await check();
    const decision = result.decision;
    const requestedTargets = decision.targets.flatMap(t => t.pathname ? [t.pathname] : []);
    const uncoveredTargets = requestedTargets.filter(path => !configuration!.available || !configuration!.config.supportedPathnames.includes(path));
    const outcome = decision.status === "not-needed" ? "not-needed" : decision.status === "unresolved" || uncoveredTargets.length ? "requested-but-uncovered" : "unavailable";
    const reason = decision.status === "inspect" && !uncoveredTargets.length ? "inspection-requested-and-covered" : decision.reason;
    const limitations = decision.status === "not-needed" ? [] : outcome === "requested-but-uncovered" ? ["Useful runtime inspection could not be covered by the trusted workflow; requested rendered state remains unobserved.", ...decision.uncertainties] : [];
    // Declared capability scope is authority metadata, never proof that all desired observations were captured.
    const scopeLimitations = configuration.config.capabilities.filter(c => decision.targets.some(t => t.capabilityId === c.id))
      .map(c => `Configured inspection scope (${c.id}): ${c.description}`.slice(0, 500));
    return { decision, inspectionContext: supportingContext, runtime: { ...record.runtime!, decision: decision.status, outcome, reason, requestedTargets, uncoveredTargets,
      unresolvedQuestions: decision.uncertainties, limitations: [...limitations, ...scopeLimitations].slice(0, 8) }, models: [...record.models, ...model("runtime-decision", result)] };
  });
  let runtime: Awaited<ReturnType<typeof analyzeRuntimeVisuals>>["runtime"] = [];
  let startupUnavailable = false;
  if (configuration!.available && record!.decision?.status === "inspect" && record!.runtime?.reason === "inspection-requested-and-covered") {
    await stage("runtime-inspection", async () => {
      const configured = configuration!;
      if (!configured.available) throw new Error("Runtime configuration lost.");
      // Mark attempted before any launch. A failed attempt never becomes unavailable/not-needed.
      await checkpoint(r => ({ ...r, runtime: { ...r.runtime!, outcome: "attempted-and-failed", reason: "inspection-started-not-complete" } }));
      let captured;
      try { captured = await captureWorkflowWithRuntime(configured.config, configured.storage, signal, undefined, observer); }
      catch (error) {
        // Only startup failures with completed cleanup may continue source-only. Capture and cleanup failures still stop the run.
        if (!(error instanceof ManagedRuntimeUnavailable) || signal.aborted) throw error;
        startupUnavailable = true;
        return { runtime: { ...record.runtime!, outcome: "attempted-and-failed", reason: `managed-${error.code}`,
          limitations: [...record.runtime!.limitations, "Approved application startup was unavailable; no browser evidence was captured. Documentation must use source evidence only."].slice(0, 8) } };
      }
      await check();
      const storeManifest = async (kind: "runtime-trace" | "runtime-analysis", value: unknown) => {
        const bytes = Buffer.from(JSON.stringify(value));
        const artifact = { kind, ...(await configured.storage.store(bytes).catch(error => { observe(observer, { kind: "failure", phase: "evidence", code: "artifact-storage-failed" }); throw error; })), sha256: createHash("sha256").update(bytes).digest("hex") };
        await checkpoint(r => ({ ...r, artifacts: [...r.artifacts, artifact] })).catch(error => { observe(observer, { kind: "failure", phase: "evidence", code: "run-linkage-failed" }); throw error; });
      };
      await storeManifest("runtime-trace", { runtime: captured.runtime, trace: captured.trace });
      const retainedCaptures = captured.trace.checkpoints.filter(cp => cp.eligible && cp.screenshot).map(cp => cp.captureId);
      for (let offset = 0; offset < retainedCaptures.length; offset += 12) observe(observer, { kind: "canonical-evidence-retained", phase: "evidence", captures: retainedCaptures.slice(offset, offset + 12) });
      const secrets = [...configured.config.workflow.secrets, ...configured.config.workflow.steps.flatMap(step => step.type === "fill" || step.type === "select" ? [step.value] : [])];
      const visual = await analyzeRuntimeVisuals({ source: validatedSource, trace: captured.trace, description: configured.config.description, secrets,
        maxSelectedScreenshots: configured.config.maxSelectedScreenshots }, configured.storage, signal, invocation("runtime-inspection"), observer);
      await check();
      await storeManifest("runtime-analysis", visual);
      const responsePreview = visual.runtime[0]?.vision.data.observations[0]
        ?? (visual.selection ? JSON.stringify({ selected: visual.selection.selection.selected }) : undefined);
      if (responsePreview) await checkpoint(r => ({ ...r, runtimeResponsePreview: shortResponse(responsePreview) }));
      if (visual.status === "incomplete" || visual.status === "disabled") {
        await checkpoint(r => ({ ...r, runtime: { ...r.runtime!, outcome: "attempted-and-failed", reason: visual.reason } }));
        throw new Error("Runtime visual evidence incomplete.");
      }
      runtime = visual.runtime;
      return { runtime: { ...record.runtime!, outcome: "completed", reason: visual.reason },
        models: [...record.models, ...model("runtime-inspection", visual.selection ?? {}), ...runtime.map(item => ({ stage: "runtime-inspection" as const, model: item.vision.model, elapsedMs: item.vision.elapsedMs }))] };
    });
    if (startupUnavailable) await checkpoint(r => ({ ...r, stages: r.stages.map(stage => stage.key === "runtime-inspection" ? { ...stage, status: "skipped", summary: "Application startup was unavailable. Continuing with source evidence only." } : stage) }));
  } else await skip("runtime-inspection", record!.runtime!.reason);
  await stage("impact-synthesis", async () => {
    const result = await synthesizeProductImpact({ source: validatedSource, runtime, runtimeInspection: record.runtime }, { signal, invocation: invocation("impact-synthesis") });
    return { impact: result.impact, models: [...record.models, ...model("impact-synthesis", result)], warnings: [...(record.runtime?.limitations ?? []), ...result.impact.uncertainties] };
  });
  if (!record!.impact!.claims.length) { await finish("incomplete", "impact-has-no-usable-claims"); return; }
  await stage("documentation-planning", async () => {
    const result = await planDocumentationImpact({ impact: record.impact!, context: record.input.associations }, { signal, invocation: invocation("documentation-planning") });
    return { plan: result.plan, models: [...record.models, ...model("documentation-planning", result)] };
  });
  const plan = record!.plan!;
  if (!plan.decisions.some(d => d.action === "revise" || d.action === "add")) {
    const noChange = plan.decisions.length > 0 && plan.decisions.every(d => d.action === "no-change") && !record!.impact!.contradictions.length && record!.impact!.assessment !== "insufficient-evidence";
    await finish(noChange ? "no-change" : "incomplete", noChange ? "documentation-unchanged" : "documentation-plan-unresolved-or-empty"); return;
  }
  let proposal: Awaited<ReturnType<typeof transformDocumentation>>;
  await stage("documentation-transformation", async () => {
    proposal = await transformDocumentation({ impact: record.impact!, plan, context: record.input.associations, terminology: record.contextSnapshot?.repositoryUnderstandingUsed?.summary.terminology }, { signal, invocation: invocation("documentation-transformation"), onProgress: async progress => {
      await checkpoint(r => ({ ...r, stages: r.stages.map(stage => stage.key === "documentation-transformation" ? { ...stage, batchProgress: progress,
        summary: `Preparing documentation updates — ${progress.active ?? progress.processed} of ${progress.total} batches${progress.active ? "" : " processed"}. ${progress.acceptedDecisions} updates passed support checks.` } : stage) }));
    } });
    await check();
    const { proposalId, status, batches, supportAttempted, supportModel } = proposal;
    const authored = proposal.results.flatMap(result => {
      const change = result.change;
      if (!change || change.kind === "incomplete") return [];
      if (change.kind === "add-document" || change.kind === "replace-document") return [change.title];
      return [change.section.content.map(block => block.markdown).join(" ")];
    }).join(" ");
    return { transformation: { responsePreview: shortResponse(authored), proposalId, status, sha256: documentationHash(proposal), batches, supportAttempted, supportModel,
      results: proposal.results.map(r => ({ decisionId: r.decisionId, generation: r.generation, support: r.support, reviewReady: r.reviewReady, materialization: r.materialization, approval: r.approval, saveCompatible: r.saveCompatible, issues: r.issues, model: r.model, ...(r.compositionModel ? { compositionModel: r.compositionModel } : {}), candidateId: r.candidateId })) },
      models: [...record.models, ...batches.flatMap(b => model("documentation-transformation", b.model ?? {})), ...proposal.results.flatMap(r => model("documentation-transformation", r.compositionModel ?? {})), ...model("documentation-transformation", supportModel ?? {})] };
  });
  if (!proposal!.results.some(r => (r.decision.action === "revise" || r.decision.action === "add") && r.reviewReady)) {
    const technical = proposal!.batches.some(b => b.status === "failed") || proposal!.results.some(r => r.support === "failed" || r.generation === "failed");
    await checkpoint(r => ({ ...r, stages: r.stages.map(stage => stage.key === "documentation-transformation" ? { ...stage, status: technical ? "failed" : "incomplete", summary: "Generated output was not accepted for review." } : stage) }));
    await finish(technical ? "failed" : "incomplete", technical ? "transformation-provider-or-support-failure" : "transformation-not-review-ready", technical ? { stage: "documentation-transformation", code: "transformation-failed" } : undefined); return;
  }
  await checkpoint(r => ({ ...r, activeStage: "proposal-retention", stages: changeWorkflowStage(r.stages, "proposal-retention", "running", "Retaining trusted proposal.") }));
  await check();
  const expectedHash = documentationHash(proposal!);
  await retainDocumentationProposal(proposal!, { runLink: { id, token, complete(payload, retained) {
    signal.throwIfAborted();
    const current = runRecordV2.parse(payload);
    if (current.status !== "running" || current.execution?.token !== token) throw new RunOwnershipLost();
    if (current.execution.cancelRequestedAt) throw new Error("Run cancelled before retention.");
    if (current.transformation?.sha256 !== expectedHash || retained.proposalHash !== expectedHash || retained.id !== proposal!.proposalId) throw new Error("Retention identity mismatch.");
    return finishRun({ ...current, stages: changeWorkflowStage(current.stages, "proposal-retention", "completed", "Authoritative proposal retained."),
      retainedProposal: { proposalId: retained.id, proposalHash: retained.proposalHash, registeredAt: retained.registeredAt.toISOString(), expiresAt: retained.expiresAt.toISOString() } }, "awaiting-review", "proposal-retained-awaiting-human-review");
  } } });
}
