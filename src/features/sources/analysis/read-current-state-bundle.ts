import "server-only";
import { reliabilityBudget } from "@/integrations/ai/demo-reliability";
import { readRepositoryTree } from "@/integrations/github/repository-tree";
import { readPinnedSourceContext } from "../context/read-source-context";
import { selectCurrentStatePaths } from "./current-state-selection";
import type { ProductBundle } from "./product-change-analysis";

export async function readCurrentStateBundle(input: { owner: string; repo: string; head: string }, signal: AbortSignal): Promise<ProductBundle> {
  const tree = await readRepositoryTree(input, input.head);
  const paths = selectCurrentStatePaths(tree);
  if (!paths.length) throw new Error("No supported source files were discovered within the scan limits.");
  const excerptCharacters = reliabilityBudget(2000, 8000);
  const evidence: ProductBundle["evidence"] = [];
  for (let offset = 0; offset < paths.length; offset += 4) {
    signal.throwIfAborted();
    const context = await readPinnedSourceContext({ ...input, revision: input.head, commitId: input.head, paths: paths.slice(offset, offset + 4) }, signal);
    if (context.error || context.budgetExceeded) throw new Error("Current source reading did not complete.");
    for (const file of context.files) {
      // Preserve original line coordinates; never splice distant fragments into fake lines.
      const text = file.status === "available" ? (file.text.length <= excerptCharacters ? file.text : file.text.slice(0, excerptCharacters).replace(/[^\n]*$/, "")) : null;
      evidence.push({ id: `snapshot-${evidence.length + 1}`, path: file.path, side: "head", commitId: input.head, contentId: file.contentId,
        text: text || null, changed: false, status: text ? "available" : file.status });
    }
  }
  return { mode: "current-state", repository: `https://github.com/${input.owner.toLowerCase()}/${input.repo.toLowerCase()}`, base: input.head, head: input.head,
    inventory: paths.map(path => ({ path, previousPath: null, kind: "current-file" })), evidence, limited: true,
    notice: `Current-state scan: sampled ${paths.length} of ${tree.length} repository files, at most ${excerptCharacters} characters per file. No Git changes asserted. Other files, later file contents, and unobserved runtime behavior remain coverage gaps. At most four source findings can be prepared per run.` };
}
