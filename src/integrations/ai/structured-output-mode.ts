import { z } from "zod";
/** Safe invocation metadata only; never includes schema contents or provider responses. */
export const structuredOutputModeSchema = z.object({
 mode: z.enum(["native", "prompt"]), schemaName: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
 schemaVersion: z.string().max(100).nullable(), schemaSha256: z.string().regex(/^[a-f0-9]{64}$/),
 fallbackReason: z.enum(["model-unsupported", "schema-unsupported", "operator-disabled"]).nullable(),
}).strict();
export type StructuredOutputMode = z.infer<typeof structuredOutputModeSchema>;
