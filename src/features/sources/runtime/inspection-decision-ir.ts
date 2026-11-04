import { z } from "zod";

// Single-line concise prose: exclude control/format characters and lone surrogates.
// This also bounds JSON escaping and UTF-8 bytes, not only JavaScript string length.
const prose = (maximum: number) => z.string().min(1).max(maximum).regex(/^[^\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]+$/u).refine(value => value.trim().length > 0);
export const inspectionDecisionIRSchema = z.object({
  status: z.enum(["not-needed", "inspect", "unresolved"]),
  reason: prose(180),
  staticEvidence: z.enum(["sufficient", "insufficient", "uncertain"]),
  targets: z.array(z.object({
    findingRef: z.string().regex(/^finding-[1-4]$/),
    targetRef: z.string().regex(/^target-[0-9]{1,6}$/).nullable(),
    reason: prose(180),
  }).strict()).max(3),
  uncertainties: z.array(prose(80)).max(3),
}).strict().superRefine((value, ctx) => {
  const invalid = value.status === "not-needed" ? value.targets.length !== 0
    : value.status === "inspect" ? !value.targets.length || value.targets.some(t => t.targetRef === null)
      : !value.uncertainties.length || (value.targets.length > 0 && value.targets.every(t => t.targetRef !== null));
  if (invalid) ctx.addIssue({ code: "custom", message: "Inconsistent inspection status and targets." });
});
export type InspectionDecisionIR = z.infer<typeof inspectionDecisionIRSchema>;
