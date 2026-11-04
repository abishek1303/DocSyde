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
