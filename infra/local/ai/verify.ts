import "dotenv/config";
import { z } from "zod";
import { generateStructured } from "@/integrations/ai/generate-structured";
generateStructured({ instructions: "Extract the receipt identifier.", input: "Receipt identifier: proof-123", schema: z.object({ receiptId: z.literal("proof-123") }).strict() })
  .then((result) => console.log(JSON.stringify(result)))
  .catch((error: unknown) => { console.error(error instanceof Error ? error.message : "Model proof failed"); process.exitCode = 1; });
