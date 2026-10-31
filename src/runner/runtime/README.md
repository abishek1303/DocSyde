# Local runtime boundary

`launchRuntime({ cwd, command, args, baseUrl, readinessPath?, env?, startupTimeoutMs?, signal? })`
and `attachRuntime({ baseUrl, readinessPath?, startupTimeoutMs?, signal? })` return
`{ description, stop() }`. Description contains a runtime ID, mode, URL, start time,
and directly owned PID when launched. It does not claim a source revision.

Launch uses explicit executable/arguments with shell disabled, a small OS
environment plus explicit overrides, and ignored stdio. Provider credentials are
not implicitly forwarded. Use a direct executable such as `node`, not a shell
command string. Launching shell wrappers/package managers may create descendants:
this slice stops only the directly owned child; it is not a process supervisor.
The cross-platform Node strategy is tested on the current environment, not claimed
as verified on every operating system.

Readiness polls a loopback HTTP URL (same origin) until success, early exit,
cancellation, or timeout (60 seconds by default). Launch refuses an already-serving
URL. Startup failure cleans up the child. Stop is idempotent, sends termination,
then forces the directly owned child after two seconds if needed. Attach's stop is
a no-op and never kills another process. No browser, Git, model, or business logic.

```sh
npm run runner:test
npm run runner:verify -- infra/local/runner/example.json
```

The CLI verifies readiness, prints the description, and immediately cleans up.
For attach, supply JSON with only `baseUrl` and optional readiness settings. The
library session is retained by its caller until `stop()` in a `finally` block.

## Combined local capture proof

`infra/local/runner/capture-runtime.ts` exposes
`captureWithRuntime({ runtime, capture }, storage)`. Runtime is an explicit
`{ mode: "launch" | "attach", options }` union using the existing operation
options; capture uses `CaptureInput` without `baseUrl`. Supply `ArtifactStorage`
explicitly. This helper belongs to local verification, not an application workflow.

It awaits runtime readiness, calls existing browser capture once using the session's
base URL, then calls that session's `stop()` once. Evidence returns only after
capture and cleanup succeed. Attach remains non-owning. Creation/readiness failure
is left to the runtime operation without additional cleanup. A capture-only or
stop-only rejection propagates unchanged, including falsy values; simultaneous
failures produce `AggregateError` with capture first and stop second. No artifact
or manifest rollback occurs if runtime cleanup fails after capture succeeds.

```sh
npm run runner:capture:test
npm run runner:capture:verify -- path/to/runner.json path/to/capture.json
```

The combined CLI accepts the same JSON shapes as the direct verification commands.
Presence of a nonempty `command` selects launch; otherwise it attaches. The capture
JSON's `baseUrl` is ignored. It loads root `.env` and gets configured storage inside
`main()`; set `DOCSYDE_STORAGE_DIRECTORY`. Explicit process environment values take
precedence. SIGINT/SIGTERM cancellation still applies only to runtime startup;
capture retains its existing deadlines and cleanup behavior.

For `infra/local/runner/example.json`, use capture JSON `{}` (or supply only desired
capture options). The fixture serves plain `ready` text, so the browser example's
`h1` selector and heading region do not apply. The verifier prints existing
`CaptureEvidence` after cleanup. Direct runner/browser verifiers remain unchanged.
Tests use temporary manifests/storage, real Chromium and local fixture processes;
they do not load developer `.env` or contact external services.
