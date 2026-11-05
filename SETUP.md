# Local demo setup

Start with the copy/paste commands in [README.md](README.md#quick-start). `npm run db:setup` starts PostgreSQL, waits for health, and applies all checked-in migrations. It is safe to rerun; it does not seed documents or erase data. No Supabase account, cloud database, queue, or optional integration is required to start DocSyde.

## Configuration

Use Node.js **22.13 or later in the 22.x LTS line** and its bundled npm (npm 10 is sufficient). The locked lint dependency `eslint-visitor-keys` requires `^22.13.0` on Node 22, even though Next.js alone accepts older Node versions. Use `npm ci` with the checked-in `package-lock.json`; DocSyde does not require pnpm. The separate optional OpenTodo app below uses pnpm. Run all DocSyde commands from the repository root in a POSIX shell; Windows users should use WSL with Docker integration. Compose v2 must support `up --wait`.

Edit the ignored root `.env`:

| Setting | Needed for |
| --- | --- |
| `DATABASE_URL` | Persisted understanding, runs, documents, and MCP. The example matches Compose defaults. |
| `DOCSYDE_STORAGE_DIRECTORY` | Runtime images. The directory is created on first capture; keep it outside `public/`. |
| `GITHUB_TOKEN` | Reading selected repositories; use Contents: read permission. |
| `BASETEN_API_KEY` | New product understanding and change-analysis text calls (Muse Spark Open). |
| `DOCSYDE_ANALYSIS_REPOSITORIES` | Exactly one owner/repository that DocSyde may access. The example targets the demo repository. |
| `META_API_KEY` | Runtime screenshot analysis via Muse Spark and Wonder finalization. |
| `DOCSYDE_MCP_ENABLED=1` | Enables the read-only local MCP endpoint. |

Optional provider overrides are commented in `.env.example`. Defaults are Muse Spark Open `meta-models/muse-spark-open-1026` and Meta vision `muse-spark-1.3`. With `META_API_KEY` configured, Muse Wonder `muse-wonder-1.0` performs a compact editorial pass between grounded transformation and support verification. Each editorial block receives a required-detail checklist; supported behavior, conditions and instructions must survive the rewrite in product-facing language. Final grounding still rejects omissions. It does not bypass grounding or approval. Override the editorial model with `META_COMPOSITION_MODEL`. Missing credentials produce an explicit finalization-skipped limitation; provider or grounding failures block the affected guide. The editorial schema uses Meta-compatible strict `anyOf` unions. A source-citation check rejects unsupported field-trimming claims before and after editing; it supplements the final support verifier. Muse Spark Open uses schema-bearing prompts and local validation automatically; Meta vision/Wonder use structured output. Leave `BASETEN_STRUCTURED_OUTPUT_MODE=auto` (or unset); only `auto` and `prompt` are accepted.

Transformation uses per-guide allowed reference IDs and preserves unknown destinations as unresolved. Invalid references are rejected without substitution; see the [transformation contract](src/features/documentation/README.md#targeted-transformations-and-canonical-v2).

`DOCSYDE_DRAFT_SIGNING_KEY` is only needed to save previews from the standalone legacy initial-draft flow; generate one with `openssl rand -hex 32`. Incremental proposal review does not need it. `DOCSYDE_HOST_ORIGIN` permits one exact browser origin for host SDK delivery; MCP and the main UI do not need it. Reliability/inspection proof scripts manage their own isolation variables; they are not judge setup requirements.

If port 5432 is occupied, set `POSTGRES_PORT` and update `DATABASE_URL`. Compose otherwise supplies `POSTGRES_USER`, `POSTGRES_PASSWORD`, and `POSTGRES_DB` defaults. Use `docker compose --project-directory . --env-file .env -f infra/local/compose.yaml ps` to inspect health. Existing volumes retain their original credentials; changing `.env` does not change database users. Avoid conflicting `.env.local` overrides: Next.js reads those, while CLI scripts read `.env`.

## Troubleshooting

Restart DocSyde after editing `.env`. Do not paste keys into a terminal command,
issue, screenshot or log. Next.js also reads `.env.local` and process variables;
CLI scripts read `.env` without overriding existing process variables. Remove
unintended overrides if the CLI and UI behave differently. Never source `.env`
as a shell script. Copy `.env.example` only on first setup; do not overwrite an
existing configuration.

These diagnostics are read-only and run from the repository root:

```sh
node --version
npm --version
docker info
docker compose version
docker compose --project-directory . --env-file .env -f infra/local/compose.yaml ps
docker compose --project-directory . --env-file .env -f infra/local/compose.yaml logs --tail=50 postgres
```

| Symptom | Likely cause | Recovery |
| --- | --- | --- |
| `EBADENGINE`, unsupported Node, or `npm ci` fails | Old Node, unavailable registry, or an incomplete dependency install | Use Node 22.13+ in the 22.x line, confirm `node --version`, then rerun `npm ci` from the root with registry access. Preserve the lockfile. |
| `docker` missing, cannot connect to daemon, or unsupported `--wait` | Docker Desktop is absent/stopped or Compose is too old | Install/start Docker Desktop with Compose v2 supporting `up --wait`, wait for `docker info` to succeed, then rerun `npm run db:setup`. On WSL, enable Docker Desktop integration for the distribution. |
| PostgreSQL unhealthy or setup times out | Container startup failure or database port conflict | Inspect the `ps` and PostgreSQL logs above. Resolve the reported error and rerun `npm run db:setup`; do not delete the volume. For occupied 5432, set `POSTGRES_PORT=5433` and `DATABASE_URL=postgresql://docsyde:docsyde_local@127.0.0.1:5433/docsyde` in `.env` before rerunning setup. |
| `DATABASE_URL is required`, connection refused, or password authentication fails | Missing URL, stopped database, wrong host/port, or credentials differ from the existing volume | Set `DATABASE_URL` to the actual database, use `127.0.0.1` for the supplied local Compose service, check health, and restart DocSyde. Existing volumes keep their original user/password/database: restore matching configuration or ask the database owner for access; changing `.env` does not reset them. |
| Missing relation/schema or a database-schema run failure | Migrations did not complete or the URL points to a different database | Confirm `.env` points to the intended local database. Run `npm run db:migrate` and restart DocSyde; `npm run db:setup` also starts the local service and applies migrations. Use checked-in migrations, not `db:generate`, for initial setup. Never reset migration history to fix this. |
| Application port 3000 is occupied | Another process owns the port | Use `npm run dev -- --hostname 127.0.0.1 --port 3001` and open `http://127.0.0.1:3001`. Update MCP client URLs/`DOCSYDE_MCP_URL` to that port. For production preview use `npm start -- --hostname 127.0.0.1 --port 3001`. |
| Repository restriction alert or “exactly one owner/repository” | Empty, invalid, or multiple distinct repository entries | Set `DOCSYDE_ANALYSIS_REPOSITORIES` to one `owner/repository` (no URL or branch suffix), then restart. The public demo example is usable as the target; there is no flag to disable the safeguard. |
| Missing GitHub credentials, denied access, or repository not found | Blank/expired token, wrong repository, or missing token/organization permissions | Set a valid `GITHUB_TOKEN`; grant fine-grained **Contents: read** access to that exact repository (including private repositories if used). Complete organization approval/SSO authorization when required. Match the configured repository and restart. DocSyde's safeguard does not reduce the token's own grants. |
| Source comparison unavailable | Branch lacks a parent commit, refs are inaccessible, or comparison is too large/diverged | For a fresh project use **Full Scan**, which needs no diff or previous docs. For Latest Changes choose a branch with at least two accessible commits; inspect the displayed comparison and source failure details. The adapter rejects diverged histories and potentially truncated comparisons rather than guessing evidence. |
| Model credentials/access/billing/model-unavailable failure | Missing/wrong provider key, account access, credit, or invalid model override | Set `BASETEN_API_KEY` for text; `META_API_KEY` is a separate Meta Model API key for vision/Wonder. Remove unintended model overrides to restore the defaults in `.env.example`, confirm account access/credit with the provider, and restart. Missing Meta credentials permit source-only work with explicit limitations; invalid configured Meta credentials can fail attempted stages. Retrying generation can spend credit. |
| Runtime skipped as browser unavailable, or Chromium executable/shared libraries missing | Optional Playwright browser or OS dependencies are absent | After `npm ci`, run `npx playwright install chromium`. On supported Linux/WSL, use `npx playwright install --with-deps chromium` to install required system packages (may require administrator access). Restart DocSyde. Source-only scans do not need Chromium. |
| Runtime skipped/unavailable or inspection fails | No matching trusted workflow, stopped host app, missing issue/selectors, invalid approval, or unwritable storage | Follow the optional runtime setup below; check its repository, loopback port, installed app dependencies and expected issue. Reapprove managed settings after changing the manifest/workflow. Ensure `DOCSYDE_STORAGE_DIRECTORY` is writable. For source-only operation, unset `DOCSYDE_RUN_RUNTIME_CONFIG` and disable any managed runtime setting. |
| MCP unavailable/503, HTTP 403, or opening `/api/mcp` shows 405 | Endpoint disabled, rejected Host/Origin, wrong port, or browser GET instead of MCP POST | Set `DOCSYDE_MCP_ENABLED=1`, restart, and use a Streamable HTTP MCP client at the app's `/api/mcp` URL. Test with `npm run mcp:query -- get_product_context "priority"`. GET/405 alone is expected. For 403 use loopback locally; external ngrok requires the documented Host rewrite, and foreign Origin headers remain rejected. Check that the tunnel is running and the client uses its current HTTPS URL plus `/api/mcp`. |
| No product understanding, empty documents, or MCP `no-live-documentation` | Fresh databases have no seeded state; proposals/saved drafts are not live | Optionally use **Product understanding → Analyze repository**. Run **Full Scan**, resolve supported documentation destinations, review Pending Changes and explicitly publish selected changes. Understanding alone does not publish docs. Unknown route/search results can be empty even when other routes are published. |
| Run is slow, incomplete, failed, interrupted, or another run is blocked | Bounded provider calls, grounding/coverage rejection, pending review, or lost application process | Keep one DocSyde process running; inspect the run's stopped stage, outcome and **AI activity / Logs**. Use **Cancel** to stop an active run. Resolve provider/configuration errors before another paid attempt; narrow the comparison if budget/coverage limits recur. Runs have a 40-minute deadline and bounded recovery, not guaranteed success or automatic resume. After process loss, reopening does not resume inference; start a new run once stale ownership is reconciled (normally after the 60-second stale threshold). Publish or explicitly discard actionable pending changes before another scan. No-change or unsupported output may correctly produce no reviewable proposal. |
| Build/dev reports a Google Fonts download error | First compilation cannot reach Google Fonts | Allow DNS and HTTPS access to `fonts.googleapis.com` and `fonts.gstatic.com`, then rerun the failed command. A dependency install alone does not cache fonts; there is no bundled offline-font fallback. |

## Separate demo application (OpenTodo)

In another terminal, outside the DocSyde directory:

```sh
git clone https://github.com/abishek1303/DockSyde-demo-app-test-subject.git
cd DockSyde-demo-app-test-subject
npx --yes pnpm@10 install --frozen-lockfile
npx --yes pnpm@10 run dev
```

Open **http://localhost:5173/?agent**. The app runs its local API on port **8787** and initializes local SQLite through Wrangler; no Cloudflare account is required. Keep both ports free. Create an issue through the app if the list is empty. The provided runtime example expects **TASK-1**; choose that issue and set its status to **Blocked** when demonstrating Blocked guidance. This is controlled local application data, not inferred behavior.

To enable real runtime inspection in DocSyde, uncomment:

```dotenv
DOCSYDE_RUN_RUNTIME_CONFIG=infra/local/runner/opentodo.example.json
```

Also configure `META_API_KEY`, install Chromium, start OpenTodo, and restart DocSyde. The trusted example attaches to the existing process and inspects TASK-1; it never starts or stops the external app. If your issue identifier or port differs, create an ignored local copy with `mkdir -p .artifacts` then `cp infra/local/runner/opentodo.example.json .artifacts/opentodo.local.json`, adjust its selectors/URL, and set `DOCSYDE_RUN_RUNTIME_CONFIG=.artifacts/opentodo.local.json`. Vision uses strict certainty/bounds variants and independent local validation; uncertain or unlocated elements retain no UI coordinates. Invalid spatial evidence is rejected without repair or semantic retry. Runtime coverage is explicit and bounded; no autonomous browser exploration is enabled. Missing runtime configuration allows source-only analysis with explicit limitations.

Controlled source comparison:

```text
Base 52995911826a07247049aa9a914627ff3e9b9e50
Head c120171beb7ebf280b9eab877277f0f1f08d1517
```

These are historical comparison references, not the current branch tip. The New Run UI selects a branch: Latest Changes compares its latest commit with its parent, and Full Scan pins its current head. For the historical Blocked-guidance UI, stop OpenTodo, run `git checkout c120171beb7ebf280b9eab877277f0f1f08d1517` in its checkout, then repeat its install/start commands above. To return to the default current-branch demo, stop it and use `git checkout main` before reinstalling/restarting. A historical runtime checkout does not prove that the current GitHub branch has the same revision.

## First understanding and documentation

Choose **New run → Full Scan** to generate initial documentation or regenerate existing documentation without a new commit or diff. Select a branch and optional product context. Full Scan discovers supported application screens automatically; ambiguous destinations can be confirmed after generation. The scan pins one current SHA, samples up to 16 files (2000 characters per file) across discovered repository areas, and prepares at most four source findings. Unsampled files and remaining file contents are explicit coverage gaps; this is not exhaustive repository analysis.

Full Scan plans and writes fresh guides without loading previous documentation. After
support checks, verified routes are matched to current publications or saved targets for
explicit reviewable replacements. Source-supported additions use the existing canonical
document proposal flow. Verified file-based pages, static client routes, and mounted
single-page entry screens provide destinations without manual path entry. The existing planner
associates claims/workflows; bounded source reachability validates automatic screen correspondence.
When ambiguous, open **Documentation destinations** on the run and choose a discovered screen.
Confirmation records destination metadata only; publication remains explicit. Backend-only projects
or unsupported routing patterns can remain incomplete rather than inventing a route. Occupied
routes require observed-target replacement checks, and dynamic route templates are not publishable. Support-checked
work is retained for audit, but only publishable changes appear in Pending Changes and enable
the run’s Review changes action. Nothing is published until you explicitly publish the batch.

Full Scan reuses saved repository understanding as advisory context, then the existing runtime, planning, transformation, support checking and proposal-retention pipeline. **Product understanding** shows the saved analysis by default. **Rescan repository** opens a dedicated branch → context → review screen; cancel returns to the saved understanding; an empty project offers **Analyze repository**. Opening or cancelling setup does not invoke inference; only the final submit starts analysis. Provider credentials are needed to execute new generation, not to render setup.

A fresh database correctly disables **Latest Changes** until an eligible canonical document has been saved. Unsaved generated proposals do not qualify. Latest Changes targets active published documentation only; archived versions and unpublished saved drafts are excluded from its candidate selection. MCP also exposes only active publications.

Each project follows **Analyze → Review changes → Publish or Discard → Analyze again**. Actionable pending changes disable both Full Scan and Latest Changes, with a direct **Review pending changes** link. Server-side creation and execution recheck this rule. **Discard pending changes** requires confirmation, records exclusions and leaves live documentation unchanged. Published, rejected, excluded, expired and unavailable proposals do not block another run; other projects are independent.

When a pending batch needs replacing, **Start fresh Full Scan** offers a secondary
confirmed recovery path. It discards only the displayed project batch using the existing
hash-checked, project-locked exclusion receipts, then opens Full Scan setup. Published
docs and archives are preserved. Choose the branch/context and submit **Generate
documentation** there to pin the current revision. Setup does not reserve a run: if another
batch appears meanwhile, the normal admission checks block it until resolved.

Source citations are reconstructed from pinned references with a 2,000-character
excerpt limit. Size-only omissions retain independent valid findings with explicit
coverage gaps when the existing uncertainty bound permits. The configured aggregate evidence request budget is 100 KiB; model/run token budgets
remain unchanged.

Full Scan generates fresh documentation solely from current source/runtime evidence;
previous documents never enter its planning or writing context. After support checks,
selected screen routes match current publication IDs for reviewable replacements.
Latest Changes remains incremental and documentation-aware.

Full Scan and Latest Changes retain per-guide grounding verdicts. Valid, authorized proposals may be **ready**, **review with warnings** (semantic omissions, ambiguity or terminology), or **blocked** (including invented behavior, incorrect values/instructions, critical omissions or invalid verification). Warnings remain uncertain, cite their fact IDs in review, and require explicit acknowledgment before approval/publication. One blocked guide does not discard independent successful guides; same-route consolidation preserves guide-level verdicts and evidence. Human review and publication conflict checks remain mandatory. The verifier receives the authorized facts’ existing source citations to assess high-impact assertions; summaries are fallible and missing source context must stay uncertain. No extra verification model calls or configuration are required.

Full Scan only creates reviewable proposals: it never deletes or replaces published documentation automatically. Accepted output exposes **Review changes** directly in Pending Changes and highlights its document groups. Unsupported output explains the stopped stage and recovery action; technical details and **AI activity / Logs** retain diagnostics. The legacy standalone draft flow remains available at `/sources/analysis`; see the [documentation guide](src/features/documentation/README.md).

Then choose **Latest Changes**, select a branch, review its latest comparison, and optionally add change context. Successful proposals lead to **Documents → Pending Changes**. Read the combined rendered preview, **Reject** unwanted edits (or **Undo**), then explicitly **Publish N changes**. This single action atomically records approval/rejection, saves the included canonical documents, and publishes to retained product destinations. Overlapping updates, expired proposals, stale snapshots, and destination conflicts are blocked. Publishing also finalizes excluded edits, including wholly excluded previously approved proposals, so they leave Pending Changes on refresh. Exclusion receipts preserve the earlier immutable approvals. Future proposals remain independent. Standalone saved documents remain available through **Browse saved documents**; legacy individual review remains accessible from optional evidence details. Latest Docs and MCP reflect the new live version; Archive keeps previous live versions. Historical reference runs and publications are local database state and are not bundled in a fresh clone.

## MCP: the same knowledge for agents

DocSyde acts as a synchronized product-context layer for both humans and AI agents. With MCP enabled, the ordinary local app serves **http://127.0.0.1:3000/api/mcp**. No separate server or model inference is required. Open **MCP** for server status, the connection URL, copyable HTTP client configuration, and an ngrok command. Editing the URL updates the generated configuration; no tunnel is started from the UI.

```sh
npm run mcp:query -- get_product_context abishek1303/DockSyde-demo-app-test-subject
npm run mcp:query -- get_documentation abishek1303/DockSyde-demo-app-test-subject /
npm run mcp:query -- get_context_for_surface abishek1303/DockSyde-demo-app-test-subject /
```

MCP tools always use the single configured project; ChatGPT does not need its name or ID. Call `get_product_context` with `{}` for an overview, or pass `query` (for example, `{"query":"How do I change an issue's priority?"}`) to search published documentation. Documentation tools accept an optional exact `route` as well. No matching publication returns `not-found`; a project with no publications returns `no-live-documentation`. Legacy `repository` arguments are search text, never project selectors. The CLI still requires that positional argument: use a search phrase such as `"priority"` for a focused product-context query; the repository-name examples above are legacy search inputs, not project selection. MCP searches published text independently of historical evidence links. Larger guides return bounded excerpts with an explicit truncation limitation. Queries prioritize matching sections and text blocks within the existing limits; overview and route-only requests retain document order. Stored publications are unchanged.

For exact-route CLI retrieval, use an exact **published route**; `/` above is an example, not an automatic association. Unknown routes return a clean empty result. Override the CLI endpoint with `--url http://127.0.0.1:3000/api/mcp` or optional `DOCSYDE_MCP_URL`. Tools are read-only: no repository writes, approvals, or publication. Current published documentation is authoritative; saved repository understanding is labeled advisory, and pending wording is excluded. Bind to loopback—there is no public authentication layer. Local clients need no ngrok. For an external client that cannot reach loopback, the MCP page supplies `ngrok http 3000 --host-header='127.0.0.1:3000'`; use the tunnel HTTPS URL plus `/api/mcp`. Host rewriting is required by the local Host check; clients sending a foreign Origin remain rejected. The tunnel exposes an unauthenticated endpoint and should exist only for the controlled demo session, then be stopped.

## Verification and production preview

```sh
npm run ai:test
npm run ai:vision:test
npm run github:test
npm run mcp:test
npm run lint
npx next typegen
npx tsc --noEmit
npm run build -- --webpack
npm start -- --hostname 127.0.0.1
```

Build requires Google Fonts access. After building, optional browser/lifecycle checks use migrated PostgreSQL and Chromium:

```sh
npm run documentation:pending:test
npm run documentation:ux:test
npm run mcp:integration:test
```

These tests are intended to create and clean their own repositories/documents and clear AI credentials in the test server. Some older integration fixtures still configure multiple repositories and conflict with the current mandatory single-repository safeguard; `mcp:integration:test` needs fixture updates before it can pass. They are not required for reviewer setup. Scripts named `*:verify` may spend credits or retain artifacts; read the relevant integration guide before running them. Keep screenshots, storage, and compiled SDK output under ignored `.artifacts/`.

Stop local infrastructure with `docker compose --project-directory . --env-file .env -f infra/local/compose.yaml down`. Do not add `-v` unless you intend to delete all local database data. For deeper implementation details, use [ARCHITECTURE.md](ARCHITECTURE.md), [MODEL_USAGE.md](MODEL_USAGE.md), and the linked feature/integration guides.

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

Pinned screen discovery also supplies inspection candidates for SPA entry screens and
file-based routes. Empty optional capabilities do not prevent source-backed selection;
the selected path must still be covered by the approved workflow. Discovery never
adds commands, browser steps, or operator capabilities.

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

Full Scan retains up to 12 screen candidates from its existing 16-file source budget.
Route proofs retain the pinned revision and exact routing/entry source locations. Existing
runtime navigation can supply confirmation-only candidates; it does not prove revision identity.
The installed TypeScript compiler is also a runtime dependency for deterministic source parsing;
no additional provider call or indexing service is used. Historical discovery hints never expand
an existing published document's delivery routes automatically.

Run setup and Understand product use three steps: select a branch, add optional context, then review and start. Run activity stays in a scrollable desktop panel; stages expand as work progresses, and can also be opened manually. Usage totals use the existing invocation logs.

Documentation navigation includes page-title search. Archive first lists publication versions, then opens the pages live at the selected timestamp using existing publication history (read-only; no migration). The right run column displays all summary and resource content. The desktop activity panel matches that column’s height and scrolls internally. Review changes remains visible and is disabled when no actionable proposal remains.

Running activity titles use a reduced-motion-aware GSAP word wave. Each stage transition returns expansion to the current step and reveals it inside the timeline. Scroll the run page to move its title and revision details out of view; activity and resources retain their own scrolling.

Pending Changes uses fixed-height page cards with title, approved routes, and New/Update status. New pages have one preview; updates compare the saved original with the proposed result. Conflicts offer one version per proposal (or per competing edit where a proposal overlaps itself); choosing a version excludes the alternatives through the existing preview action. Preview panes and the page list scroll independently. Warning acknowledgment and publication checks remain required.

Page navigation uses a shared GSAP fade, with staggered MCP card reveals. Suspense loading states share the animated book SVG. Both respect reduced-motion preferences; navigation adds no artificial delay and preserves page/form state.

The single-repository safeguard is always enabled; no mode flag is needed. Configure exactly one distinct `owner/repository` in `DOCSYDE_ANALYSIS_REPOSITORIES`. Keep `GITHUB_TOKEN` server-side. Run setup verifies GitHub access; the shared client validates the target and blocks REST/GraphQL requests outside it, including CLI calls. An empty, invalid, or multiple-repository configuration fails closed. The setup note asks users to restrict their token manually: this safeguard limits DocSyde, not the token’s full GitHub grants. `npm run github:test` includes mocked safeguard tests and makes no live GitHub/model calls.

An invalid repository configuration renders only the demo restriction alert, without application navigation or links to prefetch. Configuration checks happen locally before GitHub client creation; no GitHub request is made for an empty, invalid, or multiple-repository configuration.

Full Scan and Latest Changes setup show only the page title and the three-step form; repository context is retained in the final review step.

Skipped runtime inspection distinguishes a missing package-manager executable from missing project dependencies, startup failure, and readiness timeout. The run step shows an actionable explanation and retains startup event details; documentation continues source-only. Only an allowlisted package-manager name is stored for this diagnostic, without paths, commands, environment values, or raw output. Older ambiguous startup records remain ambiguous. Pending page cards display their total and included change counts. Documentation screenshots open in a dismissible preview dialog.

The new-run options screen shows its title and the Full Scan / Latest Changes cards, without a project picker, breadcrumb, or introductory notices. Existing pending-review and eligibility checks still apply.

The run timeline shows an immediate Starting indicator while execution is being admitted, without changing saved stage status. Activity has a 38rem minimum desktop height and can extend the page; the resource column remains uncapped. Automatic stage reveals preserve the active step heading instead of following the bottom of a tall screenshot.

Run Artifacts lists retained checkpoint screenshots from the existing inspection endpoint, including selected status. Thumbnails open the shared image preview overlay; no additional capture or inference is performed.

A loopback-bound server may not be reachable through Docker Desktop’s host gateway; verify connectivity before using this optional setup. For LibreChat running in Docker on the same Mac, set `DOCSYDE_MCP_DOCKER_HOST=host.docker.internal:3000` in `.env` and use `http://host.docker.internal:3000/api/mcp` in LibreChat. This opts that exact Host into the read-only endpoint; foreign browser Origins remain blocked. Only use this on a trusted local machine/network: the endpoint has no authentication.

Source-coverage bookkeeping is nonblocking and retained as a diagnostic. Full Scan preserves cited current behavior independently of screenshots; valid unresolved planning receives one corrective attempt, then source-grounded draft targets only where verified route evidence matches. Existing transformation, evidence, and human publication checks still apply. Latest Changes planning is unchanged. See the [coverage contract](src/features/sources/impact/README.md#source-coverage).

Full Scan discards individually invalid synthesis claims while retaining valid source-grounded claims and safe rejection diagnostics. If no claims survive, it finishes incomplete at impact synthesis before planning. Contradiction/schema checks and publication approval stay strict; Latest Changes is unchanged.


### Compact product-impact synthesis

Product-impact-v3 returns short judgments and evidence refs, with exact source-ID
lookups for before/after text. Canonical results and provenance stay compatible.
Muse Spark Open uses prompt-schema mode because Baseten does not enforce JSON Schema
for this model; no configuration change or dependency is needed. Initial output remains 8192
tokens with existing reasoning/sampling defaults; genuine token truncation can use bounded recovery.
Counts-only whitespace diagnostics help distinguish padding from generated content.
See [boundary policy](src/integrations/ai/structured-output-boundary.md).


### Bounded model-output recovery

Model outputs vary; bounded recovery cannot guarantee every run succeeds. Each
failed operation permits at most three attempts for recoverable JSON formatting,
allowlisted descriptive-prose overflow or provider-confirmed token truncation.
Only redundant spaces in harmless prose can normalize without another call.
Inspection reasons allow 180 characters (80 remains the prompt target).
Only `length` completions increase tokens: 1.5x per retry up to twice the initial
operation policy ceiling, capped at 16,384. All attempts consume existing shared
call/token/time budgets. Cancellation, frozen experiment scopes and failed logging
can stop recovery sooner. Invocation diagnostics show retries and sanitized
reasons. Documentation content, evidence, IDs, routes, citations and code are never
shortened; grounding, contradiction and publication validation remain strict.
No new provider, dependency, configuration or migration is required.
See the [boundary policy](src/integrations/ai/structured-output-boundary.md).

### Hackathon demo reliability mode

Set `DEMO_RELIABILITY_MODE=true` in the ignored `.env` and restart DocSyde. The
example defaults to `false`; absent/false keeps the normal policy. This mode spends
more on inference and may take longer. It improves bounded recovery, not truth or
guaranteed success. It never publishes automatically.

| Limit | Normal | Demo |
| --- | --- | --- |
| Total attempts per model operation | 3 | 5, including at most 2 semantic corrections |
| Known Baseten Muse Spark Open initial / output ceiling | Operation-specific / up to 16,384 | 16,384 / 32,768 |
| Known Meta Wonder/Spark initial / output ceiling | 4,096 / 8,192 | 8,192 / 16,384 |
| Run calls / conservatively reserved token allowance | 32 / 786,432 | 96 / 8,388,608 |
| Input reservation ceiling per call | 128 Ki tokens | 512 Ki tokens |
| Workflow deadline | 40 minutes | 40 minutes |
| Source analysis deadline, including source reads | 3 minutes | 10 minutes, also bounded by workflow cancellation |
| Serialized product evidence / patch selection | 100 / 64 KiB | 256 / 192 KiB |
| Individual patch / sampled current-file prefix | 12 KiB / 2,000 characters | 32 KiB / 8,000 characters |
| Operator-selected inspection context | 16 KiB | 64 KiB; still at most 3 explicitly selected files |
| Runtime selection / documentation planning request | 32 / 32 KiB | 96 / 64 KiB |
| Runtime state text / region text projection | 2,000 / 500 characters | 4,000 / 1,000 characters |

Output grows by 1.5x only after a provider-confirmed `length` completion, stopping
at the application ceilings above. These are conservative allowances within the
[Baseten model limits](https://docs.baseten.co/inference/model-apis/overview) and
[Meta model context windows](https://dev.meta.ai/docs/models), not claims of their
maximum output capacity. Account/deployment limits can still reject a request.
Unknown model overrides receive no larger initial budget. Baseten's existing
`-1026` alias uses the configured Muse Spark Open allowance. Model, reasoning,
sampling, privacy/redaction, screenshot count, deterministic file selection and
canonical output schemas stay unchanged. Larger context is not unrestricted
repository access; hard guards still reject oversized evidence.

Logged, allowlisted correspondence failures can correct an invalid supplied
reference/range, a claim/fact mapping, a missing coverage ledger or an omitted
supported transformation entry. Only the failing generation operation retries,
using the same pinned evidence and original schema; validated upstream artifacts
and the final proposal-retention step are not replayed. Generation preflight has
no document/proposal side effects, and repaired results pass the original feature
validators again. Two semantic corrections share the five-call allowance with
format/truncation retries. Logs retain attempt/retry counts, rejection codes and
provider token usage; feedback contains approved codes/paths only, not rejected
content. Frozen verification scopes and smaller caller budgets still stop early.

Nonretryable: insufficient support, source/visual contradictions, authorization or
route/target violations, unrecognized semantic errors, invalid spatial evidence,
publication failures, refusals, HTTP/auth/billing/rate-limit errors, timeouts,
cancellation, exhausted budgets and failed logging. Transformation support and
editorial-content rejections remain blocking; demo mode cannot turn an unsupported
verdict into evidence or skip human review. Existing Full Scan source normalization
and deterministic fallback behavior are unchanged; demo preflight requires fresh
plans to include supported draft targets rather than stacking another generation
loop on the five-attempt allowance.


### Latest Changes candidate narrowing

Latest Changes ranks validated existing sections using cited source paths, existing
feature/route associations, matching before-value wording and captured runtime routes.
Oversized broad matches narrow deterministically while retaining distinct supported
targets. The planner still receives at most 10 documents/40 matching sections, with
complete outlines of retained documents. Ranking is retrieval guidance, not evidence
that an update is supported or approved; no associations are invented.

Retrieval is bounded at 200 section hits, 64 documents and 2 MiB of canonical snapshots.
A sentinel prevents silently ignoring an unexamined tail. Truly ambiguous sets stay
incomplete: existing failure details distinguish supported-target overflow,
indistinguishable matches and retrieval-resource limits with sanitized counts.
Full Scan does not query documentation history. Saving/publication safeguards and
human review remain unchanged; no migration or new configuration is required.


## Pre-review verification (November 4, 2026)

All 26 tracked Markdown files were audited, excluding dependencies and generated
output. Relative file links, heading links and referenced npm script names were checked.
No Markdown files were removed. Historical architecture increments, model receipts,
runtime investigations, exact review diffs, the participant guide and the Request Desk
experiment harness are preserved and labeled; local historical artifacts are not
included in a fresh clone.

Lint, Next.js route type generation, TypeScript and the production Webpack build
passed against installed dependencies (Node 22.12.0, npm 10.9.0). Compose configuration
validation and setup-shell syntax checks passed; no services were started. AI/vision
and GitHub mocked tests, local Git, SDK,
storage and MCP unit suites passed. `sources:understanding:test`, `sources:test`
and `documentation:test` have existing fixture failures involving the mandatory
single-repository configuration; documentation tests also expose browser-rendering
(`document is not defined`), authorization-message and missing-storage fixture failures. These were
not addressed by this documentation/configuration pass. Do not interpret the older
verification receipts in technical guides as results for the current tree.

In the first pass, a fresh `npm ci`, new database initialization/migrations,
database/browser integration suites, external demo checkout, live GitHub/provider
access and remote MCP/ngrok connectivity were not exercised. No paid inference, connected-data writes, publication,
commit or push was performed. Follow Quick Start to configure your own local state.


Follow-up reviewer audit: an isolated snapshot of tracked source files (no developer
`.env`, artifacts or `node_modules`) installed 734 packages with
`npm ci --offline --ignore-scripts --no-audit --no-fund` using the existing local npm
cache. This verifies lockfile installation with scripts disabled, not an uncached
registry download or a complete default `npm ci`. Node 22.12.0 emitted the expected
lint-dependency engine warning; use the documented Node 22.13+ requirement.
Route type generation, TypeScript, lint, mocked AI (166 tests) and MCP (11 tests)
passed in that snapshot with provider keys and database access disabled.
The isolated Webpack build failed on DNS resolution for `fonts.googleapis.com`:
unlike the earlier workspace build, it had no font cache. Fresh startup therefore
still requires Google Fonts network access. New PostgreSQL/migrations, browser
startup, paid workflows and remote MCP remain unverified.

The root `LICENSE` contains Apache 2.0 terms, appendix and copyright notice and was
left unchanged; README now links to it. A tracked-file scan found no recognized
credential tokens, real user-home paths or generated dependency/build/artifact
files. The only `/Users/...` strings found are intentional synthetic redaction-test
fixtures. `.env` and `.artifacts/` are ignored; Compose configuration and versioned
SQL migrations are intentionally tracked. This scan is not a credential-history audit.

Final polish verified both historical OpenTodo commits exist in the public sample,
the base is an ancestor of the head, and its pinned package/Vite/Wrangler files
support the documented local setup (UI default 5173, API 8787). The sample was
read into a temporary bare clone; dependencies, app startup and SQLite were not run.
