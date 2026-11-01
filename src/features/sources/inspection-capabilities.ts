import { z } from "zod";
import { isConcreteInspectionPath } from "./inspection-decision";

// Operator declarations are executable scope, never evidence of product behavior.
export const inspectionCapabilitySchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),
  pathname: z.string().refine(isConcreteInspectionPath),
  description: z.string().min(1).max(500),
}).strict();
export const inspectionSupportSchema = z.array(z.object({
  path: z.string().max(1024), commitId: z.string().regex(/^[a-f0-9]{40}$/i),
  status: z.enum(["available", "missing-or-unsupported", "oversized", "error"]),
  text: z.string().nullable(),
}).strict()).max(3);
export type InspectionSupport = z.infer<typeof inspectionSupportSchema>;
export type InspectionCapabilities = {
  workflow: { id: string; version: string; sha256: string };
  capabilities: z.infer<typeof inspectionCapabilitySchema>[];
};
