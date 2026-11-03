import "server-only";
import { assertRunReviewEligible } from "../review/run-eligibility";
import { z } from "zod";
import { publicationRoute } from "../publication/publication-target";
import { hasExistingDocumentation } from "../library/library-operations";
import { defaultBranch, recentChanges, selectedRepository, runBranchSelection } from "@/features/sources/run-preparation";
import { previewSourceComparison, readSelectedChange } from "@/features/sources/product-analysis";
import { createDocumentationRun, getDocumentationRun } from "./run-operations";

const preparationInput = z.object({ repository: z.string().optional(), branch: z.string().optional(), rerun: z.uuid().optional(), base: z.string().min(1).max(1024).optional() });
export async function prepareDocumentationRun(raw: unknown) {
  const input = preparationInput.parse(raw);
  const repository = selectedRepository(input);
  if (input.rerun) {
    const original = await getDocumentationRun(input.rerun);
    if (!original || `${original.record.input.owner}/${original.record.input.repo}`.toLowerCase() !== repository.name.toLowerCase()) throw new Error("Run does not belong to the selected repository.");
    const canStart = !["pending", "running"].includes(original.record.status);
    const preview = await previewSourceComparison(original.record.input);
    return { repository: { ...repository, branch: original.record.input.branch }, preview, rerun: original.id, runContext: original.record.input.runContext, canStart, title: "Rerun this comparison", sourceTitle: original.record.title };
  }
  const branch = repository.branch ?? (await runBranchSelection(repository)).selected ?? await defaultBranch(repository);
  const latest = await recentChanges({ ...repository, branch }, 1);
  const head = latest.commits[0];
  if (!head) return { repository: { ...repository, branch }, preview: null, rerun: null, canStart: true, title: "Start a run", sourceTitle: "This repository has no commits yet." };
  const commit = await readSelectedChange(repository, head.sha);
  const base = input.base ?? commit.base;
  if (!base) return { repository: { ...repository, branch }, preview: null, rerun: null, canStart: true, title: "Start a run", sourceTitle: "This is the first commit. Project-wide analysis is not available yet; a comparison needs an earlier revision." };
  const preview = await previewSourceComparison({ owner: repository.owner, repo: repository.repo, base, head: head.sha });
  return { repository: { ...repository, branch }, preview, rerun: null, canStart: true, title: "Start a run", sourceTitle: head.message };
}

/** Resolve and pin the selected branch only on explicit submission. */
export async function createBranchDocumentationRun(raw: unknown) {
  const input = z.object({ repository: z.string(), branch: z.string().min(1), runContext: z.string().max(300).nullable().default(null) }).strict().parse(raw);
  const selected = selectedRepository({ repository: input.repository });
  await assertRunReviewEligible(selected.name);
  if (!await hasExistingDocumentation(selected)) return { status: "blocked" as const, message: "No documentation is available to update yet. Save documentation for this project before analyzing its latest changes." };
  const prepared = await prepareDocumentationRun({ repository: input.repository, branch: input.branch });
  if (!prepared.preview) return { status: "blocked" as const, message: "This branch needs at least two commits before it can be analyzed." };
  if (!prepared.preview.files.length) return { status: "blocked" as const, message: "There are no source changes to analyze on this branch." };
  const { owner, repo, branch } = prepared.repository;
  const id = await createDocumentationRun({ owner, repo, branch, base: prepared.preview.base, head: prepared.preview.head, paths: [], associations: [], runContext: input.runContext });
  return { status: "created" as const, id, repository: prepared.repository.name, branch };
}

/** Current revision only: no comparison or prior documentation required. */
export async function createFullScanRun(raw: unknown) {
  const input = z.object({ repository: z.string(), branch: z.string().min(1).max(1024), route: publicationRoute.optional(), runContext: z.string().max(300).nullable().default(null) }).strict().parse(raw);
  const repository = selectedRepository({ repository: input.repository });
  const id = await createDocumentationRun({ owner: repository.owner, repo: repository.repo, branch: input.branch,
    base: input.branch, head: input.branch, mode: "current-state", paths: [], associations: input.route ? [{ id: "scan-route", kind: "route", value: input.route, origin: "operator" }] : [], runContext: input.runContext });
  return { id, repository: repository.name, branch: input.branch };
}
