import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { observedProductRoutes, discoveredAssociations } from "./route-associations";
import { transformationImpactFixture, transformationPlanFixture, transformationDecisionFixture } from "../../../../infra/local/documentation/transformation-fixtures";
import { productRouteEvidence } from "@/features/sources/product-evidence";

test("observed navigation preserves capture provenance and never proves runtime revision identity", () => {
  const impact = transformationImpactFixture();
  impact.provenance.captures = [{ captureId: randomUUID(), artifactKey: randomUUID(), requestedPathname: "/settings", finalPathname: "/settings", capturedAt: new Date().toISOString(), screenshotSha256: "a".repeat(64), vision: { model: "fixture", elapsedMs: 1 } }];
  const routes = observedProductRoutes(impact); assert.equal(routes.length, 1);
  const proof = productRouteEvidence.parse(routes[0].evidence);
  assert.equal(proof.observation?.runtimeRevisionVerified, false);
  const plan = transformationPlanFixture(impact, [transformationDecisionFixture(null, null, "add")]);
  assert.equal(discoveredAssociations(impact, plan, plan.decisions[0], routes)[0].routeEvidence?.requiresConfirmation, true);
  assert.equal(productRouteEvidence.safeParse({ ...proof, requiresConfirmation: false }).success, false);
  impact.provenance.captures[0].finalPathname = "/settings/../secret";
  assert.deepEqual(observedProductRoutes(impact), []);
  impact.provenance.captures[0].finalPathname = "/settings"; delete impact.provenance.captures[0].artifactKey;
  assert.deepEqual(observedProductRoutes(impact), []);
});

import type { ProductRoute } from "@/features/sources/product-evidence";

test("route evidence never defaults to root, accepts stale proof, or promotes preview URLs", () => {
  const impact = transformationImpactFixture(), decision = transformationDecisionFixture(null, null, "add"), plan = transformationPlanFixture(impact, [decision]);
  const route = (pathname: string, sourcePaths: string[], commitId = impact.provenance.source.head): ProductRoute => ({ id: `route-${pathname.replaceAll("/", "-")}`, pathname, sourcePaths,
    evidence: { label: "Application screen", method: "file-page", commitId, sources: [{ path: "app/page.tsx", line: 1, excerpt: "Page" }], requiresConfirmation: false } });
  assert.deepEqual(discoveredAssociations(impact, plan, decision, []), []);
  const root = route("/", [impact.provenance.sourceEvidence[0].path]);
  assert.deepEqual(discoveredAssociations(impact, plan, decision, [root]).map(choice => [choice.value, choice.routeEvidence?.requiresConfirmation]), [["/", false]]);
  assert.equal(discoveredAssociations(impact, plan, decision, [route("/", ["unrelated.ts"] )])[0].routeEvidence?.requiresConfirmation, true);
  assert.deepEqual(discoveredAssociations(impact, plan, decision, [route("/", [], "0".repeat(40)), route("/ds-draft/preview", [])]), []);
  assert.ok(discoveredAssociations(impact, plan, decision, [root, route("/settings", root.sourcePaths)]).every(choice => choice.routeEvidence?.requiresConfirmation));
});
