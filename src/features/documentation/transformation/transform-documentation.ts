import { rejectionDiagnostic as entryRejectionDiagnostic, type ValidationDiagnostic } from "@/integrations/ai/invocation-debug";
import "server-only";
import { assertPlannedGenerationBatches, stopInferenceBudget } from "@/integrations/ai/inference-budget";
import type { InvocationContext } from "@/integrations/ai/invocation-context";
import { finishInvocationValidation } from "@/integrations/ai/invocation-log";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { isDeepStrictEqual } from "node:util";
import { validateProductImpact, type ProductImpact } from "@/features/sources/product-analysis";
import { generateStructured } from "@/integrations/ai/generate-structured";
import { associationChoice, type AssociationChoice, type DocumentationDocument } from "../documents/document";
import { validateDocumentationDocument } from "../documents/document-validation";
import { getDocumentationDraft } from "../documents/operations";
import type { DocumentationImpactPlan } from "../planning/documentation-impact";
import { validateDocumentationImpactPlan, validateImpactDecisions } from "../planning/validate-documentation-impact-plan";
import { documentationHash } from "../documents/document-identity";
import { sameImpactRepository } from "../planning/documentation-impact-input";
import { documentationChangeProposalSchema, transformationEnvelopeSchema, TRANSFORMATION_OUTPUT_TOKENS,
  type DocumentationChangeProposal, type DecisionResult } from "./documentation-change-proposal";
import { transformationSource, authorizeTransformation, type TransformationAuthorization } from "./transformation-input";
import { transformationInstructions } from "./transformation-prompt";
import { minimumTransformationBatches, transformationRequest } from "./transformation-batches";
import { validateTransformationEntry, transformationSupportUnits } from "./transformation-validation";
import { validateTransformationGrounding } from "./validate-transformation-grounding";
import { assembleDocumentationChange } from "./assemble-documentation-change";

function fail(result: DecisionResult, issue: string, generation: DecisionResult["generation"] = "incomplete") {
  result.generation = generation; result.reviewReady = false; result.saveCompatible = false;
  result.materialization = "blocked"; result.issues.push(issue);
}

/** Trusted server-only operation. Correspondence checks do not authenticate client
 * artifacts or re-prove upstream citations. No save/sign/publication operations. */
type TransformationInput = { impact: ProductImpact; plan: DocumentationImpactPlan; context?: AssociationChoice[] };
async function prepareTransformation({ impact: rawImpact, plan: rawPlan, context = [] }: TransformationInput, signal?: AbortSignal) {
  const impact = validateProductImpact(rawImpact), plan = validateDocumentationImpactPlan(impact, rawPlan);
  const supplied = z.array(associationChoice).max(20).parse(context);
  if (new Set(supplied.map(choice => choice.id)).size !== supplied.length || supplied.some(choice => choice.origin !== "operator" || choice.findingRef
    || (choice.kind === "route" && (!choice.value.startsWith("/") || choice.value.startsWith("//") || /[?#\x00-\x20]/.test(choice.value))))) throw new Error("Invalid operator transformation context.");
  const proposalId = randomUUID(), createdAt = new Date().toISOString();
  const limitations = [...new Set([...(impact.provenance.runtimeInspection?.limitations ?? []), impact.provenance.source.notice, ...impact.provenance.source.uncertainties, ...impact.uncertainties, ...plan.uncertainties,
    ...impact.claims.flatMap(claim => claim.uncertainties)])];
  const results: DecisionResult[] = plan.decisions.map((decision, index) => ({ decisionId: `decision-${index + 1}`, decision,
    generation: decision.action === "revise" || decision.action === "add" ? "pending" : "not-required",
    support: "not-required", reviewReady: false, saveCompatible: false, approval: "not-requested",
    materialization: decision.action === "revise" || decision.action === "add" ? "pending" : "not-applicable",
    issues: [], limitations: [...limitations], change: null, model: null, candidateId: null }));
  const proposal: DocumentationChangeProposal = { proposalId, createdAt, impactSha256: documentationHash(impact), planSha256: documentationHash(plan),
    status: "failed", impact, plan, targets: [], authorizations: [], results, candidates: [], batches: [], supportModel: null, supportAttempted: false, protocolIssues: [], supportChecks: [] };
  const baselines = new Map<string, DocumentationDocument>();
  for (const id of [...new Set(plan.decisions.flatMap(decision => decision.documentId ? [decision.documentId] : []))]) {
    if (signal?.aborted) break;
    try {
      const loaded = await getDocumentationDraft(id, impact.provenance.source.repository);
      if (loaded.status !== "found") continue;
      const document = validateDocumentationDocument(loaded.document);
      const selectedHash = plan.candidateSelection?.matches.find(m => m.documentId === id)?.documentSha256;
      if (selectedHash && documentationHash(document) !== selectedHash) continue;
      if (document.id !== id || !sameImpactRepository(document.provenance.repository, impact.provenance.source.repository)) continue;
      baselines.set(id, document); proposal.targets.push({ identity: { documentId: id, sha256: documentationHash(document) }, document });
    } catch { /* Missing/corrupt/read failures become explicit target failures. */ }
  }
  const targets = [...baselines.values()];
  const source = transformationSource(impact, proposalId, targets);
  const authorizations: TransformationAuthorization[] = [];
  for (const result of results) {
    if (signal?.aborted) { fail(result, "cancelled-before-transformation"); continue; }
    try {
      validateImpactDecisions(impact, [result.decision], targets);
      if (result.generation !== "pending") continue;
      const baseline = result.decision.documentId ? baselines.get(result.decision.documentId) : undefined;
      for (const choice of supplied) if (baseline?.context.some(existing => existing.id === choice.id && !isDeepStrictEqual(existing, choice))) throw new Error("Association collision.");
      const auth = authorizeTransformation(impact, plan, result, baseline, source, supplied);
      if (auth.shape === "add-section" && baseline?.sections.length === 4) { fail(result, "canonical-section-limit"); continue; }
      authorizations.push(auth);
    } catch { fail(result, "invalid-target-or-mutation-authorization"); }
  }
  for (const a of authorizations) for (const b of authorizations) {
    if (a.decisionId >= b.decisionId || !a.target.documentId || a.target.documentId !== b.target.documentId) continue;
    if (a.shape === "replace-document" || b.shape === "replace-document" || (a.shape === "replace-section" && b.shape === "replace-section" && a.target.sectionId === b.target.sectionId)) {
      for (const auth of [a, b]) { const result = results.find(result => result.decisionId === auth.decisionId)!; if (!result.issues.includes("conflicting-patches")) fail(result, "conflicting-patches"); }
    }
  }
  const active = authorizations.filter(auth => results.find(result => result.decisionId === auth.decisionId)?.generation === "pending");
  proposal.authorizations = authorizations;
  const partition = minimumTransformationBatches(active, batch => {
    const request = transformationRequest(batch, targets); return request.feasible ? request.bytes : null;
  });
  for (const auth of partition.individuallyInfeasible) fail(results.find(result => result.decisionId === auth.decisionId)!, "individually-infeasible-request-or-output");
  if (partition.batches === null) for (const auth of active) {
    const result = results.find(result => result.decisionId === auth.decisionId)!;
    if (result.generation === "pending") fail(result, "aggregate-generation-budget");
  }
  return { proposal, partition, targets, baselines, source, supplied, results, authorizations, limitations };
}

/** Uses the exact production authorization and partition logic, without inference or writes. */
export async function inspectTransformationBatches(input: TransformationInput, signal?: AbortSignal) {
  const { proposal, partition } = await prepareTransformation(input, signal);
  return { batchCount: partition.batches?.length ?? null,
    individuallyInfeasible: partition.individuallyInfeasible.length,
    authorizationFailures: proposal.results.filter(result => result.generation === "incomplete").length,
    eligible: partition.batches?.length === 1 && !partition.individuallyInfeasible.length
      && !proposal.results.some(result => result.generation === "incomplete"),
    targets: proposal.targets.map(target => target.identity),
    batches: partition.batches?.map(batch => ({ decisionIds: batch.items.map(item => item.decisionId), requestBytes: batch.bytes })) ?? [] };
}

export async function transformDocumentation(input: TransformationInput,
  { signal, invocation }: { invocation?: InvocationContext; signal?: AbortSignal } = {}): Promise<DocumentationChangeProposal> {
  const { proposal, partition, targets, baselines, source, supplied, results, authorizations, limitations } = await prepareTransformation(input, signal);
  assertPlannedGenerationBatches(partition.batches?.length ?? 0,
    partition.individuallyInfeasible.length > 0 || results.some(result => result.generation === "incomplete"));
  for (const batch of partition.batches ?? []) {
    const request = transformationRequest(batch.items, targets);
    const record: DocumentationChangeProposal["batches"][number] = { decisionIds: batch.items.map(auth => auth.decisionId), requestBytes: request.bytes, status: "not-attempted", model: null };
    proposal.batches.push(record);
    if (signal?.aborted) { batch.items.forEach(auth => fail(results.find(result => result.decisionId === auth.decisionId)!, "cancelled-before-batch")); continue; }
    try {
      const generated = await generateStructured({ postValidation: true, invocation: { stage: "documentation-transformation", operation: "documentation-transformation", ...invocation }, instructions: transformationInstructions, input: request.input, schema: transformationEnvelopeSchema, maxOutputTokens: TRANSFORMATION_OUTPUT_TOKENS, signal });
      signal?.throwIfAborted();
      record.status = "completed"; record.model = { model: generated.model, elapsedMs: generated.elapsedMs };
      let rejected = false;
      let rejectionDiagnostic: ValidationDiagnostic | undefined;
      const diagnose = (code: ValidationDiagnostic["code"]) => { rejectionDiagnostic ??= { kind: "correspondence-rejection", validator: "documentation-transformation", code }; };
      const entries = new Map<string, unknown[]>(), expected = new Set(record.decisionIds);
      for (const raw of generated.data.entries) {
        const id = raw !== null && typeof raw === "object" && "decisionId" in raw ? raw.decisionId : null;
        if (typeof id !== "string" || !expected.has(id)) {
          rejected = true; diagnose("unknown-generation-entry");
          if (!proposal.protocolIssues.includes("Unknown or malformed generation entry.")) proposal.protocolIssues.push("Unknown or malformed generation entry.");
          continue;
        }
        entries.set(id, [...(entries.get(id) ?? []), raw]);
      }
      for (const auth of batch.items) {
        const result = results.find(result => result.decisionId === auth.decisionId)!;
        const raw = entries.get(auth.decisionId);
        result.model = record.model;
        if (raw?.length !== 1) { rejected = true; diagnose("missing-or-duplicate-generation-entry"); fail(result, "missing-or-duplicate-generation-entry"); continue; }
        try {
          const change = validateTransformationEntry(raw[0], auth, auth.target.documentId ? baselines.get(auth.target.documentId) : undefined);
          result.change = change;
          if (change.kind === "incomplete") { fail(result, "model-reported-incomplete"); result.issues.push(change.reason); }
          else {
            result.generation = "generated"; result.support = "pending";
            if (change.kind === "add-section" && change.placement.position === "undetermined") result.issues.push("placement-ambiguous");
          }
        } catch (error) {
          rejected = true;
          const diagnostic = entryRejectionDiagnostic(error, "correspondence-rejection");
          diagnose(diagnostic.code === "validator-rejected" ? "invalid-generation-entry" : diagnostic.code);
          fail(result, "invalid-generation-entry");
        }
      }
      await finishInvocationValidation(generated.invocationId, rejected ? "correspondence-rejection" : undefined, undefined, rejectionDiagnostic);
    } catch {
      record.status = "failed";
      batch.items.forEach(auth => fail(results.find(result => result.decisionId === auth.decisionId)!, signal?.aborted ? "cancelled-during-generation" : "generation-provider-or-output-failure", "failed"));
    }
  }
  if (results.some(result => result.generation === "failed" || result.generation === "incomplete")) stopInferenceBudget();
  const generated = results.filter(result => result.generation === "generated" && result.change);
  const generatedAuth = authorizations.filter(auth => generated.some(result => result.decisionId === auth.decisionId));
  const units = generatedAuth.flatMap(auth => transformationSupportUnits(auth, results.find(result => result.decisionId === auth.decisionId)!.change!, auth.target.documentId ? baselines.get(auth.target.documentId) : undefined));
  if (generated.length && units.length) {
    try {
      const outlines = new Map(generatedAuth.map(auth => [auth.decisionId, (auth.target.documentId ? baselines.get(auth.target.documentId)?.sections ?? [] : []).map(({ id, title, kind }) => ({ id, title, kind }))]));
      const checked = await validateTransformationGrounding(units, generatedAuth, outlines, signal, () => { proposal.supportAttempted = true; }, invocation);
      proposal.supportModel = checked.model; proposal.supportChecks = checked.checks;
      if (checked.protocolError) proposal.protocolIssues.push("Unknown or malformed support verdict.");
      for (const result of generated) {
        const checks = checked.checks.filter(check => check.decisionId === result.decisionId);
        result.support = checks.some(check => check.verdict === "unsupported") ? "unsupported" : checks.some(check => check.verdict === "uncertain") ? "uncertain" : "supported";
        if (result.support !== "supported") { result.materialization = "blocked"; result.issues.push("wording-not-supported"); }
        else result.reviewReady = true;
      }
    } catch {
      for (const result of generated) { result.support = "failed"; result.materialization = "blocked"; result.issues.push(signal?.aborted ? "cancelled-during-support-check" : "support-check-failed-or-over-budget"); }
    }
  }
  const groups = new Map<string, DecisionResult[]>();
  for (const result of results) if (result.decision.action === "revise" || result.decision.action === "add") {
    const key = result.decision.documentId ?? result.decisionId; groups.set(key, [...(groups.get(key) ?? []), result]);
  }
  for (const group of groups.values()) {
    if (group.some(result => !result.reviewReady) || signal?.aborted) {
      for (const result of group) { result.materialization = "blocked"; if (result.reviewReady) result.issues.push("another-target-decision-incomplete"); }
      continue;
    }
    try {
      const document = assembleDocumentationChange({ proposalId: proposal.proposalId, createdAt: proposal.createdAt, planSha256: proposal.planSha256,
        baseline: group[0].decision.documentId ? baselines.get(group[0].decision.documentId) : undefined,
        results: group, source, suppliedContext: supplied, limitations });
      proposal.candidates.push({ decisionIds: group.map(result => result.decisionId), document });
      group.forEach(result => { result.materialization = "ready"; result.saveCompatible = true; result.candidateId = document.id; });
    } catch { group.forEach(result => { result.materialization = "blocked"; result.issues.push("canonical-materialization-blocked"); }); }
  }
  const complete = results.filter(result => result.issues.length === 0 && (result.generation === "not-required" || result.materialization === "ready")).length;
  proposal.status = complete === results.length && !proposal.protocolIssues.length ? "complete"
    : complete > 0 || results.some(result => result.generation === "generated") ? "partial" : "failed";
  return documentationChangeProposalSchema.parse(proposal);
}
