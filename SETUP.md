# Local demo setup

Start with the copy/paste commands in [README.md](README.md#run-locally). `npm run db:setup` starts PostgreSQL, waits for health, and applies all checked-in migrations. It is safe to rerun; it does not seed documents or erase data. No Supabase account, cloud database, queue, or optional integration is required to start DocSyde.

## Configuration

Edit the ignored root `.env`:

| Setting | Needed for |
| --- | --- |
| `DATABASE_URL` | Persisted understanding, runs, documents, and MCP. The example matches Compose defaults. |
| `DOCSYDE_STORAGE_DIRECTORY` | Runtime images. The directory is created on first capture; keep it outside `public/`. |
| `GITHUB_TOKEN` | Reading selected repositories; use Contents: read permission. |
| `BASETEN_API_KEY` | New product understanding and change-analysis text calls (Muse Spark Open). |
| `DOCSYDE_ANALYSIS_REPOSITORIES` | Comma-separated repositories shown in the project picker. The example includes the demo and DocSyde. |
| `META_API_KEY` | Runtime screenshot analysis via Muse Spark; optional Wonder composition. |
| `DOCSYDE_MCP_ENABLED=1` | Enables the read-only local MCP endpoint. |

Optional provider overrides are commented in `.env.example`. Defaults are Muse Spark Open `meta-models/muse-spark-open-1026` and Meta vision `muse-spark-1.3`. Setting `META_COMPOSITION_MODEL=muse-wonder-1.0` opts into a compact editorial pass between grounded transformation and support verification. It does not bypass grounding or approval. Leave it unset to preserve the existing transformation-only path. Native structured output is selected automatically; compatibility mode is an operator override, not required setup.

`DOCSYDE_DRAFT_SIGNING_KEY` is only needed to save previews from the standalone legacy initial-draft flow; generate one with `openssl rand -hex 32`. Incremental proposal review does not need it. `DOCSYDE_HOST_ORIGIN` permits one exact browser origin for host SDK delivery; MCP and the main UI do not need it. Reliability/inspection proof scripts manage their own isolation variables; they are not judge setup requirements.

If port 5432 is occupied, set `POSTGRES_PORT` and update `DATABASE_URL`. Compose otherwise supplies `POSTGRES_USER`, `POSTGRES_PASSWORD`, and `POSTGRES_DB` defaults. Use `docker compose -f infra/local/compose.yaml ps` to inspect health. Existing volumes retain their original credentials; changing `.env` does not change database users. Avoid conflicting `.env.local` overrides: Next.js reads those, while CLI scripts read `.env`.

## Separate demo application (OpenTodo)

In another terminal, outside the DocSyde directory:

```sh
git clone https://github.com/abishek1303/DockSyde-demo-app-test-subject.git
cd DockSyde-demo-app-test-subject
# Optional: reproduce the controlled Blocked-guidance revision.
git checkout c120171beb7ebf280b9eab877277f0f1f08d1517
npx --yes pnpm@10 install --frozen-lockfile
npx --yes pnpm@10 run dev
```

Open **http://localhost:5173/?agent**. The app runs its local API on port **8787** and initializes local SQLite through Wrangler; no Cloudflare account is required. Keep both ports free. Create an issue through the app if the list is empty. The provided runtime example expects **TASK-1**; choose that issue and set its status to **Blocked** when demonstrating Blocked guidance. This is controlled local application data, not inferred behavior.

To enable real runtime inspection in DocSyde, uncomment:

```dotenv
DOCSYDE_RUN_RUNTIME_CONFIG=infra/local/runner/opentodo.example.json
```

Also configure `META_API_KEY`, install Chromium, start OpenTodo, and restart DocSyde. The trusted example attaches to the existing process and inspects TASK-1; it never starts or stops the external app. If your issue identifier or port differs, copy the example to an ignored local file, adjust its selectors/URL, and point the variable there. Runtime coverage is explicit and bounded; no autonomous browser exploration is enabled. Missing runtime configuration allows source-only analysis with explicit limitations.

Controlled source comparison:

```text
Base 52995911826a07247049aa9a914627ff3e9b9e50
Head c120171beb7ebf280b9eab877277f0f1f08d1517
```

The branch may now contain newer changes. Select the intended commits rather than assuming its latest head matches this comparison.

## First understanding and documentation

Choose **New run → project → Full scan** to generate initial documentation or regenerate existing documentation without a new commit or diff. Select a branch and optional product context. For an initial document, supply its product route so a publication destination can be proposed. The scan pins one current SHA, samples up to 16 files (2000 characters per file) across discovered repository areas, and prepares at most four source findings. Unsampled files and remaining file contents are explicit coverage gaps; this is not exhaustive repository analysis.

Full Scan plans against current published snapshots, excluding unpublished and archived
snapshots. With no published documentation, source-supported additions use the existing
canonical document proposal flow. Supply an explicit product route for initial publication;
an occupied route or an unselected/missing route association remains blocked. Support-checked
work is retained for audit, but only publishable changes appear in Pending Changes and enable
the run’s Review changes action. Nothing is published until you explicitly publish the batch.

Full Scan reuses saved repository understanding as advisory context, then the existing runtime, planning, transformation, support checking and proposal-retention pipeline. **View or refresh reusable product understanding** opens the existing lightweight onboarding flow separately; reopening its artifact does not invoke inference. Provider credentials are needed to execute new generation, not to render setup.

A fresh database correctly disables **Latest Changes** until an eligible canonical document has been saved. Unsaved generated proposals do not qualify. Published documents and valid saved documents are eligible for candidate selection; MCP only exposes published documents.

Each project follows **Analyze → Review changes → Publish or Discard → Analyze again**. Actionable pending changes disable both Full Scan and Latest Changes, with a direct **Review pending changes** link. Server-side creation and execution recheck this rule. **Discard pending changes** requires confirmation, records exclusions and leaves live documentation unchanged. Published, rejected, excluded, expired and unavailable proposals do not block another run; other projects are independent.

Full Scan only creates reviewable proposals: it never deletes or replaces published documentation automatically. Accepted output exposes **Review changes** directly in Pending Changes and highlights its document groups. Unsupported output explains the stopped stage and recovery action; technical details and **AI activity / Logs** retain diagnostics. The legacy standalone draft flow remains available at `/sources/analysis`; see the [documentation guide](src/features/documentation/README.md).

Then choose **Latest Changes**, select the comparison, and optionally add change context. Successful proposals lead to **Documents → Pending Changes**. Read the combined rendered preview, **Reject** unwanted edits (or **Undo**), then explicitly **Publish N changes**. This single action atomically records approval/rejection, saves the included canonical documents, and publishes to retained product destinations. Overlapping updates, expired proposals, stale snapshots, and destination conflicts are blocked. Publishing also finalizes excluded edits, including wholly excluded previously approved proposals, so they leave Pending Changes on refresh. Exclusion receipts preserve the earlier immutable approvals. Future proposals remain independent. Standalone saved documents remain available through **Browse saved documents**; legacy individual review remains accessible from optional evidence details. Latest Docs and MCP reflect the new live version; Archive keeps previous live versions. Historical reference runs and publications are local database state and are not bundled in a fresh clone.

## MCP: the same knowledge for agents

DocSyde acts as a synchronized product-context layer for both humans and AI agents. With MCP enabled, the ordinary local app serves **http://127.0.0.1:3000/api/mcp**. No separate server or model inference is required. Open **MCP** for status, real query examples, and copyable HTTP client configuration.

```sh
npm run mcp:query -- get_product_context abishek1303/DockSyde-demo-app-test-subject
npm run mcp:query -- get_documentation abishek1303/DockSyde-demo-app-test-subject /
npm run mcp:query -- get_context_for_surface abishek1303/DockSyde-demo-app-test-subject /
```

Use an exact **published route**; `/` above is an example, not an automatic association. Unknown routes return a clean empty result. Override the CLI endpoint with `--url http://127.0.0.1:3000/api/mcp` or optional `DOCSYDE_MCP_URL`. Tools are read-only: no repository writes, approvals, or publication. Current published documentation is authoritative; saved repository understanding is labeled advisory, and pending wording is excluded. Bind to loopback—there is no public authentication layer.

## Verification and production preview

```sh
npm run ai:test
npm run sources:understanding:test
npm run documentation:test
npm run mcp:test
npm run lint
npx next typegen
npx tsc --noEmit
npm run build -- --webpack
npm start -- --hostname 127.0.0.1
```

Build requires Google Fonts access. After building, isolated local browser/lifecycle checks use migrated PostgreSQL and Chromium:

```sh
npm run documentation:pending:test
npm run documentation:ux:test
npm run mcp:integration:test
```

These tests create and clean their own repositories/documents, clear AI credentials in the test server, and never publish connected demo documents. Scripts named `*:verify` may spend credits or retain artifacts; read the relevant integration guide before running them. Keep screenshots, storage, and compiled SDK output under ignored `.artifacts/`.

Stop local infrastructure with `docker compose -f infra/local/compose.yaml down`. Do not add `-v` unless you intend to delete all local database data. For deeper implementation details, use [ARCHITECTURE.md](ARCHITECTURE.md), [MODEL_USAGE.md](MODEL_USAGE.md), and the linked feature/integration guides.

## Screenshots in documentation

No new credentials or model calls are required. Pending Changes suggests a stored,
masked Playwright checkpoint only when validated claim/selection references and an
exact document route connect it to the affected section. Remove an image or restore
it before **Publish N changes**. Text-only publication remains valid.

Images are references in canonical sections; PNG bytes stay in
`DOCSYDE_STORAGE_DIRECTORY`. Preserve/back up this directory together with PostgreSQL:
Archive retains the original image references, not duplicate files. Missing PNGs
show a readable fallback. There is no automatic artifact deletion or remote storage
migration in this slice.

After the production build, run `npm run documentation:images:test` for real masked
Playwright capture, browser review/publish, Archive, SDK/MCP, ownership, and missing
image checks. Source/vision responses in these fixtures are mocked; no paid calls
are made. Runtime screenshots illustrate observed state, not proof of automatic
behavior or source-revision correspondence.

## Bounded documentation runs

Generation batches are sized from their actual document/section context and estimated
output cost. Every generation batch receives its own bounded support checks before
the next batch. Progress appears inline as “2 of 5 batches.” Partial proposals retain
accepted work and list coverage gaps; publication is still explicit. No automatic
resume is provided after process loss before final retention.

Defaults live in `src/integrations/ai/operation-policy.ts` (`runInferencePolicy`):
32 calls, 768 Ki conservatively reserved tokens, 128 Ki input tokens per call,
eight planned work items and forty minutes. Input charges use UTF-8 bytes as a
conservative text-token bound, add a vision allowance, and reserve full output
ceilings; they are admission estimates, not provider billing counts. Existing
32 KiB request, 128 KiB aggregate authoring and 8192 output-token ceilings remain.
Verification may pass tighter limits in code; no new environment setup is required.

## Optional managed application startup

Open **New run → Application runtime settings** for the selected project. Enter an
existing local checkout root and relative working directory, plus the path inside
DocSyde to its trusted workflow JSON. The checkout's GitHub origin must match the
selected repository. **Review configuration** reads package scripts and lockfiles,
suggests an installed npm/pnpm/yarn command and a loopback URL, and shows the script
body plus lifecycle hooks. Suggestions never execute. Review the URL and workflow,
check the local-code execution approval, then choose **Approve managed startup**.

Approvals live separately from AI understanding in ignored, private
`.artifacts/runtime-settings/` files. Settings, package scripts, lockfile or workflow
changes invalidate approval. Keep this directory when retaining local settings.
No new environment variables, database tables or migrations are needed. Existing
`DOCSYDE_RUN_RUNTIME_CONFIG` launch/attach files still work as before.

When inspection is needed, DocSyde revalidates approval, reuses the approved healthy
URL or starts only the selected package script with explicit arguments and no shell
interpolation. Install dependencies yourself first; DocSyde never runs an installer
or npx fallback. Startup/readiness is capped at 60 seconds. Existing workflow steps,
masking, checkpoint limits, cancellation, artifact storage and run budgets still apply.
The trusted workflow must match the project; the checked-in OpenTodo example is
`infra/local/runner/opentodo.example.json`. Its issue-detail selectors require the
configured issue to exist. A selector that can be absent should use an appropriate
combined selector such as `input, textarea`; masking still fails closed.

Only owned POSIX process groups are stopped, including package-manager children.
An attached healthy server is never stopped. Windows keeps attach-only inspection;
managed startup currently requires POSIX process-group support. Disable managed
startup to inspect an existing server only; if that server is absent, the run remains
source-only. Startup failures after successful cleanup also continue with explicit
source-only limitations; browser/masking/evidence or cleanup failures retain their
existing failure behavior. Startup never publishes or changes documentation.

Progress shows Starting application, Waiting for application, Inspecting application
and Stopping application. Raw stdout/stderr is discarded rather than risking secret
retention; expandable inspection details contain safe lifecycle events and exit codes.
Approved code runs with the local user's permissions, not an OS sandbox. The runner
passes only its small existing environment allowlist, without DocSyde provider keys.
