import "server-only";
import ts from "typescript";
import type { ProductImpact } from "@/features/sources/product-evidence";
import { withValidationDiagnostic } from "@/integrations/ai/invocation-debug";
import type { DocumentationImpactPlan } from "../planning/documentation-impact";
import type { TransformationChange } from "./documentation-change-proposal";
import { authoredSections } from "./transformation-validation";

/** Narrow source-backed guard for claims about field trimming. Summaries are not
 * proof of normalization: inspect cited call payloads without executing source.
 * This is not a general semantic verifier; the downstream support check still runs. */
export function validateSourceNormalization(change: TransformationChange, impact: ProductImpact, plan: DocumentationImpactPlan, claimRefs: string[]) {
  for (const section of authoredSections(change)) for (const block of section.content) {
    const references = plan.claimCatalog.filter(entry => claimRefs.includes(entry.id) && block.claimRefs.includes(entry.id)).flatMap(entry => entry.claim.references);
    const excerpts = impact.provenance.sourceReferences.filter(entry => references.includes(entry.id)).flatMap(entry => entry.finding.citations.map(citation => citation.excerpt));
    const fields = new Map<string, boolean>();
    for (const excerpt of excerpts) {
      const source = ts.createSourceFile("citation.tsx", excerpt, ts.ScriptTarget.Latest, false, ts.ScriptKind.TSX);
      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node)) for (const argument of node.arguments) if (ts.isObjectLiteralExpression(argument)) {
          for (const property of argument.properties) {
            if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) continue;
            if (!ts.isIdentifier(property.name) && !ts.isStringLiteral(property.name)) continue;
            const value = ts.isPropertyAssignment(property) ? property.initializer : property.name;
            const trimmed = ts.isCallExpression(value) && ts.isPropertyAccessExpression(value.expression) && value.expression.name.text === "trim";
            // Don't infer normalization through helpers, computed values or spreads.
            if (trimmed || ts.isIdentifier(value)) {
              const key = property.name.text.toLowerCase();
              if (!/^[a-z][a-z0-9_]{0,79}$/.test(key)) continue;
              fields.set(key, (fields.get(key) ?? true) && trimmed);
            }
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    if (!fields.size) continue;
    for (const sentence of block.markdown.replace(/`/g, "").split(/[.!?;\n]/)) for (const match of sentence.matchAll(/\btrim(?:s|med|ming)?\b/gi)) {
      const before = sentence.slice(0, match.index), after = sentence.slice(match.index + match[0].length);
      if (/\b(?:not|never|without|don't|doesn't|isn't|aren't)\s+(?:\w+\s+){0,2}$/i.test(before)) continue;
      const passive = /trimmed/i.test(match[0]);
      let fieldText = passive ? before : after.split(/\b(?:then|while|leave|keep|preserve|defaults?|parse[sd]?|calls?|closes?|shows?)\b/i)[0];
      if (passive && ![...fields.keys()].some(field => new RegExp(`\\b${field}\\b`, "i").test(fieldText))) fieldText = after;
      if ([...fields].some(([field, trimmed]) => !trimmed && new RegExp(`\\b${field}\\b`, "i").test(fieldText))) {
        throw withValidationDiagnostic(new Error("Source-backed field normalization mismatch."), { validator: "documentation-transformation", code: "source-normalization-mismatch" });
      }
    }
  }
}
