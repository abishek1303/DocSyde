import { test } from "node:test";
import assert from "node:assert/strict";
import { inspectionDecisionSchema } from "./inspection-decision";
import { inspectionDecisionIRSchema } from "./inspection-decision-ir";

export function maximumRuntimeDecisionIR(character = "\u0800") {
  return inspectionDecisionIRSchema.parse({ status: "inspect", reason: character.repeat(80).slice(0, 80), staticEvidence: "insufficient",
    targets: [1, 2, 3].map(i => ({ findingRef: `finding-${i}`, targetRef: "target-999999", reason: character.repeat(80).slice(0, 80) })),
    uncertainties: Array(3).fill(character.repeat(80).slice(0, 80)) });
}
export function maximumHistoricalDecision(character = "\u0000") {
  return inspectionDecisionSchema.parse({ status: "inspect", reason: character.repeat(500), staticEvidence: "insufficient",
    targets: Array.from({length: 3}, () => ({ capabilityId: "x".repeat(80), pathname: "/" + "x".repeat(1023), description: character.repeat(300),
      visibleEvidence: Array(4).fill(character.repeat(300)), citations: Array.from({length: 4}, () => ({ evidenceId: character.repeat(30), startLine: Number.MAX_SAFE_INTEGER, endLine: Number.MAX_SAFE_INTEGER, excerpt: character.repeat(600) })) })),
    uncertainties: Array(4).fill(character.repeat(300)) });
}
test("maximum schema-valid output is bounded well below 4096, including UTF-8 and escaping", () => {
  const max = maximumRuntimeDecisionIR();
  const bytes = Buffer.byteLength(JSON.stringify(max));
  assert.ok(bytes < 2300, `Maximum IR bytes ${bytes}`);
  // Conservative byte-token envelope, not a claim about the exact Muse tokenizer.
  assert.ok(bytes < 4096 * 0.6);
  for (const char of ['"', '\\', "😀", "\u0800"]) assert.ok(Buffer.byteLength(JSON.stringify(maximumRuntimeDecisionIR(char))) <= bytes);
  assert.ok(Buffer.byteLength(JSON.stringify(maximumHistoricalDecision())) > 60000);
});
