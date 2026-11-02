import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { startRunInspection, readMemoryInspection, readInspectionPreview, finishRunInspection } from "./run-inspection";
import { runtimeObservationSchema, observe, observePreview } from "@/integrations/browser/runtime-observation";

test("strict allowlist rejects arbitrary content; callbacks are isolated and copied", () => {
  const envelope = { version: 1, inspectionId: randomUUID(), seq: 1, at: new Date().toISOString(), phase: "browser", kind: "navigation-started" };
  for (const field of ["selector", "value", "error", "headers", "path", "command", "environment", "payload", "cookies", "storage", "console"]) assert.equal(runtimeObservationSchema.safeParse({ ...envelope, [field]: "private" }).success, false);
  const throwing = { event() { throw new Error("observer"); }, preview() { throw new Error("observer"); } };
  assert.doesNotThrow(() => observe(throwing, { kind: "navigation-started", phase: "browser" }));
  const bytes = Uint8Array.of(1, 2, 3);
  observePreview({ event() {}, preview(_id, copy) { copy.fill(0); } }, randomUUID(), bytes);
  assert.deepEqual([...bytes], [1, 2, 3]);
  assert.doesNotThrow(() => observePreview(throwing, randomUUID(), bytes));
});

test("global registry bounds, reserved terminal space, omitted count, replacement, copies and expiry", t => {
  const id = randomUUID(), observer = startRunInspection(id, randomUUID()), captureId = randomUUID();
  const bytes = Uint8Array.of(1, 2, 3);
  observer.preview(captureId, bytes); bytes.fill(0);
  let snapshot = readMemoryInspection(id)!;
  const revision = snapshot.preview!.revision;
  const copy = readInspectionPreview(id, revision)!; assert.deepEqual([...copy], [1, 2, 3]); copy.fill(0);
  assert.deepEqual([...readInspectionPreview(id, revision)!], [1, 2, 3]);
  observer.preview(randomUUID(), new Uint8Array(2 * 1024 * 1024 + 1));
  assert.equal(readMemoryInspection(id)!.preview!.revision, revision);
  observer.preview(captureId, Uint8Array.of(4)); assert.equal(readInspectionPreview(id, revision), null);
  for (let i = 0; i < 2000; i++) observer.event({ kind: "navigation-started", phase: "browser" });
  observer.event({ kind: "failure", phase: "lifecycle", code: "cancelled" });
  finishRunInspection(id); snapshot = readMemoryInspection(id)!;
  assert.ok(snapshot.events.length <= 512); assert.ok(snapshot.omittedEvents > 0);
  assert.ok(snapshot.events.some(e => e.kind === "failure")); assert.ok(snapshot.events.some(e => e.kind === "warning" && e.code === "truncated"));
  assert.ok(Buffer.byteLength(JSON.stringify(snapshot)) <= 256 * 1024);
  assert.ok(snapshot.events.every(e => Buffer.byteLength(JSON.stringify(e)) <= 1024));
  t.mock.method(Date, "now", () => Number.MAX_SAFE_INTEGER);
  assert.equal(readMemoryInspection(id)!.preview, null);
  const next = randomUUID(); startRunInspection(next, randomUUID());
  assert.equal(readMemoryInspection(id)!.preview, null);
  finishRunInspection(next); assert.equal(readMemoryInspection(id), null);
});


test("metadata byte limit applies before event-count limit", () => {
  const id = randomUUID(), observer = startRunInspection(id, randomUUID());
  for (let i = 0; i < 1000; i++) observer.event({ kind: "state-captured", phase: "browser", stateId: null, pathname: "/abc".repeat(128) });
  observer.event({ kind: "failure", phase: "lifecycle", code: "not-retained" });
  finishRunInspection(id);
  const snapshot = readMemoryInspection(id)!;
  assert.ok(snapshot.events.length < 504);
  assert.ok(snapshot.omittedEvents > 0);
  assert.ok(Buffer.byteLength(JSON.stringify(snapshot)) <= 256 * 1024);
  assert.ok(snapshot.events.some(e => e.kind === "failure"));
});
