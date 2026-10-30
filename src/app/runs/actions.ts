"use server";
import { redirect } from "next/navigation";
import { createDocumentationRun, getDocumentationRun } from "@/features/documentation/run-operations";
import { associationChoice } from "@/features/documentation/document";
import { z } from "zod";
export async function startRun(_previous: { error?: string }, form: FormData): Promise<{ error?: string }> {
  let id;
  let query = new URLSearchParams();
  try {
    const paths = form.get("paths");
    const catalog = form.get("associations");
    id = await createDocumentationRun({ owner: form.get("owner"), repo: form.get("repo"), base: form.get("base"), head: form.get("head"), branch: form.get("branch") || undefined, runContext: form.get("runContext") || null,
      paths: typeof paths === "string" ? paths.split(/\r?\n/).map(path => path.trim()).filter(Boolean) : [],
      associations: z.array(associationChoice).max(20).parse(typeof catalog === "string" && catalog.trim() ? JSON.parse(catalog) : []),
    });
    query = new URLSearchParams({ repository: `${form.get("owner")}/${form.get("repo")}`, ...(form.get("branch") ? { branch: String(form.get("branch")) } : {}) });
  } catch { return { error: "Could not start the run. Check the comparison, optional context and paths, repository access, and PostgreSQL migrations." }; }
  redirect(`/runs/${id}?${query}`);
}
export async function retryRun(_previous: { error?: string }, form: FormData): Promise<{ error?: string }> {
  let id;
  let query = new URLSearchParams();
  try {
    const run = await getDocumentationRun(form.get("id"));
    if (!run || ["pending", "running"].includes(run.record.status)) throw new Error("Run is still active.");
    id = await createDocumentationRun(run.record.input);
    query = new URLSearchParams({ repository: `${run.record.input.owner}/${run.record.input.repo}`, ...(run.record.input.branch ? { branch: run.record.input.branch } : {}) });
  } catch { return { error: "Could not create a new attempt. Check access and PostgreSQL, then retry." }; }
  redirect(`/runs/${id}?${query}`);
}
