# Text structured-output boundary

## Native and compatibility modes

Baseten documents that Muse Spark Open accepts `json_schema` but does not enforce
it. Both configured aliases therefore use prompt mode, with `model-unsupported`
recorded as the fallback reason. JSON Schema is included in system instructions;
strict local Zod validation, conservative extraction and reference/grounding checks
remain authoritative. No currently verified model is enabled for native enforcement
in this adapter. The native path remains capability-gated for a future verified
provider/model; a successful receipt or accepted request alone is insufficient.

`BASETEN_STRUCTURED_OUTPUT_MODE=prompt` still explicitly chooses compatibility mode.
No model or reasoning/temperature default changes. Recovery uses at most three total
attempts per operation. Only provider-confirmed `length` completions may increase
output tokens, by 1.5x up to a configured operation cap (twice its initial policy
ceiling, never above 16,384). Unknown operations retain their original ceiling.

Official references: [Baseten model support](https://docs.baseten.co/inference/model-apis/overview)
and [structured outputs](https://docs.baseten.co/inference/structured-outputs).

## Contract and audit

Old flow: Baseten checks completion → JSON.parse → exact generation schema → feature reconstruction → canonical validation/grounding. Provider prose, fences, wrappers and extra fields could fail before valid semantic content reached feature validators. Length is a transport failure, not a JSON repair opportunity. Unknown IDs/ranges, semantic enum/state failures, scope expansion, and invalid reference graphs are correctness failures, not provider formatting failures.

New flow: same Baseten/model/settings → strict JSON parse, then conservative extraction if needed → operation-specific model-facing schema → deterministic key projection → unchanged strict generation schema → unchanged feature reconstruction/domain/grounding. Only declared object nodes accept unknown keys; the separate model schema uses passthrough, and projection discards those keys before strict parsing. Array limits, enums, strings, refinements and required fields remain enforced by the original strict schema. Models are still instructed to return the original exact schema. Flexibility is an acceptance boundary, not permission to author more prose.

| Text operation | Supported wrappers | Safe flexibility / normalization | Canonical ownership and remaining checks |
| --- | --- | --- | --- |
| repository-understanding | result, analysis | Only explicit `metadata` and recognized string `$schema` dialect markers discarded at the semantic root or outside its wrapper; markers are never dereferenced or used for validation. All other extra keys reject | Unchanged strict six-field summary schema; application attaches identity, revision, files/hashes, time and deterministic coverage. Single attempt only. |
| source-analysis | result, analysis | Declared root/finding/citation object extras discarded | Model supplies evidence ID/range, not excerpts. Source reconstructs excerpts; citation range, reachability, IDs, support stay strict. |
| runtime-decision | result | Root/target extras discarded | Existing compact IR resolves finding/target refs into routes, capabilities and canonical citations. Unknown IDs, duplicate pairs, unsupported routes/capabilities, limited-evidence decisions reject. |
| visual-selection | result | Root/selected-item extras discarded | Exact checkpoint/source refs and short question only; server attaches version. Identity/count/correspondence restrictions unchanged. |
| product-impact | result, impact | Root/claim/contradiction extras discarded | v3 returns short judgments, evidence IDs and beforeRef/afterRef instead of temporal prose. Exact same-finding lookups reconstruct canonical temporal facts; server attaches provenance. Claim semantics, reference graph, contradictions and required uncertainties remain strict. |
| documentation-planning | result | Root/decision extras discarded | Exact claim/document/section references only. New model output keeps the same fields/actions/IDs with reasons/intents capped at 180 characters and three new uncertainties at 160 each; historical canonical plans keep their original limits. Model input omits retrieval scores/hashes, retaining candidate scope/matched sections and full document content. Server attaches source, claim catalog, all upstream qualifications and full candidate selection. Target/support/coverage checks unchanged. |
| documentation-transformation | result | Envelope extras discarded only | Entries are deliberately opaque to boundary projection. Existing per-entry shape, authorization, support and canonical document checks remain strict; invalid entry metadata is not stripped. |

Other text operations retain strict schema shape (with shared conservative JSON extraction). Meta vision parsing/configuration is unchanged. Transformation-support remains strict and is not an opt-in flexible operation. There is no model substitution or fallback.

Required semantic arrays (including uncertainties/contradictions) are **not** defaulted: an omitted uncertainty result is not evidence of no uncertainty. Existing optional/default field semantics are honored; no new stage defaults or nullable conversions are invented. No field aliases, string/number coercions, enum mappings, repaired references or semantic choices are added. Root plus a supported wrapper, or multiple supported wrappers, is ambiguous and rejected. A single supported wrapper must contain a recognizable contract object. Unknown unsupported wrappers do not authorize unwrapping.

## Conservative JSON policy

First try JSON.parse on the exact text. If that fails, strip a leading BOM/outer whitespace or a single surrounding Markdown JSON fence. Otherwise scan balanced outer objects/arrays respecting quoted strings/escapes. Exactly one complete outer candidate is required; total surrounding material is limited to 1,024 characters. Parse the exact candidate slice. Incomplete/mismatched containers, orphan closing delimiters or surrounding bare JSON punctuation, multiple candidates, invalid candidate JSON or excessive surrounding text reject. Nested fragments of a broken outer object cannot be rescued. Never insert delimiters/commas, change values, combine candidates or log malformed response text. Safe metadata contains only structural enums, fixed allowlisted key names/counts, SHA-256 and byte length.

## Central retry policy

| Result | Action |
| --- | --- |
| Exact JSON / conservative extraction / supported normalization succeeds | Continue without retry |
| Invalid JSON or supported wrapper formatting | Targeted JSON-only regeneration |
| Pure allowlisted descriptive-prose overflow | Counts-only feedback and regeneration |
| Minor overflow removable by ASCII space normalization | Accept only after full schema revalidation; no words removed |
| Provider-confirmed `length` completion | Regenerate with a bounded token increase |
| Other non-stop/refusal/timeout/HTTP error | Hard fail |
| Mixed errors, unknown IDs, wrong types/enums, counts or cross-field invariants | Hard fail |
| Grounding/correspondence/support/contradiction/publication rejection | No retry |
| Frozen single-attempt experiment, cancellation, exhausted budget or failed invocation log | No retry |

Three total transports per failed operation (initial plus at most two retries),
shared across error categories, never a workflow restart. Baseten text, Meta
composition and Meta vision reuse this cap/classifier. Composition/vision recover
JSON syntax and genuine token truncation only: documentation content, visible
text, spatial evidence and certainty are never normalized or treated as prose.
The transformation envelope stays opaque so independently validated siblings and
all feature-owned content/reference checks keep their existing behavior.

Allowlisted prose: source finding descriptions/confidence reasons; impact summary,
claim descriptions/confidence reasons and contradiction descriptions; inspection
reason/target reasons; screenshot-selection questions; documentation-plan reasons;
transformation-support verdict reasons. Every local schema issue must be a string
length overflow on these exact operation-specific paths. Only redundant ASCII
spaces in single-line prose without code markers can be normalized; no slicing,
sentence removal, evidence/reference edits or content repair. All other overflow
requires concise regeneration from the original input, with fixed paths and
numeric counts only. Inspection reasons now have a realistic 180-character hard
cap (80-character prompt target); uncertainty bounds and canonical schemas remain.

Each attempt must be logged before retry dispatch; failed output is not retained.
All retries consume existing call/token/time admission budgets, preserve original
evidence, schema, model and reasoning/sampling settings, and check cancellation.
Diagnostics expose attempt, retry count and sanitized reason/counts. Semantic
validators run afterward and cannot request a formatting retry. Models vary:
bounded recovery improves resilience but cannot guarantee a successful run.

## Size and observability

Product-impact v3 caps summary at 300 characters, contradictions at 240, confidence
reasons at 120, and uncertainties at 160. Claim descriptions target 240 characters in
the prompt but retain the canonical 500-character hard limit; valid prose is not
truncated or rejected merely for missing the drafting target. It retains six claims,
four contradictions, required qualification arrays and existing sourceCoverage semantics.
The model selects each non-null temporal field via a source-N reference; both non-null
refs must identify the same cited finding with an available value. Current-state and
visual-only temporal references fail. Change runs reject invalid claims; Full Scan
retains its existing per-claim rejection/disposition behavior. Server reconstruction
then runs the unchanged canonical and grounding checks. No invalid ID is repaired,
no prose is truncated and no qualification array is defaulted.

The request omits repeated repository/commit/hash/model/timing metadata while retaining
source text needed for reasoning, evidence refs, visual observations, coverage and
limitations. Historical canonical snapshots remain readable. The operation contract
version is product-impact-v3; canonical ProductImpact schema/storage are unchanged.
The 8,192-token output allowance and inference defaults are unchanged. Compact output
reduces work but cannot guarantee successful generation on a non-enforcing provider.

Baseten response diagnostics additionally retain counts of JSON formatting whitespace
outside strings and the longest such run. Those counts, visible bytes/characters and
reasoning-token usage survive truncation. Rejected text and hidden reasoning remain
unretained; counts do not authorize parsing or repairing incomplete JSON.

Repository-understanding diagnostics additionally retain bounded expected/received root key names from a fixed public vocabulary, withheld-key count, and object/array/scalar shape; arbitrary key names and all rejected values remain excluded.

Each text attempt records strict parse result, extraction type, model-schema result, normalization and strict-schema result, ignored count plus only safe key names, wrapper, output hash/bytes and retry reason. Canonical pending/rejected is explicit. Existing structured-success/succeeded/failed state plus existing validation diagnostics record post-validation. PostgreSQL preserves boundary trace when adding a semantic rejection. Usage detail displays directly accepted/recovered/normalized/retried-format states and the diagnostic. Malformed/schema-invalid raw content is not newly retained. Approved canonical/schema-valid snapshots keep their existing allowlist and redaction limits. No migration is required.

## Deterministic verification

`npm run ai:test` includes recovery, normalization, actual Blocked routing fixture, strict canonical rejection, bounded retry and usage/UI tests. Source, documentation and orchestration suites exercise the unchanged feature validators. All provider traffic in tests is mocked; no paid verification is part of this change.


## Vendor guidance and limits

Meta recommends schema-constrained structured output with required keys, closed objects
and enums on its supported endpoint. Baseten recommends simple, shallow schemas,
clear field names, schema/example context and explicit completion-status handling.
Baseten separately documents that Muse Spark Open does not enforce json_schema.
DocSyde therefore keeps strict local validation. The narrow prose-feedback retry is
an application recovery policy for this non-enforcing model, not a vendor guarantee.
Switching to an enforcing provider/model is a separate configuration decision.

- https://dev.meta.ai/docs/cookbook/structured-output
- https://docs.baseten.co/inference/structured-outputs
- https://docs.baseten.co/inference/model-apis/overview

## Opt-in demo reliability

`DEMO_RELIABILITY_MODE=true` permits five total attempts (formatting, truncation and
semantic corrections combined) and at most two semantic corrections. Only logged,
closed-vocabulary reference, mapping and supported-coverage failures are eligible.
Features supply pure preflight callbacks that reuse existing validators with deferred
acceptance. Final validation still runs before downstream use; no proposal/document
mutation occurs in a callback. Rejected values never enter correction instructions.
Contradictions, unsupported claims, authority/route failures, invalid spatial
relationships, unknown semantic errors and publication checks do not retry.

Known Baseten models start at 16,384 output tokens with a 32,768 application ceiling;
known Meta composition/vision models start at 8,192 with a 16,384 ceiling. Only a
confirmed `length` completion grows that allowance. Larger evidence and shared
call/token allowances remain deterministic and redacted. Normal defaults, frozen
experiment restrictions, human review and the 40-minute workflow deadline remain.
See [SETUP](../../../SETUP.md#hackathon-demo-reliability-mode) for the complete
limit table and increased inference cost. No new provider or unrestricted mode.
