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
