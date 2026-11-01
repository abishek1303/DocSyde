import type { ChangeEvidence } from "@/integrations/github/change-evidence";
import type { GeneratedSummary, SummaryResult } from "./change-summary";

export function selectEvidence(evidence: ChangeEvidence): SummaryResult {
  if (evidence.files.length > 30) throw new Error("Choose a narrower range: the analysis budget is 30 changed files.");
  const fileUrl = (commit: string, path: string) => `${evidence.repository.location}/blob/${commit}/${path.split("/").map(encodeURIComponent).join("/")}`;
  const files = evidence.files.map((file, index) => {
    const coverage = file.patch === null ? "unavailable" as const : Buffer.byteLength(file.patch, "utf8") > 12 * 1024 ? "over-budget" as const : file.patch === "" ? "empty" as const : "included" as const;
    return { ...file, id: `f${index + 1}`, coverage,
      patch: coverage === "included" || coverage === "empty" ? file.patch : null,
      url: fileUrl(file.kind === "deleted" ? evidence.base.commitId : evidence.head.commitId, file.path),
      previousUrl: file.previousPath ? fileUrl(evidence.base.commitId, file.previousPath) : null };
  });
  const result: SummaryResult = { repository: evidence.repository.location, base: evidence.base.commitId,
    head: evidence.head.commitId, commits: evidence.commits.length, files, bytes: 0,
    limited: files.some(f => ["unavailable", "over-budget"].includes(f.coverage)),
    summary: null, model: null, elapsedMs: null,
    notice: "Analysis uses GitHub-supplied patches only; patches may be incomplete. Runtime behavior, deployment, and test success are not verified." };
  result.bytes = Buffer.byteLength(modelInput(result), "utf8");
  if (result.bytes > 64 * 1024) throw new Error("Choose a narrower range: selected evidence exceeds 64 KiB. No model analysis was performed.");
  return result;
}
export function modelInput(result: SummaryResult): string {
  return JSON.stringify({ base: result.base, head: result.head, commits: result.commits,
    coverage: result.notice, files: result.files.map(({ id, path, previousPath, kind, additions, deletions, patch, coverage }) => ({ id, path, previousPath, kind, additions, deletions, patch, coverage })) });
}
export function validateCitations(summary: GeneratedSummary, result: SummaryResult): void {
  for (const claim of [...summary.observations, ...summary.effects]) {
    for (const citation of claim.citations) {
      const file = result.files.find(f => f.id === citation.fileId);
      if (!file?.patch || !file.patch.includes(citation.excerpt)) {
        throw new Error("The model returned an untraceable citation. Retry analysis; no generated summary is displayed.");
      }
    }
  }
}
