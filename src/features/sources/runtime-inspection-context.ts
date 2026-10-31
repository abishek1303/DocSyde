import { z } from "zod";

// Server-owned coverage metadata, never an evidence reference or mutation authority.
export const runtimeInspectionContextSchema = z.object({
  decision: z.enum(["not-evaluated", "not-needed", "inspect", "unresolved"]),
  outcome: z.enum(["not-needed", "unavailable", "requested-but-uncovered", "attempted-and-failed", "completed"]),
  reason: z.string().min(1).max(500),
  requestedTargets: z.array(z.string().max(1024)).max(3),
  uncoveredTargets: z.array(z.string().max(1024)).max(3),
  unresolvedQuestions: z.array(z.string().max(300)).max(4),
  workflow: z.object({ id: z.string().max(100), version: z.string().max(100), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict().optional(),
  limitations: z.array(z.string().max(500)).max(8),
}).strict();
export type RuntimeInspectionContext = z.infer<typeof runtimeInspectionContextSchema>;
