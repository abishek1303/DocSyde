import { z } from "zod";

// Presentation only. Source references and mutation permissions remain server-owned.
const text = z.string().min(1).max(600);
export const compositionOutputSchema = z.object({ sections: z.array(z.object({
  sectionRef: z.number().int().min(0).max(3), title: z.string().min(1).max(160),
  content: z.array(z.object({ blockRef: z.number().int().min(0).max(1),
    parts: z.array(z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("paragraph"), text }).strict(),
      z.object({ kind: z.literal("bullets"), items: z.array(z.string().min(1).max(200)).min(1).max(6) }).strict(),
      z.object({ kind: z.literal("steps"), items: z.array(z.string().min(1).max(200)).min(1).max(6) }).strict(),
    ])).min(1).max(4),
  }).strict()).min(1).max(2),
}).strict()).min(1).max(4) }).strict();
export type CompositionOutput = z.infer<typeof compositionOutputSchema>;
