import { z } from "zod";
import { runtimeObservationSchema, type RuntimeFailureCode } from "@/integrations/browser/runtime-observation";
export const inspectionSnapshotSchema = z.object({
  version: z.literal(1), inspectionId: z.uuid(), revision: z.number().int().nonnegative(),
  terminal: z.boolean(), omittedEvents: z.number().int().nonnegative(),
  events: z.array(runtimeObservationSchema).max(512),
  preview: z.object({ revision: z.number().int().positive(), captureId: z.uuid() }).strict().nullable(),
}).strict().superRefine((value, ctx) => {
  if (new TextEncoder().encode(JSON.stringify(value)).length > 256 * 1024 || value.events.some((e, i) => e.inspectionId !== value.inspectionId || (i > 0 && e.seq <= value.events[i - 1].seq) || new TextEncoder().encode(JSON.stringify(e)).length > 1024)) ctx.addIssue({ code: "custom", message: "Invalid bounded inspection" });
});
export type InspectionSnapshot = z.infer<typeof inspectionSnapshotSchema>;
export type InspectionView = { diagnostic?: { code: RuntimeFailureCode; source: "retained-run" }; snapshot: InspectionSnapshot | null; status: string; captures: { captureId: string; selected: boolean }[]; analysis: { observations: string[]; limitations: string[] }[] };
