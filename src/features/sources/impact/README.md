# Product-impact synthesis contract

`synthesizeProductImpact` in `synthesize-product-impact.ts` composes validated static
analysis, optional validated runtime observations and inspection coverage. The model
input supplies pinned source identity, source findings with IDs/allowed claim kinds
and evidence excerpts, coverage/revision limitations, capture metadata/vision outputs,
and visual reference IDs. ArtifactStorage keys are excluded. The complete request
(instructions/input/schema/token budget) is capped at 64 KiB before inference.

The strict model root is exactly:

```text
assessment: product-change | internal-only | insufficient-evidence
summary: nonblank semantic summary <=500 characters
sourceCoverage: <=4 entries accounting for every supplied source finding
claims: <=6 strict semantic claim objects
contradictions: <=4 strict unresolved-contradiction objects
uncertainties: <=6 nonblank strings <=300 characters (<=5 with runtime)
```

Claims have description, kind, confidence, confidenceReason, before, after,
uncertainties and references. Contradictions have description, status and references.
See `product-impact.ts` for exact nested bounds. Summary is used by documentation
planning, the proposal page and library titles; it is not redundant repository data.
No output field is removed. Provenance is already attached by DocSyde after schema
and semantic validation, along with a server-owned revision warning when visuals
support claims. No model echo of canonical evidence/metadata is needed.

The full current instructions are the `instructions` template in
`synthesize-product-impact.ts`. The root clarification forbids wrappers, repeated
input/source/runtime/provenance, extra title/rationale/analysis metadata, markdown,
and schema definitions. The semantic task and all evidence restrictions are unchanged.

## Structured generation and grounding

`generateStructured` converts the Zod output schema using `z.toJSONSchema` (including
`additionalProperties: false` for strict root/nested objects), appends it to system
instructions, and calls the existing Baseten Chat Completions adapter. Configuration:
`postValidation: true`, operation `product-impact`, maxOutputTokens 8192, stream false,
existing Muse Spark Open -1026 model; reasoning/sampling options remain omitted.
The adapter sends schema-bearing messages, not a `response_format` parameter. This
is the same path used by source analysis, runtime decision and visual selection.
There is no operation-specific dispatch inconsistency.

[Baseten's structured-output documentation](https://docs.baseten.co/inference/structured-outputs)
explicitly says Muse Spark Open accepts json_schema but does not enforce it (checked
November 1, 2026). Thus provider-side enforcement is not active here; schema adherence
relies on instructions plus strict local JSON/Zod validation. No provider behavior,
model, response format or retry policy is changed by this hardening.

After schema validation, local checks reject duplicate/unknown references, unsupported
claim kinds, visual-only change/temporal claims, before/after values not copied from
the same appropriate static finding, contradictions lacking both evidence kinds,
wrong contradiction assessment, product-change without a source-supported change,
and unsupported internal-only claims. Only then does the server build canonical
provenance and parse the canonical ProductImpact schema. Logs are diagnostics, not
additional evidence. No permissive parsing, wrapper extraction or repair is used.

## Historical failure and safe diagnostics

Run `2d738fda-3c37-4010-84a0-4540ed60d568`, invocation
`7e62b6d8-b2f1-4503-92e5-3b9618d6b136`, failed with `unrecognized_keys` at root.
The historical schema-invalid output is unavailable. Whether it contained an impact
wrapper, duplicated provenance, schema definition or other metadata is inconclusive.
Old prose described the fields consistently with the schema, but did not enumerate
an exact root or explicitly prohibit these extra structures; this is hardening of
an underspecified instruction boundary, not proof of the historical extra key.

Product-impact schema failures now retain schema/output hashes and output byte length,
plus at most eight issues with sanitized paths, extra-key counts and at most eight
names from a fixed public structural vocabulary per issue. Other key names are
withheld (counted); arbitrary keys can themselves contain secrets. No values, raw
schema-invalid output, credentials, transport body or environment data are retained.
Malformed JSON still has no raw output snapshot. Older diagnostic records continue
to parse without the new optional fields; no historical rows are rewritten.

`fixtures/blocked-impact.json` is canonical source/vision/coverage input from the
Blocked run, not a recovered model answer. Deterministic mocked tests exercise valid
semantic content, wrappers, extra metadata, summary-only incomplete output, nested
unknown keys and metadata attachment. A required valid summary is accepted: calling
all summary fields unexpected would contradict the actual schema.

## Source coverage

Source and runtime observations are independent evidence. An empty/redacted screen or an
unexercised interaction does not contradict cited source behavior. New synthesis must
retain narrowly supported behavior or account for its uncertainty without inventing facts.

The ledger reuses snapshot-scoped `source-1` … `source-4` IDs from the existing ordered,
immutable source-reference catalog. Each finding appears exactly once: `incorporated`,
`excluded` (internal-only/unsupported), or `uncertain` (partial-source/contradiction).
Excluded/uncertain entries require a bounded explanation. Incorporation must match an
actual compatible claim reference; several findings can support the same claim.
Contradiction uncertainty must reference an emitted source/visual contradiction. All
eligible directly supported user-facing findings disappearing without such contradictions
is a coverage failure, never an instruction to fabricate claims.

Coverage is checked at synthesis and when revalidating a retained ledger. Historical
impacts without a ledger remain readable; no records are rewritten. Citation and claim-kind
checks are unchanged. Deterministic checks establish accounting/reference consistency,
not the semantic truth of a model's explanation or claim.

The existing structured-output retry handles JSON boundary failures only, not semantic
repair. Coverage failures make no additional model call: they produce a safe
`source-coverage-incomplete` diagnostic and finish documentation runs incomplete at
impact synthesis, before planning. Provider/model selection and budgets are unchanged.
