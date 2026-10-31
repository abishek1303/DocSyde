import { z } from "zod";
import type { DocumentationDocument } from "./document";
import type { TransformationAuthorization } from "./transformation-input";
import { transformationInstructions } from "./transformation-prompt";
import { transformationEnvelopeSchema, TRANSFORMATION_AGGREGATE_BYTES, TRANSFORMATION_BATCH_BLOCKS, TRANSFORMATION_OUTPUT_TOKENS, TRANSFORMATION_REQUEST_BYTES } from "./documentation-change-proposal";

export function transformationRequest(authorizations: TransformationAuthorization[], targets: DocumentationDocument[]) {
  const documents = targets.filter(doc => authorizations.some(auth => auth.target.documentId === doc.id)).map(doc => {
    const scoped = authorizations.filter(auth => auth.target.documentId === doc.id);
    const whole = scoped.some(auth => auth.shape === "replace-document");
    return { documentId: doc.id, title: doc.title, outline: doc.sections.map(({ id, title, kind }) => ({ id, title, kind })),
      sections: doc.sections.filter((section, index) => whole || scoped.some(auth => auth.target.sectionId === section.id || (auth.shape === "add-section" && index === 0))) };
  });
  const input = JSON.stringify({ authorizations, documents, maxAuthoredBlocks: TRANSFORMATION_BATCH_BLOCKS, maxCharactersPerBlock: 800 });
  const bytes = 1024 + Buffer.byteLength(JSON.stringify({ instructions: `${transformationInstructions}\nReturn only JSON matching this schema: ${JSON.stringify(z.toJSONSchema(transformationEnvelopeSchema))}`, input, maxOutputTokens: TRANSFORMATION_OUTPUT_TOKENS }));
  const blocks = authorizations.reduce((count, auth) => count + (["add-document", "replace-document"].includes(auth.shape) ? 8 : 2), 0);
  return { input, bytes, feasible: bytes <= TRANSFORMATION_REQUEST_BYTES && blocks <= TRANSFORMATION_BATCH_BLOCKS };
}

/** Exhaustive minimum partition of at most eight items. Lowest original index
 * starts each batch; lexicographic original-index lists break equal-count ties. */
export function minimumTransformationBatches<T>(items: T[], cost: (batch: T[]) => number | null, aggregateLimit = TRANSFORMATION_AGGREGATE_BYTES) {
  if (items.length > 8) throw new Error("Too many transformation decisions.");
  const feasible = new Map<number, { items: T[]; indices: number[]; bytes: number }>();
  const individuallyInfeasible: T[] = [];
  for (let mask = 1; mask < 1 << items.length; mask++) {
    const indices = items.flatMap((_item, index) => mask & (1 << index) ? [index] : []), batch = indices.map(index => items[index]);
    const bytes = cost(batch);
    if (bytes !== null) feasible.set(mask, { items: batch, indices, bytes });
  }
  let eligible = (1 << items.length) - 1;
  for (let i = 0; i < items.length; i++) if (!feasible.has(1 << i)) { individuallyInfeasible.push(items[i]); eligible &= ~(1 << i); }
  type Batch = { items: T[]; indices: number[]; bytes: number };
  const best: { value: Batch[] | null } = { value: null };
  const compare = (left: Batch[], right: Batch[]) => {
    for (let i = 0; i < left.length; i++) {
      const a = left[i].indices, b = right[i].indices;
      for (let j = 0; j < Math.min(a.length, b.length); j++) if (a[j] !== b[j]) return a[j] - b[j];
      if (a.length !== b.length) return a.length - b.length;
    }
    return 0;
  };
  function visit(remaining: number, batches: Batch[], bytes: number) {
    if (bytes > aggregateLimit || (best.value !== null && batches.length > best.value.length)) return;
    if (!remaining) { if (best.value === null || batches.length < best.value.length || (batches.length === best.value.length && compare(batches, best.value) < 0)) best.value = [...batches]; return; }
    const first = remaining & -remaining;
    for (let subset = remaining; subset; subset = (subset - 1) & remaining) {
      const batch = feasible.get(subset);
      if ((subset & first) && batch) visit(remaining ^ subset, [...batches, batch], bytes + batch.bytes);
    }
  }
  visit(eligible, [], 0);
  return { batches: best.value, individuallyInfeasible };
}
