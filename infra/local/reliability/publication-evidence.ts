import { assertRuntimeIdentity } from "@/integrations/reliability/runtime-identity";
import { assertScenarioContext, type ReliabilityContext } from "@/integrations/reliability/execution-context";

export function assertPublicationEvidenceContext(context: ReliabilityContext, evidence: {
  experimentId: string; scenario: string; runtimeIdentity: unknown; route: string;
}, expectedRoute: string) {
  assertScenarioContext(context, evidence.scenario);
  if (evidence.experimentId !== context.experimentId || evidence.route !== expectedRoute || !context.runtimeIdentity) throw new Error("Publication evidence context mismatch.");
  assertRuntimeIdentity(context.runtimeIdentity, evidence.runtimeIdentity);
}

/** An uncertain command result must still be followed by observation, without retry. */
export async function observePublicationMutation<T>(command: () => Promise<boolean>, observe: () => Promise<T>) {
  let acknowledged = false;
  try { acknowledged = await command(); } catch { /* Lost acknowledgement is not proof of rollback. */ }
  return { acknowledged, observed: await observe() };
}
