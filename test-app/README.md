# Request Desk: external product fixture

Standalone Node HTTP server and TypeScript browser app. No DocSyde imports, SDK,
database, authentication, provider credentials, or third-party runtime dependencies.
The inherited repository files are unchanged; all test-application work lives here.

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
