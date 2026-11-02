import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { execFile, spawn } from "node:child_process";
import { Pool } from "pg";
import { chromium } from "playwright";
import { persistRunInspection, loadRunInspection } from "@/integrations/database/run-inspections";
import { runRecordV2 } from "@/features/documentation/runs/run-record";
import { initialWorkflowStages } from "@/features/documentation/runs/run-workflow-state";
import type { InspectionView } from "@/features/documentation/runs/run-inspection-contract";

test("SQL ownership/stale revision and production next start cross-module capture/HTTP/UI proof, no providers", { timeout: 120000 }, async t => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL }), id = randomUUID(), token = randomUUID();
  const directory = await mkdtemp(join(tmpdir(), "docsyde-inspection-"));
  // Build the real immutable Request Desk baseline without creating refs or experiments.
  const exec = promisify(execFile), root = process.cwd(), appDirectory = join(directory, 'app');
  await mkdir(appDirectory);
  const archive = join(directory, 'request-desk.tar');
  await exec('git', ['archive', '--format=tar', `--output=${archive}`, '45799b2fae07f1326296b8ba85fae51476fd153d', 'test-app']);
  await exec('tar', ['-xf', archive, '-C', appDirectory]);
  const app = join(appDirectory, 'test-app');
  await exec(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', join(root, 'infra/local/sdk/tsconfig.json'), '--outDir', join(app, '.artifacts/sdk')]);
  await exec(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', join(app, 'tsconfig.json'), '--typeRoots', join(root, 'node_modules/@types')]);
  const host = spawn(process.execPath, [join(app, 'dist/src/server.js')], { cwd: app, env: { PATH: process.env.PATH, NODE_ENV: 'test', DOCSYDE_DELIVERY_ENDPOINT: 'http://127.0.0.1:45981/api/documentation/context' }, stdio: 'ignore' });
  t.after(async () => { host.kill('SIGTERM'); if (host.exitCode === null) await new Promise<void>(resolve => host.once('exit', () => resolve())); });
  let healthy = false;
  for (let i = 0; i < 100; i++) {
    if (host.exitCode !== null) assert.fail('Owned Request Desk could not start; port 45873 may already be occupied.');
    try { if ((await fetch('http://127.0.0.1:45873/health')).ok) { healthy = true; break; } } catch { /* Wait for owned local app. */ }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.ok(healthy);
  const record = runRecordV2.parse({ schemaVersion: 2, input: { owner: "inspection-proof", repo: "offline", base: "a".repeat(40), head: "b".repeat(40), paths: [], associations: [] }, title: "Offline inspection proof", status: "finished", disposition: "interrupted", reason: "offline-proof", activeStage: null, execution: { token, heartbeatAt: new Date().toISOString(), cancelRequestedAt: null }, startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), summary: "Offline inspection proof", stages: initialWorkflowStages().map(stage => stage.key === "runtime-inspection" ? { ...stage, status: "failed", summary: "Inspection stopped.", finishedAt: new Date().toISOString() } : stage), artifacts: [], models: [], warnings: [] });
  await pool.query('INSERT INTO docsyde.documentation_runs(id,repository,status,payload) VALUES ($1,$2,$3,$4)', [id, 'https://github.com/inspection-proof/offline', record.status, record]);
  t.after(async () => { await pool.query('DELETE FROM docsyde.documentation_runs WHERE id=$1', [id]); await pool.end(); await rm(directory, { recursive: true, force: true }); });
  const before = (await pool.query('SELECT payload,updated_at FROM docsyde.documentation_runs WHERE id=$1', [id])).rows[0];
  const snapshot = { version: 1, inspectionId: randomUUID(), revision: 1, terminal: true, omittedEvents: 0, events: [], preview: null };
  await persistRunInspection(id, randomUUID(), snapshot); assert.equal(await loadRunInspection(id), null);
  await persistRunInspection(id, token, snapshot);
  await persistRunInspection(id, token, { ...snapshot, revision: 3 });
  await persistRunInspection(id, token, { ...snapshot, revision: 2 });
  assert.equal((await loadRunInspection(id) as { revision: number }).revision, 3);
  const heartbeatOwner = await pool.connect();
  try {
    await heartbeatOwner.query('BEGIN');
    await heartbeatOwner.query('SELECT id FROM docsyde.documentation_runs WHERE id=$1 FOR UPDATE', [id]);
    await persistRunInspection(id, token, { ...snapshot, revision: 4 });
    assert.equal((await loadRunInspection(id) as { revision: number }).revision, 4, 'observation upsert does not wait for the heartbeat row lock');
  } finally { await heartbeatOwner.query('ROLLBACK'); heartbeatOwner.release(); }
  assert.deepEqual((await pool.query('SELECT payload,updated_at FROM docsyde.documentation_runs WHERE id=$1', [id])).rows[0], before, 'observation SQL never touches heartbeat or run state');
  const observationPool = (globalThis as typeof globalThis & { docsydeInspectionPool?: Pool }).docsydeInspectionPool!;
  const timeoutStarted = Date.now();
  await assert.rejects(observationPool.query('SELECT pg_sleep(2)'), /statement timeout/);
  assert.ok(Date.now() - timeoutStarted < 1500);
  await pool.query('DELETE FROM docsyde.documentation_run_inspections WHERE run_id=$1', [id]);
  const server = spawn(process.execPath, ['--require', join(process.cwd(), 'infra/local/inspection/capture-preload.cjs'), 'node_modules/next/dist/bin/next', 'start', '-p', '45981', '-H', '127.0.0.1'], { cwd: process.cwd(), env: { ...process.env, NODE_OPTIONS: '', NODE_ENV: 'production', BASETEN_API_KEY: '', META_API_KEY: '', GITHUB_TOKEN: '', DOCSYDE_RELIABILITY_CONTEXT: '', DOCSYDE_RELIABILITY_MANIFEST: '', DOCSYDE_ANALYSIS_REPOSITORIES: 'inspection-proof/offline', DOCSYDE_INSPECTION_PROOF_APP_URL: 'http://127.0.0.1:45873', DOCSYDE_INSPECTION_PROOF_ID: id, DOCSYDE_INSPECTION_PROOF_TOKEN: token, DOCSYDE_STORAGE_DIRECTORY: directory }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; server.stdout.on('data', chunk => { output += chunk; }); server.stderr.on('data', chunk => { output += chunk; });
  t.after(async () => { server.kill('SIGTERM'); if (server.exitCode === null) await new Promise<void>(resolve => server.once('exit', () => resolve())); });
  const base = 'http://127.0.0.1:45981'; let view: InspectionView | undefined; let lastResponse = '';
  for (let i = 0; i < 150; i++) {
    if (server.exitCode !== null) assert.fail(output);
    try { const response = await fetch(`${base}/runs/${id}/inspection`); assert.equal(response.headers.get('cache-control'), 'no-store'); if (response.ok) { const next: InspectionView = await response.json(); lastResponse = JSON.stringify(next); if (next.snapshot?.preview && next.captures.length) { view = next; break; } } else lastResponse = await response.text(); } catch { /* Wait for production server and real capture. */ }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert.ok(view?.snapshot?.preview, `${output}\n${lastResponse}`);
  assert.ok(view.snapshot.events.some(e => e.kind === 'preview-available'));
  const stopped = view.snapshot.events.findIndex(e => e.kind === 'runtime-session-stopped');
  const retained = view.snapshot.events.findIndex(e => e.kind === 'canonical-evidence-retained');
  assert.ok(stopped >= 0 && retained > stopped, 'retention announcement follows cleanup and run linkage');
  const preview = await fetch(`${base}/runs/${id}/inspection/preview/${view.snapshot.preview.revision}`);
  assert.equal(preview.status, 200); const png = Buffer.from(await preview.arrayBuffer()); assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  const canonical = await fetch(`${base}/runs/${id}/inspection/screenshots/${view.snapshot.preview.captureId}`); assert.equal(canonical.status, 200); assert.deepEqual(Buffer.from(await canonical.arrayBuffer()), png);
  assert.equal((await fetch(`${base}/runs/${id}/inspection/preview/1`)).status, 410);
  assert.equal((await fetch(`${base}/runs/${id}/inspection/screenshots/${randomUUID()}`)).status, 404);
  assert.equal((await fetch(`${base}/runs/not-an-id/inspection`)).status, 400);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage(); await page.goto(`${base}/runs/${id}`);
    await page.getByRole('heading', { name: 'Runtime inspection', exact: true }).waitFor();
    assert.equal(await page.locator('#stage-output').getByRole('region', { name: 'Runtime inspection' }).count(), 1);
    await page.getByText('Earlier activity', { exact: false }).click();
    await page.getByRole('heading', { name: 'Captured evidence', exact: true }).waitFor();
    assert.equal(await page.getByRole('img', { name: 'Latest masked runtime capture' }).count(), 1);
    await page.route('**/inspection', route => route.abort());
    await page.reload(); await page.getByText('Inspection unavailable. Reconnecting…').waitFor();
    await page.unroute('**/inspection'); await page.getByText('Earlier activity', { exact: false }).waitFor({ timeout: 10000 });
    // UI-only fixtures use the existing page/session and canonical identities; no inference/capture.
    const snapshot = view.snapshot, captureId = view.captures[0].captureId;
    const envelope = { version: 1 as const, inspectionId: snapshot.inspectionId, at: new Date().toISOString() };
    for (const mode of ['failed', 'selected', 'vision-started'] as const) {
      const selectionEvents: NonNullable<InspectionView['snapshot']>['events'] = [
        { ...envelope, seq: 1, phase: 'selection', kind: 'visual-selection-started' },
        ...(mode === 'failed' ? [{ ...envelope, seq: 2, phase: 'selection' as const, kind: 'failure' as const, code: 'selection-failed' as const }]
          : [{ ...envelope, seq: 2, phase: 'selection' as const, kind: 'visual-selection-completed' as const, selected: [captureId], skipped: false }]),
        ...(mode === 'vision-started' ? [{ ...envelope, seq: 3, phase: 'vision' as const, kind: 'vision-analysis-started' as const }] : []),
      ];
      await page.route('**/inspection', route => route.fulfill({ json: { ...view, captures: view.captures.map(cp => ({ ...cp, selected: mode !== 'failed' && cp.captureId === captureId })), snapshot: { ...snapshot, events: selectionEvents } } }));
      await page.reload();
      const pane = page.getByRole('region', { name: 'Runtime inspection' });
      await pane.getByText(mode === 'failed' ? /selection: failure/ : /selection: visual selection completed/).waitFor();
      if (mode === 'failed') assert.match(await pane.getByRole('alert').innerText(), /Visual selection failed[\s\S]*Vision was not started/);
      assert.equal(await pane.getByText(/vision analysis started/).count() > 0, mode === 'vision-started');
      assert.equal(await pane.getByText('Selected for analysis', { exact: true }).count(), mode === 'failed' ? 0 : 1);
      await page.unroute('**/inspection');
    }
    // One active fixture updates through the existing one-second polling, without page reload.
    const active = runRecordV2.parse({ ...record, artifacts: (await pool.query('SELECT payload FROM docsyde.documentation_runs WHERE id=$1', [id])).rows[0].payload.artifacts, status: 'running', disposition: null, finishedAt: null, activeStage: 'runtime-inspection', stages: record.stages.map(stage => stage.key === 'runtime-inspection' ? { ...stage, status: 'running', finishedAt: null } : stage) });
    await pool.query('UPDATE docsyde.documentation_runs SET status=$2,payload=$3 WHERE id=$1', [id, 'running', active]);
    let revision = 100;
    await page.route('**/inspection', route => route.fulfill({ json: { ...view, snapshot: { ...view.snapshot, revision: revision++, events: [{ version: 1, inspectionId: view.snapshot!.inspectionId, seq: revision, at: new Date().toISOString(), phase: 'browser', kind: revision < 103 ? 'browser-launch-started' : 'browser-launched' }] } } }));
    await page.reload();
    await page.getByText('Launching browser', { exact: true }).first().waitFor();
    await page.getByText('Browser launched', { exact: true }).first().waitFor({ timeout: 10000 });
    await page.unroute('**/inspection');
    await pool.query('UPDATE docsyde.documentation_runs SET status=$2,payload=$3 WHERE id=$1', [id, 'finished', { ...active, status: 'finished', disposition: 'interrupted', finishedAt: new Date().toISOString(), activeStage: null, stages: record.stages }]);
    await page.route('**/inspection/screenshots/*', route => route.fulfill({ status: 404 }));
    await page.reload();
    await page.getByText('Screenshot unavailable. The event timeline remains available.', { exact: true }).waitFor();
    await page.getByRole('heading', { name: 'Inspection timeline' }).waitFor();
    await page.unroute('**/inspection/screenshots/*');
  } finally { await browser.close(); }
  const linked = (await pool.query('SELECT payload FROM docsyde.documentation_runs WHERE id=$1', [id])).rows[0].payload;
  const tampered = structuredClone(linked); tampered.artifacts[0].sha256 = '0'.repeat(64);
  await pool.query('UPDATE docsyde.documentation_runs SET payload=$2 WHERE id=$1', [id, tampered]);
  assert.equal((await fetch(`${base}/runs/${id}/inspection/screenshots/${view.snapshot.preview.captureId}`)).status, 400);
  await pool.query('UPDATE docsyde.documentation_runs SET payload=$2 WHERE id=$1', [id, linked]);
  const unlinked = { ...linked, artifacts: [] };
  await pool.query('UPDATE docsyde.documentation_runs SET payload=$2 WHERE id=$1', [id, unlinked]);
  assert.equal((await fetch(`${base}/runs/${id}/inspection/screenshots/${view.snapshot.preview.captureId}`)).status, 404, 'preview cannot authorize unlinked evidence');
  await pool.query('UPDATE docsyde.documentation_runs SET payload=$2 WHERE id=$1', [id, linked]);
  server.kill('SIGTERM'); await new Promise<void>(resolve => server.once('exit', () => resolve()));
  const saved = await loadRunInspection(id); assert.ok(saved, 'metadata reload survives process exit');
  const reload = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', '45981', '-H', '127.0.0.1'], { cwd: process.cwd(), env: { ...process.env, NODE_OPTIONS: '', NODE_ENV: 'production', BASETEN_API_KEY: '', META_API_KEY: '', GITHUB_TOKEN: '', DOCSYDE_RELIABILITY_CONTEXT: '', DOCSYDE_RELIABILITY_MANIFEST: '', DOCSYDE_ANALYSIS_REPOSITORIES: 'inspection-proof/offline', DOCSYDE_STORAGE_DIRECTORY: directory }, stdio: 'ignore' });
  t.after(async () => { reload.kill('SIGTERM'); if (reload.exitCode === null) await new Promise<void>(resolve => reload.once('exit', () => resolve())); });
  let reloaded = false;
  for (let i = 0; i < 100; i++) {
    try {
      const response = await fetch(`${base}/runs/${id}/inspection`);
      if (response.ok) {
        const old: InspectionView = await response.json();
        assert.ok(old.snapshot); assert.equal(old.snapshot.preview, null); assert.equal(old.captures.length, view.captures.length);
        assert.equal((await fetch(`${base}/runs/${id}/inspection/preview/${view.snapshot.preview.revision}`)).status, 410);
        assert.equal((await fetch(`${base}/runs/${id}/inspection/screenshots/${view.snapshot.preview.captureId}`)).status, 200);
        reloaded = true; break;
      }
    } catch { /* Await next start readiness. */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(reloaded, 'old run remains readable after application restart, with no capture or providers');
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM docsyde.ai_model_invocations WHERE run_id=$1', [id])).rows[0].n, 0);
});
