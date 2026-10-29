"use server";
import { contextInput, type ContextState } from "@/features/sources/source-context";
import { readSourceContext } from "@/features/sources/read-source-context";
import { SourceReadError } from "@/integrations/github/errors";
export async function loadSourceContext(_previous: ContextState, form: FormData): Promise<ContextState> {
  const paths = form.get("paths");
  const parsed = contextInput.safeParse({ owner: form.get("owner"), repo: form.get("repo"), revision: form.get("revision"), paths: typeof paths === "string" ? paths.split(/\r?\n/).map(p => p.trim()).filter(Boolean) : paths });
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };
  try { return { result: await readSourceContext(parsed.data) }; }
  catch (error) {
    if (error instanceof Error && "issues" in error) return { error: "Provide a valid revision and relative file paths without traversal, backslashes, or control characters." };
    if (error instanceof SourceReadError) return { error: `${error.message}${error.retryAfterSeconds ? ` Retry after ${error.retryAfterSeconds} seconds.` : ""}` };
    return { error: error instanceof Error ? error.message : "Source review failed." };
  }
}
