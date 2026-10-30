import "dotenv/config";
import { getBasetenBilling } from "@/integrations/ai/baseten/billing";

const now = new Date();
const startDate = process.argv[2] ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
const endDate = process.argv[3] ?? now.toISOString();
const startingCreditsUsd = process.argv[4] === undefined ? undefined : Number(process.argv[4]);
if (process.argv.length > 5) {
  console.error("Usage: npm run ai:billing -- [start-ISO-datetime end-ISO-datetime starting-credits-USD]");
  process.exitCode = 1;
} else {
  getBasetenBilling({ startDate, endDate, startingCreditsUsd })
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : "Billing check failed");
      process.exitCode = 1;
    });
}
