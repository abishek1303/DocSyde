import { test } from "node:test";
import assert from "node:assert/strict";
import { inspectionEventLabel, runtimeFailureMessage } from "./run-inspection-presentation";
import { runtimeObservationSchema } from "@/integrations/browser/runtime-observation";

test("presentation labels use only typed event metadata and explain exact failure boundaries", () => {
  assert.equal(inspectionEventLabel({ kind: "navigation-started", phase: "browser", pathname: "/requests/r-001" }), "Opening /requests/r-001");
  assert.equal(inspectionEventLabel({ kind: "action-started", phase: "browser", action: "waitFor", actionIndex: 2 }), "Waiting for configured target · step 3");
  assert.match(inspectionEventLabel({ kind: "checkpoint-created", phase: "browser", captureId: "00000000-0000-4000-8000-000000000001", eligible: false, limitation: "masking-failed" }), /masking-failed/);
  for (const code of ["application-readiness-failed", "browser-launch-failed", "navigation-failed", "page-readiness-failed", "action-timeout", "artifact-storage-failed", "run-linkage-failed", "selection-failed"] as const) assert.ok(runtimeFailureMessage(code).length > 20);
  assert.match(runtimeFailureMessage("selection-failed"), /Vision was not started/);
  const envelope = { version: 1, inspectionId: "00000000-0000-4000-8000-000000000001", seq: 1, at: new Date().toISOString(), phase: "browser" };
  assert.equal(runtimeObservationSchema.safeParse({ ...envelope, kind: "failure", code: "action-timeout", message: "unsafe exception" }).success, false);
  assert.equal(runtimeObservationSchema.safeParse({ ...envelope, kind: "action-started", action: "click", actionIndex: 1, selector: "#secret" }).success, false);
  assert.equal(runtimeObservationSchema.safeParse({ ...envelope, kind: "navigation-started", pathname: "/requests?token=private" }).success, false);
});
