import { guideWarnings } from "../transformation/grounding-risk";
import "server-only";
import { assertReliabilitySideEffect } from "@/integrations/reliability/execution-context";
import { assertDocumentImages } from "../images/document-image-operations";
import { randomUUID } from "node:crypto";
import { documentationReviewTransaction, findDocumentationReview, type ReviewTransaction } from "@/integrations/database/documentation-reviews";
import { documentationHash } from "../documents/document-identity";
import { validateDocumentationDocument } from "../documents/document-validation";
import { readRetainedReview, reviewRepository } from "./review-proposal-operations";
import { intrinsicReviewReady, approvedDocumentUnits, materializeApprovedUnit } from "./materialize-approved-changes";
import { normalizeReviewSelection, requireWarningAcknowledgment, type ReviewSelection, type AcceptedReview, type ReviewOutcome, type SaveReceipt, type PublicationReceipt } from "./documentation-review";
import type { DocumentationChangeProposal } from "../transformation/documentation-change-proposal";
import type { PublicationDescriptor } from "./documentation-review";

export function validateReviewSelection(proposal: DocumentationChangeProposal, targets: PublicationDescriptor[], selection: ReviewSelection) {
  for (const choice of selection.decisions) {
    const result = proposal.results.find(r => r.decisionId === choice.decisionId);
    if (!result) throw new Error("Unknown decision.");
    if (choice.choice === "approve") requireWarningAcknowledgment(guideWarnings(proposal, result.decisionId), choice.acknowledgeWarnings);
    const actionable = result.decision.action === "revise" || result.decision.action === "add";
    if (choice.choice === "acknowledge" && actionable) throw new Error("Actionable decisions require approve or reject.");
    if (choice.choice === "approve" && (!actionable || !intrinsicReviewReady(proposal, result))) throw new Error("Decision cannot be approved.");
  }
  const approved = selection.decisions.filter(c => c.choice === "approve").map(c => c.decisionId);
  const units = approvedDocumentUnits(proposal, approved), routes = new Set<string>();
  for (const intent of selection.publications) {
    const target = targets.find(t => t.id === intent.targetId);
    if (!target || !units.some(u => u.unitId === target.unitId)) throw new Error("Unauthorized publication target or unapproved save unit.");
    if (routes.has(target.route)) throw new Error("Conflicting publication intents."); routes.add(target.route);
    if (intent.intent === "replace" ? target.observedId !== intent.observedPublicationId || !target.baselineId : target.observedId !== null) throw new Error("Publication observation mismatch.");
  }
}
const timestamp = () => new Date().toISOString();

async function saveUnit(scope: ReviewTransaction, proposal: DocumentationChangeProposal, review: AcceptedReview, unit: ReturnType<typeof approvedDocumentUnits>[number], repository: string): Promise<SaveReceipt> {
  const receipt: SaveReceipt = { unitId: unit.unitId, decisionIds: unit.results.map(r => r.decisionId), baseline: "not-required", materialization: "blocked",
    status: "blocked", documentId: null, sha256: null, equalSave: null, savedAt: null, reason: null, at: timestamp() };
  const target = proposal.targets.find(t => t.identity.documentId === unit.results[0].decision.documentId);
  if (unit.results[0].decision.documentId) {
    const stored = await scope.baseline(unit.results[0].decision.documentId);
    receipt.baseline = stored ? "mismatched" : "missing";
    if (!stored || !target) { receipt.reason = "baseline-missing"; return receipt; }
    try {
      const document = validateDocumentationDocument(stored.document);
      if (document.id !== target.identity.documentId || stored.id !== document.id || reviewRepository(document.provenance.repository) !== repository
        || documentationHash(document) !== target.identity.sha256 || documentationHash(document) !== documentationHash(target.document)) throw new Error("Baseline mismatch.");
      receipt.baseline = "exact";
    } catch { receipt.reason = "baseline-mismatched-or-invalid"; return receipt; }
  }
  let candidate;
  try {
    candidate = materializeApprovedUnit(proposal, review.operationId, unit.results);
    if (reviewRepository(candidate.provenance.repository) !== repository) throw new Error("Repository mismatch.");
  } catch { receipt.reason = "subset-materialization-blocked"; return receipt; }
  receipt.materialization = "ready"; receipt.documentId = candidate.id; receipt.sha256 = documentationHash(candidate);
  const saved = await scope.save(candidate.id, candidate);
  receipt.status = saved.equal ? "saved" : "conflict";
  receipt.equalSave = !saved.inserted && saved.equal; receipt.savedAt = saved.equal ? saved.row.savedAt.toISOString() : null;
  receipt.reason = saved.equal ? null : "immutable-document-identity-conflict";
  return receipt;
}

async function publishUnit(scope: ReviewTransaction, proposal: DocumentationChangeProposal, review: AcceptedReview, target: PublicationDescriptor, intent: ReviewSelection["publications"][number], repository: string): Promise<PublicationReceipt> {
  const receipt: PublicationReceipt = { targetId: target.id, intent: intent.intent, status: "blocked", expectedId: target.observedId,
    actualId: null, actualDocumentId: null, at: timestamp(), reason: "save-not-successful" };
  const saved = review.saves.find(s => s.unitId === target.unitId);
  if (!saved || saved.status !== "saved" || !saved.documentId) return receipt;
  const row = await scope.baseline(saved.documentId);
  if (!row) { receipt.reason = "saved-document-missing"; return receipt; }
  try {
    const candidate = validateDocumentationDocument(row.document);
    await assertDocumentImages(candidate);
    const ids = review.selection.decisions.filter(c => c.choice === "approve").map(c => c.decisionId);
    const unit = approvedDocumentUnits(proposal, ids).find(u => u.unitId === target.unitId)!;
    const expected = materializeApprovedUnit(proposal, review.operationId, unit.results);
    if (candidate.id !== saved.documentId || reviewRepository(candidate.provenance.repository) !== repository
      || documentationHash(candidate) !== saved.sha256 || documentationHash(expected) !== saved.sha256) throw new Error("Saved candidate mismatch.");
    if (intent.intent === "publish" || target.associationIds.length > 0) {
      const used = new Set([...candidate.associations, ...candidate.sections.flatMap(s => s.associations)]);
      if (!candidate.context.some(c => c.kind === "route" && c.value === target.route && target.associationIds.includes(c.id) && used.has(c.id))) throw new Error("Approved subset lacks route association.");
    }
  } catch { receipt.reason = "saved-context-or-integrity-mismatch"; return receipt; }
  const current = await scope.publication(repository, target.route);
  const observed = () => { receipt.actualId = current?.id ?? null; receipt.actualDocumentId = current?.draftId ?? null; };
  if (intent.intent === "replace") {
    if (!current || current.id !== intent.observedPublicationId || current.id !== target.observedId || current.draftId !== target.baselineId) {
      receipt.status = "conflict"; receipt.reason = current ? "publication-changed" : "publication-missing"; observed(); return receipt;
    }
    const publication = await scope.replacePublication(repository, target.route, saved.documentId, current.id, target.baselineId!);
    if (publication) { receipt.status = "published"; receipt.reason = null; receipt.actualId = publication.id; receipt.actualDocumentId = publication.draftId; return receipt; }
  } else {
    if (current) { receipt.status = "conflict"; receipt.reason = "publication-occupied"; observed(); return receipt; }
    const publication = await scope.insertPublication(repository, target.route, saved.documentId);
    if (publication?.draftId === saved.documentId) { receipt.status = "published"; receipt.reason = null; receipt.actualId = publication.id; receipt.actualDocumentId = publication.draftId; return receipt; }
  }
  const actual = await scope.publication(repository, target.route);
  receipt.status = "conflict"; receipt.reason = "publication-concurrent-change"; receipt.actualId = actual?.id ?? null; receipt.actualDocumentId = actual?.draftId ?? null;
  return receipt;
}

/** Explicit approval + deterministic apply. No model capabilities are imported. */
export async function applyDocumentationReview(raw: unknown, { signal }: { signal?: AbortSignal } = {}): Promise<ReviewOutcome> {
  assertReliabilitySideEffect("product-mutation");
  let selection: ReviewSelection;
  try { selection = normalizeReviewSelection(raw); }
  catch { return { status: "invalid-selection", proposalId: "", reason: "Invalid, duplicate or unknown input fields." }; }
  const base = { proposalId: selection.proposalId };
  if (signal?.aborted) return { ...base, status: "cancelled" };
  try {
    const accepted = await documentationReviewTransaction(selection.proposalId, async scope => {
      if (!scope.row) return { error: "missing" as const };
      const state = readRetainedReview(scope.row);
      if (state.proposalHash !== selection.expectedProposalHash) return { error: "hash-mismatch" as const, hash: state.proposalHash };
      if (state.review) {
        if (state.review.selectionHash !== documentationHash(selection)) return { error: "selection-conflict" as const, hash: state.proposalHash, reason: "A different final selection has already been accepted." };
        return { state, review: state.review };
      }
      if (Date.now() >= scope.row.expiresAt.getTime()) return { error: "expired" as const, hash: state.proposalHash, reason: "Initial review acceptance has expired." };
      try { validateReviewSelection(state.proposal, state.targets, selection); }
      catch (error) { return { error: "invalid-selection" as const, hash: state.proposalHash, reason: error instanceof Error ? error.message : "Invalid selection." }; }
      if (signal?.aborted) return { error: "cancelled" as const };
      const review: AcceptedReview = { operationId: randomUUID(), selectionHash: documentationHash(selection), selection,
        acceptedAt: timestamp(), saves: [], publications: [] };
      await scope.receipt(review);
      return { state, review };
    });
    if ("error" in accepted) return { ...base, status: accepted.error!, ...(accepted.hash ? { proposalHash: accepted.hash, hashStatus: accepted.hash === selection.expectedProposalHash ? "matches" as const : "mismatched" as const } : {}), ...(accepted.reason ? { reason: accepted.reason } : {}) };
    const { state } = accepted;
    const units = approvedDocumentUnits(state.proposal, selection.decisions.filter(c => c.choice === "approve").map(c => c.decisionId));
    const transientFailures: string[] = [];
    for (const unit of units) {
      if (signal?.aborted) break;
      try { await documentationReviewTransaction(selection.proposalId, async scope => {
        if (!scope.row) throw new Error("Retained proposal disappeared.");
        const current = readRetainedReview(scope.row), review = current.review!;
        if (review.selectionHash !== documentationHash(selection)) throw new Error("Selection conflict.");
        if (review.saves.some(s => s.unitId === unit.unitId)) return;
        if (signal?.aborted) return;
        review.saves.push(await saveUnit(scope, current.proposal, review, unit, current.repository));
        await scope.receipt(review);
      }); } catch { transientFailures.push(`Save unit ${unit.unitId} has an unconfirmed transaction; inspect receipts and resume.`); }
    }
    for (const intent of selection.publications) {
      if (signal?.aborted) break;
      try { await documentationReviewTransaction(selection.proposalId, async scope => {
        if (!scope.row) throw new Error("Retained proposal disappeared.");
        const current = readRetainedReview(scope.row), review = current.review!;
        if (review.selectionHash !== documentationHash(selection)) throw new Error("Selection conflict.");
        if (review.publications.some(p => p.targetId === intent.targetId)) return;
        if (signal?.aborted) return;
        const target = current.targets.find(t => t.id === intent.targetId)!;
        if (!review.saves.some(s => s.unitId === target.unitId)) return;
        review.publications.push(await publishUnit(scope, current.proposal, review, target, intent, current.repository));
        await scope.receipt(review);
      }); } catch { transientFailures.push(`Publication target ${intent.targetId} has an unconfirmed transaction; inspect receipts and resume.`); }
    }
    const row = await findDocumentationReview(selection.proposalId);
    if (!row) throw new Error("Retained proposal disappeared.");
    const current = readRetainedReview(row), review = current.review!;
    const unfinished = review.saves.length < units.length || review.publications.length < selection.publications.length;
    const failed = review.saves.some(s => s.status !== "saved") || review.publications.some(p => p.status !== "published");
    return { ...base, proposalHash: current.proposalHash, hashStatus: "matches", review,
      status: signal?.aborted ? "cancelled" : unfinished ? "unfinished" : failed ? "partial" : "complete",
      decisions: current.proposal.results.map(r => ({ decisionId: r.decisionId, action: r.decision.action, disposition: selection.decisions.find(c => c.decisionId === r.decisionId)?.choice ?? "not-reviewed" })),
      warnings: [...new Set([...current.proposal.results.flatMap(r => r.limitations), ...transientFailures])] };
  } catch (error) {
    // A commit acknowledgement may be lost. Durable receipts, retrieved on retry,
    // are authoritative; never infer success or repeat with changed observations.
    const repositoryError = error instanceof Error && /repository|allowed/i.test(error.message);
    return { ...base, status: signal?.aborted ? "cancelled" : repositoryError ? "repository-mismatch" : "database-failure",
      reason: "Operation incomplete; inspect retained receipts and retry the identical selection." };
  }
}
