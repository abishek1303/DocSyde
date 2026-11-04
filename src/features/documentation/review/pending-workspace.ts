import { guideWarnings } from "../transformation/grounding-risk";
import { documentUnitId } from "../transformation/document-units";
import "server-only";
import { z } from "zod";
import { getDatabase, type DatabaseExecutor } from "@/integrations/database/client";
import { randomUUID } from "node:crypto";
import { assertReliabilitySideEffect } from "@/integrations/reliability/execution-context";
import { selectHubReviews } from "@/integrations/database/documentation-library";
import { documentationReviewBatchTransaction, findDocumentationReview, type ReviewTransaction } from "@/integrations/database/documentation-reviews";
import { findDocumentationDraft } from "@/integrations/database/documentation-drafts";
import { findPublication } from "@/integrations/database/documentation-publications";
import { repositoryLocation } from "@/integrations/github/repository-identity";
import { selectedRepository } from "@/features/sources/run-preparation";
import { documentationHash } from "../documents/document-identity";
import { validateDocumentationDocument } from "../documents/document-validation";
import type { DocumentationDocument } from "../documents/document";
import { readRetainedReview } from "./review-proposal-operations";
import { intrinsicReviewReady } from "./materialize-approved-changes";
import { acceptedReviewSchema, requireWarningAcknowledgment, normalizeReviewSelection, type AcceptedReview } from "./documentation-review";
import { assertDocumentImages, proposalImageSuggestions, type ImageSuggestion } from "../images/document-image-operations";
import { previewImageUrl, publishedImageUrl, type DocumentImage } from "../images/document-image";
import { materializePendingEdits } from "./pending-materialization";

export const pendingInput = z.object({ repository: z.string().min(3).max(250), excluded: z.array(z.string().min(1).max(150)).max(1600).default([]), removedImages: z.array(z.uuid()).max(600).default([]) }).strict();
export const pendingPublishInput = pendingInput.extend({ expectedHash: z.string().regex(/^[a-f0-9]{64}$/), acknowledgedWarnings: z.array(z.string().min(1).max(150)).max(1600).default([]) });
type State = ReturnType<typeof readRetainedReview>;
type Entry = { state: State; result: State["proposal"]["results"][number]; key: string; unavailable: string | null; excluded: boolean; issue: string | null };
type Group = { key: string; baseline?: DocumentationDocument; entries: Entry[]; document: DocumentationDocument | null; issue: string | null; imageChoices: { image: DocumentImage; sectionTitle: string; removed: boolean; url: string }[] };
export type PendingWorkspace = {
  repository: string; hash: string; count: number; blocked: boolean;
  groups: { key: string; title: string; routes: string[]; baseline: DocumentationDocument | null; conflictKey: string | null; versions: { key: string; label: string; changeKeys: string[]; document: DocumentationDocument | null; imageSources: Record<string, string> }[]; document: DocumentationDocument | null; images: Group["imageChoices"]; imageSources: Record<string, string>; highlighted: string[]; issue: string | null;
    changes: { key: string; label: string; reason: string; warnings: { unitId: string; category?: string; reason: string; factRefs?: string[] }[]; unavailable: string | null; excluded: boolean; issue: string | null; proposalId: string }[] }[];
};
const keyFor = (state: State, decisionId: string) => `${state.proposal.proposalId}:${decisionId}`;
function ready(state: State, result: Entry["result"]) { try { return intrinsicReviewReady(state.proposal, result); } catch { return false; } }
const included = (entry: Entry) => !entry.unavailable && !entry.excluded;

async function prepare(raw: unknown, database: DatabaseExecutor = getDatabase(), eligibilityOnly = false, proposalId?: string) {
  const input = pendingInput.parse(raw), selected = selectedRepository({ repository: input.repository }), repository = repositoryLocation(selected);
  const rows = new Map<string, Awaited<ReturnType<typeof selectHubReviews>>[number]["row"]>();
  if (proposalId) {
    const row = await findDocumentationReview(z.uuid().parse(proposalId), database);
    if (!row || row.repository !== repository) throw new Error("Retained proposal unavailable for this project.");
    rows.set(row.id, row);
  } else for (let offset = 0; ; offset += 20) {
    const page = await selectHubReviews(repository, offset, !eligibilityOnly, database);
    for (const { row } of page.slice(0, 20)) rows.set(row.id, row);
    if (rows.size > 200) throw new Error("Too many pending proposals for one workspace.");
    if (page.length <= 20) break;
  }
  const states = [...rows.values()].map(readRetainedReview).sort((a, b) => a.registeredAt.localeCompare(b.registeredAt) || a.proposal.proposalId.localeCompare(b.proposal.proposalId));
  const suggestions = new Map<string, ImageSuggestion[]>();
  for (const state of eligibilityOnly ? [] : states) {
    try { suggestions.set(state.proposal.proposalId, await proposalImageSuggestions(state.proposal)); } catch { suggestions.set(state.proposal.proposalId, []); }
  }
  const groups = new Map<string, Group>(), excluded = new Set(input.excluded), observations: unknown[] = [];
  for (const state of states) for (const result of state.proposal.results) {
    if (!["add", "revise"].includes(result.decision.action)) continue;
    if (state.review?.exclusions?.some(item => item.decisionId === result.decisionId)) continue;
    if (state.review && !state.review.selection.decisions.some(choice => choice.decisionId === result.decisionId && choice.choice === "approve")) continue;
    const unitId = documentUnitId(state.proposal, result);
    const targets = state.targets.filter(target => target.unitId === unitId);
    if (state.review && targets.length && targets.every(target => state.review!.publications.some(receipt => receipt.targetId === target.id && receipt.status === "published"))) continue;
    const baseline = state.proposal.targets.find(target => target.document.id === result.decision.documentId)?.document;
    let unavailable: string | null = !state.review && Date.now() >= Date.parse(state.expiresAt) ? "This proposal expired. Run a new analysis before publishing it." : !ready(state, result) ? "This change has not passed all support checks." : null;
    if (state.review && !state.review.saves.some(receipt => receipt.unitId === unitId && receipt.status === "saved")) unavailable ??= "This previously reviewed change needs attention before it can be published.";
    if (!targets.length && !unavailable) unavailable = "This change has no approved publication destination. Review its document association first.";
    if (baseline) {
      const saved = await findDocumentationDraft(baseline.id, repository, database);
      if (!saved || documentationHash(validateDocumentationDocument(saved.document)) !== documentationHash(baseline)) unavailable ??= "The source document is no longer an exact match. Run a new analysis.";
    }
    for (const target of targets) {
      const live = await findPublication(repository, target.route, database);
      observations.push([state.proposal.proposalId, target.id, live?.id ?? null, live?.draftId ?? null]);
      if ((live?.id ?? null) !== target.observedId || (target.observedId && live?.draftId !== target.baselineId)) unavailable ??= "Live documentation changed after this proposal. Run a new analysis.";
    }
    const key = baseline?.id ?? `${state.proposal.proposalId}:${unitId}`;
    const group = groups.get(key) ?? { key, baseline, entries: [], document: baseline ?? null, issue: null, imageChoices: [] };
    group.entries.push({ state, result, key: keyFor(state, result.decisionId), unavailable, excluded: excluded.has(keyFor(state, result.decisionId)), issue: null });
    groups.set(key, group);
  }
  const known = new Set([...groups.values()].flatMap(group => group.entries.map(entry => entry.key)));
  if (input.excluded.some(key => !known.has(key))) throw new Error("changed");
  const routeOwners = new Map<string, Group>();
  for (const group of groups.values()) {
    const selected = group.entries.filter(included);
    const touched = new Set<string>();
    if (selected.length > 1 && selected.some(entry => entry.result.change!.kind === "replace-document" || (group.baseline && entry.result.change!.kind === "add-document"))) group.issue = "A whole-document update overlaps other changes. Exclude one before publishing.";
    for (const entry of selected) {
      const change = entry.result.change!;
      const target = change.kind === "replace-section" ? `section:${entry.result.decision.sectionId}` : change.kind === "add-section" ? `placement:${(group.baseline?.sections.findIndex(section => section.id === change.placement.sectionId) ?? -1) + (change.placement.position === "after" ? 1 : 0)}` : entry.key;
      if (touched.has(target)) group.issue = "Changes overlap in the same section or insertion point. Exclude one before publishing.";
      touched.add(target);
      for (const target of entry.state.targets.filter(target => target.unitId === (documentUnitId(entry.state.proposal, entry.result)))) {
        const other = routeOwners.get(target.route);
        if (other && other !== group) other.issue = group.issue = "Different documents target the same product route. Exclude one before publishing.";
        routeOwners.set(target.route, group);
      }
    }
    group.imageChoices = [
      ...(group.baseline?.sections.flatMap(section => (section.images ?? []).map(image => ({ image, sectionTitle: section.title, removed: input.removedImages.includes(image.id), url: publishedImageUrl(group.baseline!.id, image.id, repository) }))) ?? []),
      ...selected.flatMap(entry => (suggestions.get(entry.state.proposal.proposalId) ?? []).filter(suggestion => suggestion.decisionId === entry.result.decisionId).map(suggestion => ({ image: suggestion.image, sectionTitle: suggestion.sectionTitle, removed: input.removedImages.includes(suggestion.image.id), url: previewImageUrl(suggestion.image) }))),
    ];
    if (!group.issue && selected.length) {
      const edits = states.flatMap(state => {
        const results = selected.filter(entry => entry.state === state).map(entry => entry.result);
        return results.length ? [{ proposal: state.proposal, results }] : [];
      });
      try { group.document = materializePendingEdits(edits, group.baseline, { suggestions, removedImages: input.removedImages }); }
      catch { group.issue = "These updates cannot be combined within the document contract. Exclude a conflicting change or run a new analysis."; }
      if (group.document) {
        const document = group.document, used = new Set([...document.associations, ...document.sections.flatMap(section => section.associations)]);
        for (const entry of selected) for (const target of entry.state.targets.filter(target => target.unitId === (documentUnitId(entry.state.proposal, entry.result)) && (!target.observedId || target.associationIds.length > 0))) {
          if (!document.context.some(choice => choice.kind === "route" && choice.value === target.route && target.associationIds.includes(choice.id) && used.has(choice.id))) entry.unavailable = "The supported document does not select its approved product route association. Review its destination before publication.";
        }
      }
    }
  }
  const imageIds = new Set([...suggestions.values()].flatMap(items => items.map(item => item.image.id)).concat([...groups.values()].flatMap(group => group.baseline?.sections.flatMap(section => (section.images ?? []).map(image => image.id)) ?? [])));
  if (input.removedImages.some(id => !imageIds.has(id))) throw new Error("changed");
  const hash = documentationHash({ images: [...suggestions], repository, proposals: states.map(state => [state.proposal.proposalId, state.proposalHash, state.review, state.expiresAt, state.destinationCandidates]), observations });
  return { input, repository, states, groups: [...groups.values()], hash, suggestions };
}
/** Presentation-only conflict families let the UI choose a complete proposal version.
 * Selection still uses the existing exclusions and all publication checks run unchanged. */
function presentation(data: Awaited<ReturnType<typeof prepare>>): PendingWorkspace {
  const groups = data.groups.filter(group => group.entries.some(entry => !entry.unavailable));
  const routesFor = (group: Group) => [...new Set(group.entries.filter(entry => !entry.unavailable).flatMap(entry => entry.state.targets.filter(target => target.unitId === documentUnitId(entry.state.proposal, entry.result)).map(target => target.route)))];
  const overlaps = (entries: Entry[], baseline?: DocumentationDocument) => {
    if (entries.length > 1 && entries.some(entry => entry.result.change?.kind === "replace-document" || (baseline && entry.result.change?.kind === "add-document"))) return true;
    const touched = new Set<string>();
    for (const entry of entries) {
      const change = entry.result.change;
      const target = change?.kind === "replace-section" ? `section:${entry.result.decision.sectionId}` : change?.kind === "add-section" ? `placement:${(baseline?.sections.findIndex(section => section.id === change.placement.sectionId) ?? -1) + (change.placement.position === "after" ? 1 : 0)}` : entry.key;
      if (touched.has(target)) return true;
      touched.add(target);
    }
    return false;
  };
  const families = new Map<string, string>();
  const visited = new Set<string>();
  for (const group of groups) {
    if (visited.has(group.key)) continue;
    const family: Group[] = [], queue = [group];
    while (queue.length) {
      const current = queue.pop()!;
      if (visited.has(current.key)) continue;
      visited.add(current.key); family.push(current);
      queue.push(...groups.filter(other => !visited.has(other.key) && routesFor(other).some(route => routesFor(current).includes(route))));
    }
    if (family.length > 1 || family.some(item => overlaps(item.entries.filter(entry => !entry.unavailable), item.baseline) || item.issue)) {
      const key = family.map(item => item.key).sort()[0];
      for (const item of family) families.set(item.key, key);
    }
  }
  return { repository: data.input.repository, hash: data.hash, count: data.groups.flatMap(group => group.entries).filter(included).length,
    blocked: data.groups.some(group => group.issue && group.entries.some(included)),
    groups: groups.map(group => {
      const entries = group.entries.filter(entry => !entry.unavailable);
      const conflictKey = families.get(group.key) ?? null;
      const imageSources = Object.fromEntries([
        ...(group.baseline?.sections.flatMap(section => (section.images ?? []).map(image => [image.id, publishedImageUrl(group.baseline!.id, image.id, data.repository)])) ?? []),
        ...entries.flatMap(entry => (data.suggestions.get(entry.state.proposal.proposalId) ?? []).map(suggestion => [suggestion.image.id, previewImageUrl(suggestion.image)])),
      ]);
      const versions = conflictKey ? [...new Set(entries.map(entry => entry.state.proposal.proposalId))].flatMap(proposalId => {
        const proposed = entries.filter(entry => entry.state.proposal.proposalId === proposalId);
        const alternatives = overlaps(proposed, group.baseline) ? proposed.map(entry => [entry]) : [proposed];
        return alternatives.map((choices, index) => {
          let document: DocumentationDocument | null = null;
          try { document = materializePendingEdits([{ proposal: choices[0].state.proposal, results: choices.map(entry => entry.result) }], group.baseline, { suggestions: data.suggestions, removedImages: data.input.removedImages }); } catch { /* Keep an unavailable version explicit in the picker. */ }
          return { key: `${group.key}:${proposalId}:${index}`, label: document?.title ?? "Unavailable version", changeKeys: choices.map(entry => entry.key), document, imageSources };
        });
      }) : [];
      return { key: group.key, title: group.document?.title ?? group.baseline?.title ?? versions.find(version => version.document)?.document?.title ?? entries[0].state.proposal.candidates.find(candidate => candidate.decisionIds.includes(entries[0].result.decisionId))?.document.title ?? "Documentation",
        routes: routesFor(group), baseline: group.baseline ?? null, conflictKey, versions,
        document: group.document, images: group.imageChoices, imageSources: { ...imageSources, ...Object.fromEntries(group.imageChoices.map(choice => [choice.image.id, choice.url])) }, issue: group.issue,
        highlighted: group.document?.sections.filter(section => documentationHash(section) !== documentationHash(group.baseline?.sections.find(old => old.id === section.id) ?? null)).map(section => section.id) ?? [],
        changes: entries.map(entry => ({ key: entry.key, label: group.baseline?.sections.find(section => section.id === entry.result.decision.sectionId)?.title ?? (entry.result.change && "section" in entry.result.change ? entry.result.change.section.title : "Document update"),
          reason: entry.result.decision.updateIntent || entry.result.decision.reason, warnings: guideWarnings(entry.state.proposal, entry.result.decisionId), unavailable: entry.unavailable, excluded: entry.excluded, issue: entry.issue, proposalId: entry.state.proposal.proposalId })) };
    }) };
}
export async function getPendingWorkspace(raw: unknown) { return presentation(await prepare(raw)); }
export type PendingPublishOutcome = { status: "published" | "blocked" | "changed" | "unavailable"; message: string; count?: number };
export async function publishPendingWorkspace(raw: unknown): Promise<PendingPublishOutcome> {
  assertReliabilitySideEffect("product-mutation");
  try {
    const parsed = pendingPublishInput.parse(raw);
    const data = await prepare({ repository: parsed.repository, excluded: parsed.excluded, removedImages: parsed.removedImages }), view = presentation(data);
    if (data.hash !== parsed.expectedHash) return { status: "changed", message: "Pending or live documentation changed. Reload and review the current preview." };
    if (!view.count || view.blocked) return { status: "blocked", message: "Resolve or exclude the conflicting changes before publishing." };
    try {
      for (const group of data.groups) for (const entry of group.entries.filter(included))
        requireWarningAcknowledgment(guideWarnings(entry.state.proposal, entry.result.decisionId), parsed.acknowledgedWarnings.includes(entry.key));
    } catch { return { status: "blocked", message: "Review each semantic warning and explicitly acknowledge it before publication." }; }
    const activeGroups = data.groups.filter(group => group.entries.some(included));
    const activeStates = data.states.filter(state => data.groups.some(group => group.entries.some(entry => entry.state === state && (included(entry) || entry.excluded || (!state.review && !entry.unavailable)))));
    await documentationReviewBatchTransaction(activeStates.map(state => state.proposal.proposalId), async scopes => {
      const byId = new Map(scopes.map(scope => [scope.row?.id, scope]));
      // Complete all integrity, expiry, baseline and destination checks before writing.
      for (const state of activeStates) {
        const scope = byId.get(state.proposal.proposalId)!;
        if (!scope.row) throw new Error("changed");
        const current = readRetainedReview(scope.row);
        if (current.proposalHash !== state.proposalHash || documentationHash(current.review) !== documentationHash(state.review) || (!current.review && Date.now() >= scope.row.expiresAt.getTime())) throw new Error("changed");
      }
      for (const group of activeGroups) {
        await assertDocumentImages(group.document!);
        const scope = byId.get(group.entries.find(included)!.state.proposal.proposalId)!;
        if (group.baseline) {
          const baseline = await scope.baseline(group.baseline.id);
          if (!baseline || documentationHash(validateDocumentationDocument(baseline.document)) !== documentationHash(group.baseline)) throw new Error("changed");
        }
        for (const entry of group.entries.filter(included)) for (const target of entry.state.targets.filter(target => target.unitId === (documentUnitId(entry.state.proposal, entry.result)))) {
          const live = await scope.publication(data.repository, target.route);
          if ((live?.id ?? null) !== target.observedId || (target.observedId && live?.draftId !== target.baselineId)) throw new Error("changed");
          if (!target.observedId || target.associationIds.length > 0) {
            const document = group.document!, used = new Set([...document.associations, ...document.sections.flatMap(section => section.associations)]);
            if (!document.context.some(choice => choice.kind === "route" && choice.value === target.route && target.associationIds.includes(choice.id) && used.has(choice.id))) throw new Error("changed");
          }
        }
      }
      const at = new Date().toISOString(), reviews = new Map<string, AcceptedReview>();
      for (const state of activeStates) {
        const entries = data.groups.flatMap(group => group.entries).filter(entry => entry.state === state);
        const selection = normalizeReviewSelection({ proposalId: state.proposal.proposalId, expectedProposalHash: state.proposalHash,
          decisions: state.proposal.results.map(result => ({ decisionId: result.decisionId, ...(parsed.acknowledgedWarnings.includes(keyFor(state, result.decisionId)) ? { acknowledgeWarnings: true } : {}), choice: !["add", "revise"].includes(result.decision.action) ? "acknowledge" : entries.some(entry => entry.result === result && included(entry)) ? "approve" : "reject" })), publications: state.targets.filter(target => entries.some(entry => included(entry) && (documentUnitId(entry.state.proposal, entry.result)) === target.unitId)).map(target => target.observedId ? { targetId: target.id, intent: "replace", observedPublicationId: target.observedId } : { targetId: target.id, intent: "publish" }), note: "Published through the consolidated documentation workspace." });
        reviews.set(state.proposal.proposalId, state.review ? structuredClone(state.review) : { operationId: randomUUID(), selectionHash: documentationHash(selection), selection, acceptedAt: at, saves: [], publications: [] });
      }
      const destinations = new Map<string, { group: Group; scope: ReviewTransaction; observedId: string | null; baselineId: string | null }>();
      for (const group of activeGroups) {
        const scope = byId.get(group.entries.find(included)!.state.proposal.proposalId)!;
        const saved = await scope.save(group.document!.id, group.document!);
        if (!saved.equal) throw new Error("changed");
        for (const state of activeStates) {
          const entries = group.entries.filter(entry => entry.state === state && included(entry));
          if (!entries.length) continue;
          const review = reviews.get(state.proposal.proposalId)!, unitId = documentUnitId(entries[0].state.proposal, entries[0].result);
          if (!review.saves.some(receipt => receipt.unitId === unitId)) review.saves.push({ unitId, decisionIds: entries.map(entry => entry.result.decisionId), baseline: group.baseline ? "exact" : "not-required", materialization: "ready", status: "saved", documentId: group.document!.id, sha256: documentationHash(group.document), equalSave: !saved.inserted, savedAt: saved.row.savedAt.toISOString(), reason: null, at });
          for (const target of state.targets.filter(target => target.unitId === unitId)) destinations.set(target.route, { group, scope, observedId: target.observedId, baselineId: target.baselineId });
        }
      }
      const published = new Map<string, { id: string; draftId: string }>();
      for (const [route, destination] of [...destinations].sort(([a], [b]) => a.localeCompare(b))) {
        const { group, scope, observedId, baselineId } = destination;
        const publication = observedId ? await scope.replacePublication(data.repository, route, group.document!.id, observedId, baselineId!) : await scope.insertPublication(data.repository, route, group.document!.id);
        if (!publication || publication.draftId !== group.document!.id) throw new Error("changed");
        published.set(route, publication);
      }
      for (const state of activeStates) {
        const review = reviews.get(state.proposal.proposalId)!;
        for (const target of state.targets) {
          const entry = data.groups.flatMap(group => group.entries).find(entry => entry.state === state && included(entry) && (documentUnitId(entry.state.proposal, entry.result)) === target.unitId);
          if (!entry) continue;
          const publication = published.get(target.route)!;
          const unitEntries = data.groups.flatMap(group => group.entries).filter(item => item.state === state && (documentUnitId(item.state.proposal, item.result)) === target.unitId);
          review.publications.push({ decisionIds: unitEntries.filter(included).map(item => item.result.decisionId), excludedDecisionIds: unitEntries.filter(item => !included(item)).map(item => item.result.decisionId), targetId: target.id, intent: target.observedId ? "replace" : "publish", status: "published", expectedId: target.observedId, actualId: publication.id, actualDocumentId: publication.draftId, at, reason: null });
        }
        const excluded = data.groups.flatMap(group => group.entries).filter(entry => entry.state === state && entry.excluded);
        if (excluded.length) review.exclusions = [...(review.exclusions ?? []), ...excluded.map(entry => ({ decisionId: entry.result.decisionId, at }))];
        await byId.get(state.proposal.proposalId)!.receipt(acceptedReviewSchema.parse(review));
      }
    }, data.repository);
    return { status: "published", message: "Your documentation changes are live. Previous live versions are available in Archive.", count: view.count };
  } catch (error) {
    // A transaction can commit even if its acknowledgement is lost. Never claim a partial success or retry blindly.
    return { status: error instanceof Error && error.message === "changed" ? "changed" : "unavailable", message: "Publication could not be confirmed. Reload Latest Docs and Pending Changes before trying again." };
  }
}

/** Run completion uses exactly the pending workspace's destination, baseline and assembly checks. */
export async function getProposalPendingReadiness(repository: string, proposalId: string, database?: DatabaseExecutor) {
  const data = await prepare({ repository }, database, true, proposalId);
  const actionableDecisionIds = data.groups.flatMap(group => group.issue ? [] : group.entries.filter(included).map(entry => entry.result.decisionId));
  const coverageGaps = data.groups.flatMap(group => group.entries.filter(entry => entry.unavailable || group.issue).map(entry => `${entry.result.decisionId}: ${entry.unavailable ?? group.issue}`));
  return { actionableDecisionIds, coverageGaps };
}

export async function hasOtherPendingProposal(repository: string, proposalId: string, database: DatabaseExecutor) {
  const data = await prepare({ repository }, database, true);
  return data.groups.some(group => group.entries.some(entry => included(entry) && entry.state.proposal.proposalId !== proposalId));
}

/** Same intrinsic readiness, receipts, expiry, frozen baseline and destination checks as Pending Changes. */
export async function hasActionablePendingChanges(repository: string, database?: DatabaseExecutor) {
  const data = await prepare({ repository }, database, true);
  return data.groups.some(group => group.entries.some(included));
}

const discardInput = z.object({ repository: z.string().min(3).max(250), expectedHash: z.string().regex(/^[a-f0-9]{64}$/), confirmed: z.literal(true) }).strict();
export type PendingDiscardOutcome = { status: "discarded" | "changed" | "unavailable"; message: string };
export async function discardPendingWorkspace(raw: unknown): Promise<PendingDiscardOutcome> {
  assertReliabilitySideEffect("product-mutation");
  try {
    const input = discardInput.parse(raw), data = await prepare({ repository: input.repository });
    if (data.hash !== input.expectedHash) return { status: "changed", message: "Pending changes changed. Reload before discarding." };
    const entries = data.groups.flatMap(group => group.entries).filter(included);
    const states = data.states.filter(state => entries.some(entry => entry.state === state));
    await documentationReviewBatchTransaction(states.map(state => state.proposal.proposalId), async (scopes, database) => {
      const current = await prepare({ repository: input.repository }, database, true);
      const keys = current.groups.flatMap(group => group.entries).filter(included).map(entry => entry.key).sort();
      if (documentationHash(keys) !== documentationHash(entries.map(entry => entry.key).sort())) throw new Error("changed");
      const byId = new Map(scopes.map(scope => [scope.row?.id, scope]));
      const at = new Date().toISOString();
      for (const state of states) {
        const scope = byId.get(state.proposal.proposalId)!;
        if (!scope.row) throw new Error("changed");
        const current = readRetainedReview(scope.row);
        if (current.proposalHash !== state.proposalHash || documentationHash(current.review) !== documentationHash(state.review) || (!current.review && Date.now() >= Date.parse(current.expiresAt))) throw new Error("changed");
        const selection = normalizeReviewSelection({ proposalId: state.proposal.proposalId, expectedProposalHash: state.proposalHash,
          decisions: state.proposal.results.map(result => ({ decisionId: result.decisionId, choice: ["add", "revise"].includes(result.decision.action) ? "reject" : "acknowledge" })),
          publications: [], note: "Discarded pending documentation changes." });
        const review: AcceptedReview = state.review ? structuredClone(state.review) : { operationId: randomUUID(), selectionHash: documentationHash(selection), selection, acceptedAt: at, saves: [], publications: [] };
        review.exclusions = [...(review.exclusions ?? []), ...entries.filter(entry => entry.state === state).map(entry => ({ decisionId: entry.result.decisionId, at }))];
        await scope.receipt(acceptedReviewSchema.parse(review));
      }
    }, data.repository);
    return { status: "discarded", message: "Pending changes discarded. Published documentation is unchanged. You can start a new run." };
  } catch (error) {
    return { status: error instanceof Error && error.message === "changed" ? "changed" : "unavailable", message: "Discard could not be confirmed. Reload Pending Changes before trying again." };
  }
}
