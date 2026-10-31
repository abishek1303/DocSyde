# Scripted runtime evidence capture

`captureRuntimeContext({ baseUrl, path?, steps?, readySelector?, regions?, viewport?, outputDirectory? }, storage)`
returns `CaptureEvidence`. Pass an `ArtifactStorage` explicitly; capture depends only
on that interface. Playwright is internal; no browser/page objects escape.

Steps are validated click, fill, select, check, or waitFor actions using explicit
selectors. They are caller instructions, not model decisions. No arbitrary
JavaScript action exists. The target and all browser navigations must remain on
the supplied loopback HTTP origin. Each invocation uses a fresh Chromium context.

The PNG is visual evidence. Headings, visible body text, named region text/bounds,
URL/title, navigation status, and validated optional SDK context are runtime/DOM
evidence, not visual understanding. No OCR, screenshot interpretation, change
scoring, source inference, model invocation, or app startup occurs.

Defaults: 1440x900, device scale 1, reduced motion, disabled screenshot animations,
30-second action/navigation deadlines, DOM-content readiness plus an optional
visible selector. Region text is capped at 10,000 characters, page text at 50,000,
and headings at 100 (1,000 characters each); truncation is explicit. Browser script
errors are counted through sanitized bounded diagnostics (100 entries). Form
values, cookies, request bodies and raw browser error messages are not collected.

The PNG is captured once in memory, hashed and passed directly to storage after
browser cleanup succeeds. `screenshot` contains only `artifactKey`, `mimeType` and
`sha256`; retrieve the bytes through `storage.read(artifactKey)`. No screenshot file
is written by capture. DOM/runtime evidence stays in the returned object and
`.artifacts/captures/<captureId>/evidence.json`. `outputDirectory` controls only the
manifest root and resolves against the working directory before browser launch.

Browser resources close on success or failure. Capture or cleanup failure prevents
storage; storage failure propagates unchanged and prevents manifest directory creation.
The manifest is written exclusively after storage, and its completion is required
for success. A manifest failure rejects and may leave an orphaned stored artifact;
no rollback is attempted. `capturedAt` records capture completion before cleanup,
storage and manifest writing. An absent SDK is valid; malformed metadata is reported
as a warning. `navigationStatus` refers to the initial navigation.

```sh
npx playwright install chromium
npm run capture:test
# Set DOCSYDE_STORAGE_DIRECTORY in .env; start the intended local app separately:
npm run capture:verify -- infra/local/capture/example.json
```

The CLI loads root `.env` (existing process values take precedence) and obtains
configured storage with `getArtifactStorage()`; failures exit nonzero. There is no
browser-specific storage configuration.

Tests use their own local HTTP fixture, in-memory storage and temporary manifests. No runner,
Git, database or model service is needed. Real applications must provide suitable
selectors and readiness; no universal hydration or screenshot stability is claimed.
