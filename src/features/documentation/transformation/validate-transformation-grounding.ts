import "server-only";
import type { InvocationContext } from "@/integrations/ai/invocation-context";
import { finishInvocationValidation } from "@/integrations/ai/invocation-log";
import { z } from "zod";
import { generateStructured } from "@/integrations/ai/generate-structured";
import { supportInstructions } from "./transformation-prompt";
import { SUPPORT_REQUEST_BYTES } from "./documentation-change-proposal";
import type { TransformationAuthorization } from "./transformation-input";
import type { SupportUnit } from "./transformation-validation";

const verdictSchema = z.object({ unitId: z.string().min(1).max(100), verdict: z.enum(["supported", "unsupported", "uncertain"]), reason: z.string().min(1).max(300) }).strict();
const envelope = z.object({ verdicts: z.array(z.unknown()).max(128) }).strict();
export async function validateTransformationGrounding(units: SupportUnit[], authorizations: TransformationAuthorization[], outlines: Map<string, { id: string; title: string; kind: string }[]>, signal?: AbortSignal, onInvoke?: () => void, invocation?: InvocationContext) {
  signal?.throwIfAborted();
  const schemaText = JSON.stringify(z.toJSONSchema(verdictSchema));
  const instructions = `${supportInstructions}\nEach verdict must match ${schemaText}`;
  const input = JSON.stringify({ units, authorizations: authorizations.filter(auth => units.some(unit => unit.decisionId === auth.decisionId)).map(auth => ({
    decisionId: auth.decisionId, claims: auth.claims, facts: auth.facts,
    // Only structural outline, used for a newly authored placement rationale.
    outline: units.some(unit => unit.decisionId === auth.decisionId && unit.structural) ? outlines.get(auth.decisionId) ?? [] : [],
  })) });
  const requestBytes = 1024 + Buffer.byteLength(JSON.stringify({ instructions: `${instructions}\nReturn only JSON matching this schema: ${JSON.stringify(z.toJSONSchema(envelope))}`, input, maxOutputTokens: 8192 }));
  if (units.length > 128 || requestBytes > SUPPORT_REQUEST_BYTES) throw new Error("Support request exceeds its bounded budget.");
  onInvoke?.();
  const generated = await generateStructured({ postValidation: true, invocation: { ...invocation, stage: invocation?.stage ?? "documentation-transformation", operation: "transformation-support" }, instructions, input, schema: envelope, maxOutputTokens: 8192, signal });
  signal?.throwIfAborted();
  const parsed = generated.data.verdicts.map(value => verdictSchema.safeParse(value));
  const checks = units.map(unit => {
    const matches = parsed.flatMap(result => result.success && result.data.unitId === unit.id ? [result.data] : []);
    return { unitId: unit.id, decisionId: unit.decisionId,
      verdict: matches.length === 1 ? matches[0].verdict : "uncertain" as const,
      reason: matches.length === 1 ? matches[0].reason : "Missing, malformed or duplicate support verdict." };
  });
  const known = new Set(units.map(unit => unit.id));
  const protocolError = parsed.some(result => !result.success || !known.has(result.data.unitId));
  const duplicateOrMissing = units.some(unit => parsed.filter(result => result.success && result.data.unitId === unit.id).length !== 1);
  await finishInvocationValidation(generated.invocationId, protocolError || duplicateOrMissing ? "correspondence-rejection" : undefined,
    () => ({ operation: "transformation-support", payload: { verdicts: checks.map(({ unitId, verdict }) => ({ unitId, verdict })) } }));
  return { checks, protocolError, model: { model: generated.model, elapsedMs: generated.elapsedMs } };
}
