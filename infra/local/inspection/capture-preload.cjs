/* eslint-disable @typescript-eslint/no-require-imports -- Node preload must execute before the Next CLI. */
// Test-only preload, never imported by the product. Exercise source callbacks and
// bundled HTTP readers in the same next start Node process, without a test route.
if (process.env.DOCSYDE_INSPECTION_PROOF_ID) {
  require('tsx/cjs');
  const marker = require.resolve('server-only');
  require.cache[marker] = { id: marker, filename: marker, loaded: true, exports: {} };
  const { createServer } = require('node:http');
  const { startRunInspection, finishRunInspection } = require('../../../src/features/documentation/runs/run-inspection.ts');
  const { captureWorkflowWithRuntime } = require('../../../src/runner/runtime/capture-workflow.ts');
  const { createLocalStorage } = require('../../../src/integrations/storage/local-storage.ts');
  const { createHash } = require('node:crypto');
  const { Pool } = require('pg');
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = (url, options) => {
    if (!['127.0.0.1', 'localhost'].includes(new URL(String(url)).hostname)) throw Error('Provider attempts forbidden');
    return fetchOriginal(url, options);
  };
  const id = process.env.DOCSYDE_INSPECTION_PROOF_ID;
  const observer = startRunInspection(id, process.env.DOCSYDE_INSPECTION_PROOF_TOKEN);
  const server = createServer((_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<h1>Offline inspection</h1><input value="masked"><button id="open" onclick="document.querySelector(\'p\').hidden=false">Open</button><p hidden>Captured details</p>'); });
  async function capture(baseUrl) {
    const storage = createLocalStorage(process.env.DOCSYDE_STORAGE_DIRECTORY);
    try {
      const workflow = process.env.DOCSYDE_INSPECTION_PROOF_APP_URL ? {
        path: '/requests/new', readySelector: '#request-form', steps: [
          { type: 'fill', selector: '#title', value: 'private inspection title' },
          { type: 'click', selector: 'button[type=submit]' },
          { type: 'waitFor', selector: '#request-detail' },
          ...Array.from({ length: 10 }, () => ({ type: 'checkpoint' })),
        ],
      } : { steps: Array.from({ length: 12 }, () => ({ type: 'checkpoint' })) };
      const captured = await captureWorkflowWithRuntime({ runtime: { mode: 'attach', options: { baseUrl, ...(process.env.DOCSYDE_INSPECTION_PROOF_APP_URL ? { readinessPath: '/health' } : {}) } }, workflow }, storage, undefined, undefined, observer);
      const bytes = Buffer.from(JSON.stringify(captured));
      const artifact = { kind: 'runtime-trace', ...(await storage.store(bytes)), sha256: createHash('sha256').update(bytes).digest('hex') };
      const pool = new Pool({ connectionString: process.env.DATABASE_URL });
      await pool.query(`UPDATE docsyde.documentation_runs SET payload = jsonb_set(payload, '{artifacts}', $2::jsonb) WHERE id = $1`, [id, JSON.stringify([artifact])]);
      await pool.end();
      observer.event({ kind: 'canonical-evidence-retained', phase: 'evidence', captures: captured.trace.checkpoints.filter(cp => cp.eligible).map(cp => cp.captureId).slice(0, 12) });
      finishRunInspection(id);
    } catch (error) { console.error('Offline capture proof failed', error); process.exitCode = 1; }
    finally { server.close(); }
  }
  if (process.env.DOCSYDE_INSPECTION_PROOF_APP_URL) void capture(process.env.DOCSYDE_INSPECTION_PROOF_APP_URL);
  else server.listen(0, '127.0.0.1', () => { void capture(`http://127.0.0.1:${server.address().port}`); });
}
