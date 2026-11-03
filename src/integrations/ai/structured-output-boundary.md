# Text structured-output boundary

## Native and compatibility modes

Baseten's declared Muse Spark Open models (including the configured -1026 alias)
use `response_format: { type: "json_schema", json_schema: { name, strict: true, schema } }`
for closed, representable object schemas. Conversion uses the same Zod JSON Schema
infrastructure. No schema text is appended to native system instructions. Native
responses use strict JSON parsing and the unchanged strict Zod/feature validators;
malformed/native-invalid output never triggers extraction, retry or a paid downgrade.
The deployed model alias is verified separately by an explicit live capability check;
request acceptance alone is not proof of semantic correctness.

Provider capability selection happens before dispatch. Unlisted models, opaque/open
schemas (such as transformation entries) and explicit `BASETEN_STRUCTURED_OUTPUT_MODE=prompt`
use the compatibility boundary below, including its existing bounded format retry.
Native schema constraints do not replace refinements, evidence/ID correspondence or
resource authorization. No model or operation ceiling changes. Mode/name/version/hash
are recorded in existing invocation JSONB; raw schema logging keeps its existing allowlist.

[Baseten response format specification](https://docs.baseten.co/reference/inference-api/chat-completions).

## Contract and audit

Old flow: Baseten checks completion → JSON.parse → exact generation schema → feature reconstruction → canonical validation/grounding. Provider prose, fences, wrappers and extra fields could fail before valid semantic content reached feature validators. Length is a transport failure, not a JSON repair opportunity. Unknown IDs/ranges, semantic enum/state failures, scope expansion, and invalid reference graphs are correctness failures, not provider formatting failures.

New flow: same Baseten/model/settings → strict JSON parse, then conservative extraction if needed → operation-specific model-facing schema → deterministic key projection → unchanged strict generation schema → unchanged feature reconstruction/domain/grounding. Only declared object nodes accept unknown keys; the separate model schema uses passthrough, and projection discards those keys before strict parsing. Array limits, enums, strings, refinements and required fields remain enforced by the original strict schema. Models are still instructed to return the original exact schema. Flexibility is an acceptance boundary, not permission to author more prose.

| Text operation | Supported wrappers | Safe flexibility / normalization | Canonical ownership and remaining checks |
| --- | --- | --- | --- |
| repository-understanding | result, analysis | Only explicit `metadata` and recognized string `$schema` dialect markers discarded at the semantic root or outside its wrapper; markers are never dereferenced or used for validation. All other extra keys reject | Unchanged strict six-field summary schema; application attaches identity, revision, files/hashes, time and deterministic coverage. Single attempt only. |
| source-analysis | result, analysis | Declared root/finding/citation object extras discarded | Model supplies evidence ID/range, not excerpts. Source reconstructs excerpts; citation range, reachability, IDs, support stay strict. |
| runtime-decision | result | Root/target extras discarded | Existing compact IR resolves finding/target refs into routes, capabilities and canonical citations. Unknown IDs, duplicate pairs, unsupported routes/capabilities, limited-evidence decisions reject. |
| visual-selection | result | Root/selected-item extras discarded | Exact checkpoint/source refs and short question only; server attaches version. Identity/count/correspondence restrictions unchanged. |
| product-impact | result, impact | Root/claim/contradiction extras discarded | References resolve supplied source/visual evidence; server attaches provenance. Claim semantics, reference graph, contradictions and required uncertainties remain strict. |
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
| Invalid JSON after recovery | One format-only retry if attempt 1 was logged |
| Ambiguous/unrecognizable explicitly supported wrapper | One format-only retry if attempt 1 was logged |
| Missing semantic field, wrong type/enum, count/prose overflow, canonical refinement failure | Hard fail; no retry |
| Grounding/correspondence/support rejection, insufficient evidence, unresolved/no-change | No retry |
| Length/non-stop/refusal/timeout/HTTP error | Existing hard failure; no automatic transport retry introduced |
| Existing single-attempt experiment scope | Preserve its one-call budget; format retry disabled |
| Invocation persistence unavailable | Suppress retry; attempt 2 must be logged before dispatch |

At most two transports **per generateStructured call**, not per workflow: transformation can already batch, and vision can already analyze multiple images. Same provider/model/input/schema/settings/ceiling; attempt 2 appends only `Return only one valid JSON object matching the requested structure. No prose or wrapper.` No reasoning effort controls are added. Feature validators execute outside this loop, so a semantic rejection cannot cause a paid retry. Both attempts receive separate existing invocation rows and usage accounting; boundary metadata labels attempt 1/2 and why retry was requested. Adapter failures without a response label their attempt but cannot report a parse result.

## Size and observability

No additional output contract reduction or ceiling change is made here. The audit found source excerpts, runtime routes/citations, visual metadata, impact provenance, planning catalogs and transformation canonical documents already reconstructed from exact refs. Remaining descriptions/before/after/confidence/intent/uncertainty carry semantic judgments; removing them would alter the task. Existing source v3 citation refs, runtime v3 IR, and visual v3 selection remain compact. This work reduces the normalized object by dropping provider-only extras; it cannot reduce tokens already spent on those extras or guarantee against reasoning-token exhaustion. Length still fails, intentionally.

Repository-understanding diagnostics additionally retain bounded expected/received root key names from a fixed public vocabulary, withheld-key count, and object/array/scalar shape; arbitrary key names and all rejected values remain excluded.

Each text attempt records strict parse result, extraction type, model-schema result, normalization and strict-schema result, ignored count plus only safe key names, wrapper, output hash/bytes and retry reason. Canonical pending/rejected is explicit. Existing structured-success/succeeded/failed state plus existing validation diagnostics record post-validation. PostgreSQL preserves boundary trace when adding a semantic rejection. Usage detail displays directly accepted/recovered/normalized/retried-format states and the diagnostic. Malformed/schema-invalid raw content is not newly retained. Approved canonical/schema-valid snapshots keep their existing allowlist and redaction limits. No migration is required.

## Deterministic verification

`npm run ai:test` includes recovery, normalization, actual Blocked routing fixture, strict canonical rejection, bounded retry and usage/UI tests. Source, documentation and orchestration suites exercise the unchanged feature validators. All provider traffic in tests is mocked; no paid verification is part of this change.
