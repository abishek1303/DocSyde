import { z } from "zod";
export const productRouteEvidence = z.object({
  label: z.string().min(1).max(100), method: z.enum(["file-page", "client-route", "spa-entry", "runtime-navigation"]),
  commitId: z.string().regex(/^[a-f0-9]{40}$/i),
  sources: z.array(z.object({ path: z.string().min(1).max(1024), line: z.number().int().positive(), excerpt: z.string().min(1).max(2000) }).strict()).min(1).max(3),
  observation: z.object({ captureId: z.uuid(), artifactKey: z.uuid(), capturedAt: z.iso.datetime(), screenshotSha256: z.string().regex(/^[a-f0-9]{64}$/), runtimeRevisionVerified: z.literal(false) }).strict().optional(),
  requiresConfirmation: z.boolean(),
}).strict().superRefine((proof, ctx) => {
  if (proof.method === "runtime-navigation" ? !proof.observation || !proof.requiresConfirmation : !!proof.observation) ctx.addIssue({ code: "custom", message: "Runtime route observations require explicit confirmation and their retained capture identity." });
});
export type ProductRoute = { id: string; pathname: string; evidence: z.infer<typeof productRouteEvidence>; sourcePaths: string[] };
