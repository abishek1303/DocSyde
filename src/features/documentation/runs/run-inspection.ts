import "server-only";
import { randomUUID } from "node:crypto";
import { runtimeObservationSchema, type RuntimeObserver, type RuntimeObservationInput } from "@/integrations/browser/runtime-observation";
import { inspectionSnapshotSchema, type InspectionSnapshot } from "./run-inspection-contract";
import { persistRunInspection } from "@/integrations/database/run-inspections";

type Entry = { id: string; token: string; snapshot: InspectionSnapshot; frame?: Uint8Array; expires?: number };
type Registry = { active?: Entry; terminal?: Entry; pending?: { id: string; token: string; snapshot: InspectionSnapshot }; busy: boolean; lastAttempt: number; timer?: ReturnType<typeof setTimeout>; expiryTimer?: ReturnType<typeof setTimeout> };
const root = globalThis as typeof globalThis & { docsydeRuntimeInspections?: Registry };
function registry() { return root.docsydeRuntimeInspections ??= { busy: false, lastAttempt: 0 }; }
function drain() {
  const r = registry();
  if (r.busy || !r.pending || r.timer) return;
  const delay = Math.max(0, 1000 - (Date.now() - r.lastAttempt));
  r.timer = setTimeout(() => {
    r.timer = undefined;
    const pending = r.pending; r.pending = undefined;
    if (!pending) return;
    r.busy = true; r.lastAttempt = Date.now();
    Promise.resolve().then(() => persistRunInspection(pending.id, pending.token, pending.snapshot)).catch(() => {}).finally(() => { r.busy = false; drain(); });
  }, delay);
  r.timer.unref();
}
function changed(entry: Entry) {
  entry.snapshot.revision++;
  registry().pending = { id: entry.id, token: entry.token, snapshot: structuredClone({ ...entry.snapshot, preview: null }) };
  drain();
}
export function startRunInspection(id: string, token: string): RuntimeObserver {
  const r = registry();
  clearTimeout(r.expiryTimer); r.expiryTimer = undefined;
  if (r.terminal) { r.terminal.frame = undefined; r.terminal.snapshot.preview = null; }
  const entry: Entry = { id, token, snapshot: { version: 1, inspectionId: randomUUID(), revision: 0, terminal: false, omittedEvents: 0, events: [], preview: null } };
  r.active = entry;
  const event = (input: RuntimeObservationInput) => {
    try {
      if (r.active !== entry || entry.snapshot.terminal) return;
      const s = entry.snapshot;
      const next = runtimeObservationSchema.parse({ ...input, version: 1, inspectionId: s.inspectionId, seq: s.revision + 1, at: new Date().toISOString() });
      const terminal = next.kind === "failure" || next.kind === "runtime-session-stopped" || next.kind === "canonical-evidence-retained" || (next.kind === "warning" && next.code === "truncated");
      const candidate = { ...s, events: [...s.events, next] };
      if (Buffer.byteLength(JSON.stringify(next)) > 1024 || s.events.length >= (terminal ? 512 : 504) || Buffer.byteLength(JSON.stringify(candidate)) > (terminal ? 256 * 1024 - 1024 : 248 * 1024 - 1024)) s.omittedEvents++;
      else s.events.push(next);
      changed(entry);
    } catch { /* Invalid observations never reach the registry. */ }
  };
  return { event, preview(captureId, bytes) {
    try {
      if (r.active !== entry || bytes.byteLength > 2 * 1024 * 1024) return;
      const revision = entry.snapshot.revision + 1;
      // Validate before retaining bytes or exposing an identifier.
      runtimeObservationSchema.parse({ version: 1, inspectionId: entry.snapshot.inspectionId, seq: revision, at: new Date().toISOString(), phase: "browser", kind: "preview-available", captureId, revision });
      entry.frame = Uint8Array.from(bytes); entry.snapshot.preview = { captureId, revision };
      event({ phase: "browser", kind: "preview-available", captureId, revision });
    } catch { /* Best effort only. */ }
  } };
}
export function finishRunInspection(id: string) {
  try {
    const r = registry(), e = r.active;
    if (!e || e.id !== id) return;
    if (e.snapshot.omittedEvents) {
      const warning = { version: 1 as const, inspectionId: e.snapshot.inspectionId, seq: e.snapshot.revision + 1, at: new Date().toISOString(), phase: "lifecycle" as const, kind: "warning" as const, code: "truncated" as const };
      if (e.snapshot.events.length < 512) e.snapshot.events.push(warning);
    }
    e.snapshot.terminal = true; e.expires = Date.now() + 60_000;
    changed(e); r.active = undefined; r.terminal = e;
    clearTimeout(r.expiryTimer);
    r.expiryTimer = setTimeout(() => { e.frame = undefined; e.snapshot.preview = null; }, 60_000); r.expiryTimer.unref();
  } catch { /* Never block coordinator cleanup. */ }
}
export function readMemoryInspection(id: string) {
  const r = registry(), e = r.active?.id === id ? r.active : r.terminal?.id === id ? r.terminal : undefined;
  if (!e) return null;
  if (e.expires && Date.now() >= e.expires) { e.frame = undefined; e.snapshot.preview = null; }
  return inspectionSnapshotSchema.parse(structuredClone(e.snapshot));
}
export function readInspectionPreview(id: string, revision: number) {
  const snapshot = readMemoryInspection(id), r = registry();
  const e = r.active?.id === id ? r.active : r.terminal?.id === id ? r.terminal : undefined;
  return snapshot?.preview?.revision === revision && e?.frame ? Uint8Array.from(e.frame) : null;
}
