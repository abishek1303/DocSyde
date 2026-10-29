# Scripted runtime evidence capture

`captureRuntimeContext({ baseUrl, path?, steps?, readySelector?, regions?, viewport?, outputDirectory? })`
returns `CaptureEvidence`. Playwright is internal; no browser/page objects escape.

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

Artifacts are `.artifacts/captures/<uuid>/screenshot.png` and `evidence.json`, with
PNG content hash in the manifest. A run without a completed evidence manifest is
not a successful capture; partial artifacts may remain on write failure. Browser
resources close on success or failure. Capture failures exit nonzero through the
CLI; missing browser installation, navigation/action and output failures are not
silently converted into evidence. An absent SDK is valid; malformed metadata is
reported as a warning. `navigationStatus` refers to the initial navigation.

```sh
npx playwright install chromium
npm run capture:test
# Start the intended local app separately, then:
npm run capture:verify -- infra/local/capture/example.json
```

Tests use their own small local HTTP fixture and temporary artifacts. No runner,
Git, database or model service is needed. Real applications must provide suitable
selectors and readiness; no universal hydration or screenshot stability is claimed.
