# Text model capability

See the root [model usage audit](../../../MODEL_USAGE.md) for intended model roles,
current feature callers, provider replacement boundaries and missing orchestration.
The vision capability below is independent of the product's source-to-draft flow.

`generateStructured({ instructions, input, schema, maxOutputTokens?, inference?, signal? })`
returns `{ data, model, elapsedMs }`. `data` is inferred from the supplied Zod
schema and validated locally. Only JSON-Schema-compatible schemas are accepted.
Provider formatting and transport stay under `baseten`; public failures use
`ModelError.code` and optional `retryAfterSeconds`.

Set `BASETEN_API_KEY` in ignored `.env` or process environment. `BASETEN_MODEL`
defaults to the event's `meta-models/muse-spark-open-1026`; no fallback model is
selected. Credentials are lazy and not needed for rendering or mocked tests.
The hosted endpoint is `https://inference.baseten.co/v1/chat/completions`.

Muse Spark Open does not enforce JSON Schema: the adapter prompts for JSON,
checks completion/refusal, parses final answer text, and validates with Zod.
It never salvages JSON from reasoning or strips arbitrary prose. Validation
proves shape, not truth. Defaults: 4096 output tokens, 120-second request deadline,
no retries. Errors distinguish missing credentials, billing/auth/model failures,
rate limits, cancellation, timeouts, incomplete output, and invalid structures.
No raw provider response body, secrets or reasoning is logged. Only operation-approved
bounded sanitized snapshots described below are retained.

```sh
npm run ai:test
npm run ai:verify
```

The text live CLI performs a receipt-ID extraction proof and requires Baseten access.

## Independent screenshot vision analysis

`analyzeScreenshot({ artifactKey, context, signal? }, storage)` reads through an
explicit `ArtifactStorage` and returns `{ data: VisualEvidence, model, elapsedMs }`.
Context must be nonblank and at most 4,000 characters. PNG input is limited to
10 MiB before encoding; the complete eight-byte signature and presence of payload
are checked. This is a header/size gate, not full PNG decoding or integrity checking.
Stored bytes are encoded unchanged; there is no resizing or annotation.

`generateStructuredVision({ png, context, signal? })` is the dedicated byte-based,
provider-neutral capability. It delegates only transport to `meta/invoke-vision.ts`.
The Meta request contains context and PNG bytes, never artifact keys, local paths,
storage configuration, DOM evidence or Git state. Screenshot contents and context
are untrusted data; instructions prohibit following embedded instructions, deciding
documentation impact, generating documentation or inferring unsupported behavior.

The strict local Zod schema bounds elements to 20, observations/limitations to 10
each, descriptions to 300 characters, and visible text/statements to 500. Visible
text and bounds can be null. Bounds use finite normalized coordinates in `[0,1]`
from the top-left, with strictly increasing edges. Uncertain elements require null
bounds; clear but unlocated elements also retain null bounds and cannot supply a UI location. Empty evidence is valid. The production Meta request uses strict JSON Schema with nested `anyOf` variants to constrain certainty and bounds together. Local Zod independently rechecks that relationship and enforces edge ordering, which the provider schema cannot express. Contradictions are rejected without normalization or retry; safe diagnostics identify the invariant without retaining rejected UI values. Validation proves neither factual
accuracy nor localization quality. Results are returned only, not persisted.

Set `META_API_KEY` in ignored `.env` or process environment; it is required lazily
at invocation. The model defaults to `muse-spark-1.3`; optionally override it with
`META_VISION_MODEL`. Unset or blank overrides use the default. Neither setting is
inherited from Baseten. The fixed endpoint is `https://api.meta.ai/v1/chat/completions`, using bearer
auth, a developer message, text/image content parts and an inline PNG data URL.
See Meta's [image-input contract](https://dev.meta.ai/docs/image-understanding) and
[Chat Completions contract](https://dev.meta.ai/docs/protocols/chat-completions).
Requests are nonstreaming, capped at 4096 completion tokens and 120 seconds, with
caller cancellation, no retries and no provider fallback. Account/model access must
be verified separately; failures never route to Baseten.

Public failures use `ModelError.code`: `invalid-input`, `invalid-image`,
`image-too-large`, `artifact-not-found`, provider/configuration codes, `invalid-json`
or `schema-mismatch`. Storage failures propagate unchanged. Meta auth/access/model,
rate-limit, network, timeout/cancellation, refusal/incomplete output and invalid
envelopes remain distinct; errors contain no request data or response bodies.
Only final answer content is parsed, without salvaging JSON from prose or reasoning.

```sh
npm run ai:vision:test
# Opt-in: one model call against an existing stored PNG; quote the context.
npm run ai:vision:verify -- <artifact-key> 'Describe visible form controls and labels.'
```

The verifier loads root `.env`, uses configured storage and prints validated evidence.
Tests use in-memory storage and mocked HTTP without developer `.env` or network.
The Baseten text API/transport remains text-only. No runner, semantic change analysis,
database, UI or documentation-generation workflow is connected to vision.


## Requested inference controls and debug payloads

`generateStructured` accepts strict optional `inference` fields: `reasoningEffort`,
`temperature`, `topP`. Existing callers leave these omitted. Current hackathon `-1026`
model overrides are unconfirmed and reject before fetch; only the documented canonical
Muse slug accepts explicitly requested controls. Provider wire names stay in transports.
The operation policy supplies explicit ceilings/revisions for debug snapshots; no
provider-default values are inferred. There is no arbitrary provider-options passthrough.

The shared logger uses an explicit operation retention policy. Runtime decision, planning
and product impact retain sanitized bounded model-facing instructions/input/schema plus
schema-valid output before post-validation. Transformation retains requests/diagnostics,
not unknown entries. Visual selection now retains bounded debug snapshots and fixed
correspondence diagnostics; vision, support and receipt keep their strict projections.
No raw malformed/provider output, images, credentials, headers or reasoning are captured.
See root MODEL_USAGE.md for the operation matrix and byte budgets. Authorized invocation
details expose only validated debug representations. Logs cannot become model inputs,
evidence or authority. Historical missing content is not reconstructed.


### Compact visual selection

`visual-selection-v3` alone uses 3072 completion tokens (previously 2048). The model
returns only a strict `selected` array of exact candidate IDs, sourceRefs and nonblank
questions of at most 80 characters, with the actual configured count bound. No rationale,
decision or uncertainty fields are requested. Empty means skip. Questions and sourceRefs
continue into the unchanged vision contract; no other operation's settings change.
The small JSON body leaves headroom because Muse may spend completion budget reasoning.
The current Baseten Muse transport has no supported provider-side JSON Schema
enforcement: instructions carry the schema and JSON/Zod/correspondence checks run
locally, without retries or repairs. Selector instructions/input/schema and schema-valid
output use the existing bounded sanitized debug envelopes; fixed code/path diagnostics
survive post-validation failures. Malformed/schema-invalid raw output remains excluded.
Historical approved projections remain readable. See [MODEL_USAGE.md](../../../MODEL_USAGE.md) for exact bounds.
