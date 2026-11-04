import "server-only";
import { reliabilityBudget } from "@/integrations/ai/demo-reliability";
import { repositoryPathInput } from "@/integrations/github/source-reader";
import { readPinnedSourceContext } from "../context/read-source-context";
import { withSourceAccess } from "../repository/local-source-access";
import type { ContextFile } from "../context/source-context";
import type { InspectionSupport } from "./inspection-capabilities";

/** Explicit operator-selected head context; no discovery or semantic retrieval. */
export async function readInspectionContext(input: { owner: string; repo: string; head: string }, paths: string[], signal: AbortSignal): Promise<InspectionSupport> {
  signal.throwIfAborted();
  if (paths.length > 3 || new Set(paths).size !== paths.length) throw new Error("Select at most three unique inspection files.");
  paths.forEach(path => repositoryPathInput.parse(path));
  if (!paths.length) return [];
  return withSourceAccess(async () => {
    const context = await readPinnedSourceContext({ ...input, revision: input.head, commitId: input.head, paths }, signal);
    return boundInspectionContext(context.files, input.head);
  });
}

export function boundInspectionContext(files: ContextFile[], head: string): InspectionSupport {
  if (files.length > 3) throw new Error("Inspection context exceeds three files.");
  let bytes = 0;
  return files.map(file => {
    const entry = { path: file.path, commitId: head, text: null };
    if (file.status !== "available") return { ...entry, status: file.status === "excluded" ? "oversized" : file.status === "error" ? "error" : "missing-or-unsupported" };
    const size = Buffer.byteLength(file.text, "utf8");
    if (bytes + size > reliabilityBudget(16 * 1024, 64 * 1024)) return { ...entry, status: "oversized" };
    bytes += size;
    return { ...entry, status: "available", text: file.text };
  });
}
