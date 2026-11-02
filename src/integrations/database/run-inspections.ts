import "server-only";
import { Pool } from "pg";
// Separate one-connection observation pool: a stalled observation cannot consume heartbeat connections.
const root = globalThis as typeof globalThis & { docsydeInspectionPool?: Pool };
function pool() {
  if (!process.env.DATABASE_URL) throw new Error("Database unavailable");
  if (!root.docsydeInspectionPool) {
    root.docsydeInspectionPool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 500, statement_timeout: 500, idleTimeoutMillis: 1000, allowExitOnIdle: true });
    // Idle connection failures are also presentation failures, never process failures.
    root.docsydeInspectionPool.on("error", () => {});
  }
  return root.docsydeInspectionPool;
}
export async function persistRunInspection(id: string, token: string, snapshot: { version: number; revision: number }) {
  const payload = JSON.stringify(snapshot);
  if (Buffer.byteLength(payload) > 256 * 1024 || snapshot.version !== 1) return;
  await pool().query(`INSERT INTO docsyde.documentation_run_inspections(run_id, revision, payload)
    SELECT id, $3, $4::jsonb FROM docsyde.documentation_runs
    WHERE id = $1 AND payload->'execution'->>'token' = $2
    ON CONFLICT(run_id) DO UPDATE SET revision = excluded.revision, payload = excluded.payload, updated_at = now()
    WHERE documentation_run_inspections.revision < excluded.revision`, [id, token, snapshot.revision, payload]);
}
export async function loadRunInspection(id: string): Promise<unknown | null> {
  const result = await pool().query('SELECT payload FROM docsyde.documentation_run_inspections WHERE run_id = $1', [id]);
  return result.rows[0]?.payload ?? null;
}
