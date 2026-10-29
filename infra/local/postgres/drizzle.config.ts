import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/integrations/database/schema.ts",
  schemaFilter: ["docsyde"],
  out: "./src/integrations/database/migrations",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});
