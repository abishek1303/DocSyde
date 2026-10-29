# Text model capability

`generateStructured({ instructions, input, schema, maxOutputTokens?, signal? })`
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
No provider response body, prompts, secrets, or reasoning is logged.

```sh
npm run ai:test
npm run ai:verify
```

The live CLI performs a receipt-ID extraction proof and requires model access.
There are no image inputs in this slice: visual evidence collection is independent
of future visual interpretation. No Git evidence, product analysis, documentation
generation, embeddings, agents, persistence, or orchestration is connected.
