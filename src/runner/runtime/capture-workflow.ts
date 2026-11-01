import "server-only";
import { attachRuntime, launchRuntime } from "./runtime";
import { captureRuntimeTrace } from "@/integrations/browser/capture-trace";
import { runtimeWorkflowSchema, type RuntimeWorkflowInput } from "@/integrations/browser/runtime-trace";
import type { ArtifactStorage } from "@/integrations/storage/artifact-storage";
import { reliabilityContext, ReliabilityIsolationError, type ReliabilityRuntimeIdentity } from "@/integrations/reliability/execution-context";
import { verifyRuntimeIdentity } from "@/integrations/reliability/runtime-identity";

export type WorkflowRuntime =
  | { mode: "launch"; options: Parameters<typeof launchRuntime>[0] }
  | { mode: "attach"; options: Parameters<typeof attachRuntime>[0] };

export async function captureWorkflowWithRuntime(
  { runtime, workflow }: { runtime: WorkflowRuntime; workflow: Omit<RuntimeWorkflowInput, "baseUrl"> },
  storage: ArtifactStorage, signal?: AbortSignal, fixtureIdentity?: ReliabilityRuntimeIdentity,
) {
  signal?.throwIfAborted();
  const context = reliabilityContext(), identity = context?.runtimeIdentity ?? fixtureIdentity;
  if (context) {
    if (!["offline", "scenario"].includes(context.mode) || process.env.DOCSYDE_RELIABILITY_CONTRACT_TEST === "1"
      || !identity || identity.experimentId !== context.experimentId || identity.scenario !== context.scenario
      || identity.docsydeSha !== context.docsydeSha || identity.requestDeskSha !== context.requestDeskSha) throw new ReliabilityIsolationError("capture-context");
    if (runtime.mode === "attach") await verifyRuntimeIdentity(runtime.options.baseUrl, identity);
  }
  const validatedWorkflow = runtimeWorkflowSchema.parse({ ...workflow, baseUrl: runtime.options.baseUrl });
  const options = { ...runtime.options, fixtureIdentity: identity, signal: AbortSignal.any([...(signal ? [signal] : []), ...(runtime.options.signal ? [runtime.options.signal] : [])]) };
  const session = runtime.mode === "launch" ? await launchRuntime({ ...runtime.options, ...options }) : await attachRuntime(options);
  let trace;
  try {
    if (context && identity) await verifyRuntimeIdentity(session.description.baseUrl, identity);
    trace = await captureRuntimeTrace({ ...validatedWorkflow, baseUrl: session.description.baseUrl }, storage, options.signal, identity);
  } catch (error) {
    try { await session.stop(); } catch (cleanup) { throw new AggregateError([error, cleanup], "Workflow and runtime cleanup failed."); }
    throw error;
  }
  await session.stop();
  return { runtime: session.description, trace };
}
