import "server-only";
import { attachRuntime, launchRuntime } from "./runtime";
import { captureRuntimeTrace } from "@/integrations/browser/capture-trace";
import { runtimeWorkflowSchema, type RuntimeWorkflowInput } from "@/integrations/browser/runtime-trace";
import type { ArtifactStorage } from "@/integrations/storage/artifact-storage";

export type WorkflowRuntime =
  | { mode: "launch"; options: Parameters<typeof launchRuntime>[0] }
  | { mode: "attach"; options: Parameters<typeof attachRuntime>[0] };

export async function captureWorkflowWithRuntime(
  { runtime, workflow }: { runtime: WorkflowRuntime; workflow: Omit<RuntimeWorkflowInput, "baseUrl"> },
  storage: ArtifactStorage, signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const validatedWorkflow = runtimeWorkflowSchema.parse({ ...workflow, baseUrl: runtime.options.baseUrl });
  const options = { ...runtime.options, signal: AbortSignal.any([...(signal ? [signal] : []), ...(runtime.options.signal ? [runtime.options.signal] : [])]) };
  const session = runtime.mode === "launch" ? await launchRuntime({ ...runtime.options, ...options }) : await attachRuntime(options);
  let trace;
  try {
    trace = await captureRuntimeTrace({ ...validatedWorkflow, baseUrl: session.description.baseUrl }, storage, options.signal);
  } catch (error) {
    try { await session.stop(); } catch (cleanup) { throw new AggregateError([error, cleanup], "Workflow and runtime cleanup failed."); }
    throw error;
  }
  await session.stop();
  return { runtime: session.description, trace };
}
