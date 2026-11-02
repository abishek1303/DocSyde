# Scripted runtime evidence capture

## Completed workflow checkpoints

`captureRuntimeTrace(workflow, storage, signal?)` in `capture-trace.ts` runs one
caller-scripted workflow in one Chromium context, reusing final capture's action
executor and origin checks. The final-capture API below remains compatible.
It samples initial readiness, completed actions, explicit `checkpoint` steps and
final state: bounded visible text/headings/regions, overlay/control state, SDK
context, initial navigation status and sanitized error/dialog counts. Native
dialogs are dismissed without retaining their contents. Adjacent equal states
coalesce; fills never trigger screenshots. Transient states need explicit action
or readiness boundaries; there is no mutation/frame/network tracing.
The local trace also retains bounded action/boundary metadata (at most 100 scripted
steps plus initial/final events), without selectors or values. Action completion
means Playwright resolved, never proof that a product control worked. Models receive
the collapsed state projection, not this event list.

Defaults: 12 checkpoints, 32 states, 32 MiB of unique buffered PNGs, 120-second
workflow timeout. Validated `limits` ceilings are 24 checkpoints, 64 states, 64 MiB,
180 seconds; these are implementation limits. Coverage records omitted states/
checkpoints and truncated observations. Each image also has the existing 10 MiB
vision ceiling. Repeated PNG hashes share storage. Browser cleanup precedes image
storage through `ArtifactStorage`. The caller owns optional manifest storage.
Storage failures may leave orphan artifacts; no rollback/delete API is added.

Editable input/textarea/select/contenteditable values are excluded from text and
masked black in pixels. Safe labels/guidance and populated/checked/selected/expanded
booleans remain. Iframes, shadow hosts, canvas and video are masked as uninspected
content. `sensitiveSelectors` are required at every boundary: missing/invalid masks
or incomplete inspection make that checkpoint ineligible, with text/image withheld.
Screenshot failures and image-budget exhaustion have explicit limitations.

Fill/select values automatically join the private redaction list; `secrets` adds
known non-input secrets. Credential patterns are redacted and matching leaf text
is masked. Cookies, headers, request bodies, browser storage, console output and
arbitrary application state are never collected. Use controlled local data and
configured masks for sensitive non-input content, including images or text split
across elements. This does not certify arbitrary apps as secret-free or prevent an
app changing pixels between observations. Prompt-injection resistance is separate.

Optional `screenshotRegion` clips a visible region wholly inside the viewport,
retaining geometry without exposing its selector. No scrolling/replay obtains a
crop. Vision bounds refer to the analyzed image; surrounding/offscreen content is
unobserved. Invalid crops are ineligible screenshots. The returned validated trace
contains image keys/hashes, not values, selectors or executable configuration.
Run `npm run capture:test` or `npm run runtime:visual:test`.

## Final capture compatibility API

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

### Read-only observations

`runtime-observation.ts` owns strict versioned event schemas and exception-safe
synchronous callbacks. Capture emits navigation/action/state/checkpoint boundaries
from the existing Playwright execution. Preview callbacks receive copies of already
eligible masked PNGs, bounded to 2 MiB; they never invoke screenshot themselves.
No selectors, values, raw DOM/errors, headers, cookies, credentials, environment,
provider payloads or filesystem paths enter events. Pathnames reuse runtime redaction.
Canonical trace, hashes, screenshot eligibility/count and storage ordering are unchanged.
Documentation owns the bounded global registry and authorized image readers.

`runtime-observation.test.ts` uses real Chromium and graph-preserving normalization
to compare disabled, enabled, throwing, failed SQL and stalled SQL observation paths,
including canonical PNG bytes, hashes, states, coverage, model summary inputs, storage
order and session/screenshot counts. Preview mutation cannot change evidence.

The same canonical browser emits browser-launch-started/launched/stopped, sanitized
navigation, page-readiness and screenshot-stored boundaries. Screenshot references are
capture UUIDs resolved through retained manifest membership; raw storage keys/paths
never enter presentation events. A stored screenshot is not yet retained evidence.
Fixed safe failure codes identify browser launch/context, navigation/readiness, action
failure/timeout, state sampling, cleanup and artifact storage. No exception text is
retained, and original exceptions/trace behavior are preserved. Action display uses
step number and action type, not DOM text, selectors or editable values. The runtime
pane reuses existing checkpoint copies and canonical PNGs; no new screenshots or
browser sessions are introduced by observation.
