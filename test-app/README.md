# Request Desk: external product fixture

Standalone Node HTTP server and TypeScript browser app. The baseline has no SDK,
database, authentication, provider credentials, or third-party runtime dependencies.
The local delivery integration below adds compiled dependency-free SDK assets;
provider and persistence operations stay in DocSyde. All host work lives here.

## Build and run

Use Node 20.9+ and the existing DocSyde installation of TypeScript and Node types.
From this branch checkout, link an existing installed checkout (replace the path):

```sh
ln -s /absolute/path/to/docsyde/node_modules test-app/node_modules
npm --prefix test-app run build
npm --prefix test-app test
npm --prefix test-app start
```

The ignored symlink is local setup, not a dependency or lockfile change. The build
emits only `test-app/dist/`. Run the app at http://127.0.0.1:45873/requests.
Port 45873 is fixed and loopback-only; an occupied port produces an explicit error
and nonzero exit. No fallback port is selected. Stop with Ctrl-C.

## Baseline behavior

- List two fixed requests; open request details from the list.
- Create a request with a required nonblank title and optional description.
- Close an open request; closed requests have no close action.
- Reset demo data to the original two requests.
- Direct navigation/refresh works at `/requests`, `/requests/new`, and
  `/requests/:id`. Unknown IDs show Request not found. Other paths return HTTP 404.
- Data lives in this tab's sessionStorage. Fresh browser contexts start identically;
  full page navigation and refresh retain session data. IDs increment deterministically.
- No priority, stricter validation, confirmation workflow, or route migration yet.

## Runner and capture

The three JSON files under `scenarios/` are inputs to existing DocSyde boundaries,
not a new framework. Run them from this branch's repository root using the existing
installed checkout's tools (or its dependencies linked as appropriate). Runner cwd
`test-app` is relative to that root. Launch executes `node dist/src/server.js` directly
and readiness uses `/health`. `runner:verify` starts then immediately stops the app;
start the server separately before using `capture:verify`, or retain a runner session
until capture completes. The list and create captures each use a fresh browser
context. Screenshots and manifests go under ignored `test-app/.artifacts/`.

## Stable Git baseline

Only establish `test-project-baseline-v1` after build, focused tests, route/refresh
checks, runner lifecycle, and both captures pass. Stage only `test-app/`, check no
other changes exist, commit, confirm clean status, then create the tag. Never amend
that commit or move its tag. Resolve its immutable SHA with:

```sh
git rev-parse test-project-baseline-v1^{commit}
```

Record the SHA externally with each evidence run; do not add a self-referential SHA
to this baseline. Future product changes are separate commits. Compare immutable
local SHAs with the existing local Git provider first; GitHub semantic/draft wiring
is separate DocSyde work. Runtime IDs and screenshots do not prove a Git revision;
record the clean checkout SHA alongside captures. No model call is needed here.


## Local contextual documentation proof

The product baseline and `test-project-baseline-v1` tag remain unchanged. This
integration adds only a host-owned help surface on existing routes, with
`/requests/new` as the static publication target. Blocks render consistently as
escaped plain text, including Markdown markers; no Markdown parser or model is used.

In the active DocSyde implementation checkout, run `npm run sdk:build`. Copy its
`.artifacts/sdk/*.js` and `.artifacts/sdk/*.d.ts` into this directory's
`.artifacts/sdk/` (create it first). These are ignored build artifacts. The host
server exposes only the two SDK ESM entries through explicit asset mappings.
Then use the existing build/test/start commands above.

Delivery defaults to `http://127.0.0.1:3000/api/documentation/context` and repository
`abishek1303/DocSyde`. Optional public local server settings are
`DOCSYDE_DELIVERY_ENDPOINT`, `DOCSYDE_REPOSITORY_OWNER`, and
`DOCSYDE_REPOSITORY_NAME`. The server embeds only these public values, never secrets.
In DocSyde `.env`, set `DOCSYDE_HOST_ORIGIN=http://127.0.0.1:45873`.

Publish an existing saved create-request document explicitly in DocSyde, then open
**Help for this page** at `/requests/new`. `/requests` and request details remain
empty unless separately explicitly published. Refresh/reopen fetches current state;
unpublish removes the association without changing the document. Context changes
clear old content and cancel pending retrieval. This remains a local-only demo,
without credentialed delivery, authentication redesign or baseline product changes.
