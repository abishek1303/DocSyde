import "server-only";
import { createHash } from "node:crypto";
import { runtimeTraceSchema, type RuntimeTrace } from "@/integrations/browser/runtime-trace";
import { redactRuntimeText, runtimePath } from "@/integrations/browser/runtime-redaction";
import { validateProductResult } from "../analysis/validate-product-result";
import type { ProductResult } from "../analysis/product-change-analysis";

/** A fresh allowlisted projection. Never serialize the original trace to a model. */
export function summarizeRuntimeStates(source: ProductResult, raw: RuntimeTrace, description: string, secrets: readonly string[] = []) {
  const validated = validateProductResult(source);
  const trace = runtimeTraceSchema.parse(raw);
  const states = new Map(trace.states.map(state => [state.stateId, state]));
  if (states.size !== trace.states.length || new Set(trace.checkpoints.map(cp => cp.captureId)).size !== trace.checkpoints.length) throw new Error("Duplicate runtime identity.");
  for (const cp of trace.checkpoints) {
    if (!states.has(cp.stateId) || cp.eligible !== (cp.screenshot !== null && cp.limitation === null)) throw new Error("Invalid checkpoint graph.");
  }
  if (trace.events.some(event => event.stateId !== null && !states.has(event.stateId))) throw new Error("Invalid runtime event reference.");
  const clean = (text: string, limit = 500) => redactRuntimeText(text, secrets, limit)
    .replace(/(?:[A-Za-z]:\\|\/(?:Users|home|private|tmp|var)\/)[^\s"']*/g, "[local-path]");
  const findings = (validated.analysis?.findings ?? []).map((finding, index) => ({
    id: `source-${index + 1}`, kind: finding.kind, description: clean(finding.description),
    before: finding.before === null ? null : clean(finding.before, 400), after: finding.after === null ? null : clean(finding.after, 400),
    support: finding.support, uncertainties: finding.uncertainties.map(value => clean(value, 300)),
  }));
  const stateSummaries = trace.states.map(state => {
    const snapshot = state.snapshot;
    return { stateId: state.stateId, order: state.order, trigger: state.trigger, occurrences: state.occurrences,
      effects: state.effects.map(value => clean(value, 100)), pathname: runtimePath(snapshot.pathname, secrets),
      headings: snapshot.headings.map(value => clean(value, 300)), text: clean(snapshot.text, 2000),
      regions: snapshot.regions.map(region => ({ name: clean(region.name, 100), text: clean(region.text, 500) })),
      controls: snapshot.controls.map(control => ({ ...control, role: clean(control.role, 50), name: clean(control.name, 200) })),
      overlays: snapshot.overlays.map(value => clean(value, 300)),
      hostContext: snapshot.hostContext ? { applicationId: clean(snapshot.hostContext.applicationId, 100),
        route: runtimePath(snapshot.hostContext.route, secrets), featureIds: snapshot.hostContext.featureIds.map(value => clean(value, 100)) } : null,
      truncated: snapshot.truncated || snapshot.text.length > 2000 || snapshot.regions.some(region => region.text.length > 500),
    };
  });
  const fingerprints = new Map<string, string>();
  const hashes = new Map<string, string>();
  const candidates: { checkpointId: string; stateId: string; crop: RuntimeTrace["checkpoints"][number]["crop"] }[] = [];
  const duplicates: { checkpointId: string; representativeId: string }[] = [];
  for (const cp of trace.checkpoints) {
    if (!cp.eligible || !cp.screenshot) continue;
    const state = stateSummaries.find(state => state.stateId === cp.stateId)!;
    // Observed semantics only; action/order are provenance, not state identity.
    const content = { crop: cp.crop, pathname: state.pathname, headings: state.headings, text: state.text, regions: state.regions,
      controls: state.controls, overlays: state.overlays, hostContext: state.hostContext, truncated: state.truncated };
    const fingerprint = createHash("sha256").update(JSON.stringify(content)).digest("hex");
    const representativeId = hashes.get(cp.screenshot.sha256) ?? fingerprints.get(fingerprint);
    if (representativeId) duplicates.push({ checkpointId: cp.captureId, representativeId });
    else { candidates.push({ checkpointId: cp.captureId, stateId: cp.stateId, crop: cp.crop }); fingerprints.set(fingerprint, cp.captureId); }
    hashes.set(cp.screenshot.sha256, representativeId ?? cp.captureId);
  }
  const omittedDetails = trace.states.some(state => state.snapshot.text.length > 2000 || state.snapshot.regions.some(region => region.text.length > 500));
  return {
    trace,
    input: { workflow: clean(description, 500), viewport: trace.viewport, findings,
      sourceCoverage: { limited: validated.bundle.limited, uncertainties: (validated.analysis?.uncertainties ?? []).map(value => clean(value, 300)) },
      states: stateSummaries, candidates, duplicates,
      ineligible: trace.checkpoints.filter(cp => !cp.eligible).map(cp => ({ checkpointId: cp.captureId, reason: cp.limitation })),
      coverage: { ...trace.coverage, projectionCompacted: omittedDetails, omittedSummaryStates: 0, omittedDetails },
    },
  };
}
export type RuntimeStateSummary = ReturnType<typeof summarizeRuntimeStates>["input"];
