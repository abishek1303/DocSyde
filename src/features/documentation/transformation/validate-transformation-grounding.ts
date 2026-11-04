import "server-only";
import type { InvocationContext } from "@/integrations/ai/invocation-context";
import { finishInvocationValidation } from "@/integrations/ai/invocation-log";
import { z } from "zod";
import { generateStructured } from "@/integrations/ai/generate-structured";
import { supportInstructions } from "./transformation-prompt";
import { SUPPORT_REQUEST_BYTES, supportCategorySchema, type DocumentationChangeProposal } from "./documentation-change-proposal";
import type { TransformationSource, TransformationAuthorization } from "./transformation-input";
import type { SupportUnit } from "./transformation-validation";

const verdictSchema = z.object({
  unitId: z.string().min(1).max(100), verdict: z.enum(["supported", "unsupported", "uncertain"]),
  reason: z.string().min(1).max(300),
  // Optional for historical/model compatibility; uncategorized negative verdicts fail closed.
  category: supportCategorySchema.exclude(["protocol"]).optional(),
  factRefs: z.array(z.string().min(1).max(100)).max(6).optional(),
}).strict();
const envelope = z.object({ verdicts: z.array(z.unknown()).max(128) }).strict();
export function supportRequest(units: SupportUnit[], authorizations: TransformationAuthorization[], outlines: Map<string, { id: string; title: string; kind: string }[]>, source?: TransformationSource) {
  const schemaText = JSON.stringify(z.toJSONSchema(verdictSchema));
  const instructions = `${supportInstructions}\nEach verdict must match ${schemaText}`;
  const input = JSON.stringify({ units, authorizations: authorizations.filter(auth => units.some(unit => unit.decisionId === auth.decisionId)).map(auth => ({
    decisionId: auth.decisionId, claims: auth.claims,
    // Reuse only this fact's validated citations; summaries are not primary evidence.
    // Missing excerpts remain explicit, and the existing request byte limit applies.
    facts: auth.facts.map(fact => ({ ...fact, sourceExcerpts: (source?.findings.find(finding => finding.id === fact.findingRef)?.citations ?? []).map(citation => {
      const evidence = source?.evidence.find(item => item.id === citation.evidenceId);
      return { ...citation, ...(evidence ? { path: evidence.path, side: evidence.side, commitId: evidence.commitId } : {}) };
    }) })),
    // Only structural outline, used for a newly authored placement rationale.
    outline: units.some(unit => unit.decisionId === auth.decisionId && unit.structural) ? outlines.get(auth.decisionId) ?? [] : [],
  })) });
  const requestBytes = 1024 + Buffer.byteLength(JSON.stringify({ instructions: `${instructions}\nReturn only JSON matching this schema: ${JSON.stringify(z.toJSONSchema(envelope))}`, input, maxOutputTokens: 8192 }));
  return { instructions, input, requestBytes, feasible: units.length <= 16 && requestBytes <= SUPPORT_REQUEST_BYTES };
}
export async function validateTransformationGrounding(units: SupportUnit[], authorizations: TransformationAuthorization[], outlines: Map<string, { id: string; title: string; kind: string }[]>, signal?: AbortSignal, onInvoke?: () => void, invocation?: InvocationContext, source?: TransformationSource) {
  signal?.throwIfAborted();
  const { instructions, input, feasible } = supportRequest(units, authorizations, outlines, source);
  if (!feasible) throw new Error("Support request exceeds its bounded budget.");
  onInvoke?.();
  const generated = await generateStructured({ postValidation: true, invocation: { ...invocation, stage: invocation?.stage ?? "documentation-transformation", operation: "transformation-support" }, instructions, input, schema: envelope, maxOutputTokens: 8192, signal });
  signal?.throwIfAborted();
  const parsed = generated.data.verdicts.map(value => verdictSchema.safeParse(value));
  const checks: DocumentationChangeProposal["supportChecks"] = units.map(unit => {
    const matches = parsed.flatMap(result => result.success && result.data.unitId === unit.id ? [result.data] : []);
    const match = matches.length === 1 ? matches[0] : undefined;
    const refs = match?.factRefs;
    const scoped = !refs || (new Set(refs).size === refs.length && refs.every(ref => unit.factRefs.includes(ref)));
    const valid = !!match && scoped && (!match.category || (refs &&
      (match.category === "none" ? match.verdict === "supported" : match.verdict !== "supported" && refs.length > 0)));
    return { unitId: unit.id, decisionId: unit.decisionId,
      ...(valid && match.category ? { category: match.category, factRefs: refs } : !valid ? { category: "protocol" as const } : {}),
      verdict: valid ? match.verdict : "uncertain" as const,
      reason: valid ? match.reason : "Missing, malformed or duplicate support verdict." };
  });
  const known = new Set(units.map(unit => unit.id));
  const protocolError = checks.some(check => "category" in check && check.category === "protocol") || parsed.some(result => !result.success || !known.has(result.data.unitId));
  const duplicateOrMissing = units.some(unit => parsed.filter(result => result.success && result.data.unitId === unit.id).length !== 1);
  await finishInvocationValidation(generated.invocationId, protocolError || duplicateOrMissing ? "correspondence-rejection" : undefined,
    () => ({ operation: "transformation-support", payload: { verdicts: checks.map(({ unitId, verdict, category }) => ({ unitId, verdict, ...(category ? { category } : {}) })) } }));
  return { checks, protocolError, model: { model: generated.model, elapsedMs: generated.elapsedMs } };
}
