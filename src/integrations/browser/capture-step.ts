import { z } from "zod";

export const captureSelector = z.string().min(1);
export const captureStepSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("click"), selector: captureSelector }).strict(),
  z.object({ type: z.literal("fill"), selector: captureSelector, value: z.string() }).strict(),
  z.object({ type: z.literal("select"), selector: captureSelector, value: z.string() }).strict(),
  z.object({ type: z.literal("check"), selector: captureSelector, checked: z.boolean() }).strict(),
  z.object({ type: z.literal("waitFor"), selector: captureSelector }).strict(),
]);
