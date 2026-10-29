import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { createProject, getProject } from "@/features/projects/operations";
import { closeDatabase } from "@/integrations/database/client";

async function main() {
  const existingId = process.argv[2];
  if (existingId) {
    const project = await getProject(existingId);
    assert.ok(project, "Project was not found");
    console.log(JSON.stringify(project, null, 2));
    return;
  }

  for (const invalidName of ["", "   ", "x".repeat(201), null]) {
    await assert.rejects(() => createProject(invalidName), ZodError);
  }
  await assert.rejects(() => getProject("invalid-id"), ZodError);
  assert.equal(await getProject(randomUUID()), null);

  const name = `Persistence check ${randomUUID()}`;
  const created = await createProject(`  ${name}  `);
  assert.equal(created.name, name);
  assert.ok(created.createdAt instanceof Date);
  assert.ok(created.updatedAt instanceof Date);
  assert.ok(Number.isFinite(created.createdAt.getTime()));
  assert.ok(Number.isFinite(created.updatedAt.getTime()));

  // Read through a fresh connection, so no in-memory result can satisfy it.
  await closeDatabase();
  assert.deepEqual(await getProject(created.id), created);
  console.log("PASS: validation, missing project, create, and read via a fresh connection.");
  console.log(JSON.stringify(created, null, 2));
  console.log(`Read again after restarting PostgreSQL: npm run db:verify -- ${created.id}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Project verification failed.");
  process.exitCode = 1;
}).finally(closeDatabase);
