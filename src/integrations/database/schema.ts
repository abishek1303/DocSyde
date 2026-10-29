import { sql } from "drizzle-orm";
import { check, pgSchema, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

export const docsydeSchema = pgSchema("docsyde");

export const projects = docsydeSchema.table("projects", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 200 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
    .$onUpdate(() => new Date()),
}, (table) => [
  check("projects_name_not_blank", sql`length(trim(${table.name})) > 0`),
]);
