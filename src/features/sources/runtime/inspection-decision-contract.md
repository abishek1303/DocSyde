# Runtime-decision v3 compact semantic IR

The v3 reference/authority contract remains implemented. Failure diagnosis and
provider-budget commentary below preserve the original investigation snapshot.
Reasons now accept 180 characters (80 remains the prompt target), runtime decision
requests low reasoning effort, and shared bounded model-output recovery applies.
See the [current boundary policy](../../../integrations/ai/structured-output-boundary.md).

Implementation: `decide-runtime-inspection.ts:decideRuntimeInspection`.
The entire old/new instruction text and exact changed code appear in
[the focused review diff](inspection-decision-review.md). No provider run was made.

## Why the old output was expensive

The legacy model schema (still the canonical/historical `inspectionDecisionSchema`)
allowed a root reason of 500 characters, three targets each with a 300-character
description, four 300-character visibleEvidence strings, and four citations each
with a 600-character excerpt. Four global uncertainties allowed 300 characters each.
That is 13,400 prose/excerpt characters before paths, IDs, line numbers and JSON.
Each target additionally permits an 80-character capabilityId and a concrete pathname
up to 1024 characters. Each citation has evidenceId <=30 characters and positive
integer start/end (Zod safe integer bounds), repeating canonical source text/positions.
The root/status enums have three choices each. All objects are strict.

The largest minified schema-valid old object is 18,513 bytes for ASCII prose or 87,313 bytes
with worst-case escaping of permitted control characters. These are schema bounds,
not a claim that maximum numbers identify real supplied evidence. ASCII bytes/4 is
~4,629 tokens; escaping bytes/4 is ~21,829. Exact Muse tokenization is not measured.
The prior successful real decision retained 1,933 bytes of JSON but reported 3,666
output tokens. The latest incomplete call consumed exactly 4,096. With always-enabled
reasoning, completion usage is not just visible JSON; no reasoning content was retained
or inferred. Repeated excerpts/prose increase both output size and copying workload.

## New generation schema

Exactly `status`, `reason`, `staticEvidence`, `targets`, `uncertainties`:

- status: inspect / not-needed / unresolved (unchanged semantics).
- reason: 1–80 characters, nonblank single-line prose.
- staticEvidence: sufficient / insufficient / uncertain (semantic assessment retained).
- targets: 0–3, each exactly findingRef, targetRef, reason (1–80 characters).
- findingRef: exact server-supplied finding-1..finding-4.
- targetRef: exact server-supplied target-N or null; bounded to six decimal digits.
- uncertainties: 0–3 entries, each 1–80 nonblank characters.

Prose excludes Unicode controls, format characters, line/paragraph separators and lone surrogates to keep it
single-line and explicitly bound JSON escaping/UTF-8. Meaningful internal spaces and
Unicode text are preserved. inspect requires at least one concrete target; not-needed
has no targets; unresolved needs uncertainties and at least one route-less desired
target when targets exist. An unresolved decision with no targets remains permitted
when no source finding can justify a concrete target.

Model-authored fields removed: pathname, capabilityId, citations (including evidenceId,
startLine, endLine, excerpt), target.description and target.visibleEvidence. Only IDs
and one semantic check reason per target cross the model-output boundary. No selectors,
actions, URLs, commands or execution configuration are authored by the model.

## Deterministic reconstruction and guarantees

`runtimeDecisionTargets` constructs invocation-local target-N identifiers for exact
operator capabilities first, then existing conservatively extracted literal routes.
The input supplies this table and finding-N IDs. No candidate is silently truncated.
Payloads above the existing 64 KiB evidence budget reject before inference.

`resolveRuntimeDecision` requires exact finding/target correspondence, rejects duplicate
finding/target pairs, attaches the canonical pathname and optional capabilityId, and
copies citations from the selected finding plus the route-authority citation when
needed. Identical citations are deduplicated. More than four canonical citations reject
rather than silently discarding evidence. The short target reason populates the legacy
canonical description and singleton visibleEvidence; these two display/context fields
no longer require separate model narration.

The existing `validateRuntimeDecision` then revalidates every canonical citation's
identity/availability/exact inclusive range and excerpt, exact capability ID/path
scope, exact route-and-authority-citation tuple, and limited-evidence/not-needed rule.
Input analysis is still fully validated before inference. Reference membership cannot
prove semantic claim truth, just as the old local citation check could not. No path
is inferred from a filename, and runtime cannot expand a trusted workflow's scope.
Historical canonical schemas/rows are unchanged. Raw compact IR is retained in bounded
debug output; the canonical run decision contains resolved execution/audit data.

## Every returned field's downstream use

| Canonical field | Consumer |
|---|---|
| status | documentation `execute-run-workflow`: coverage outcome, skip/inspect branch; local `execute-runtime-inspection`: requires inspect; stored run/stage readers display it |
| reason | workflow limitations/reason, stage preview in `run-response-projection`, retained run/UI technical response |
| staticEvidence | retained decision/stage response; distinguishes semantic static sufficiency from runtime usefulness; not an execution permission |
| targets.pathname | workflow requestedTargets/coverage comparison with supportedPathnames; local runner navigates only concrete validated paths |
| targets.capabilityId | workflow selects scope limitations from configured capabilities; correspondence validator enforces exact ID/path authority |
| targets.description | local runner builds visionContext and returned inspection metadata; retained stage detail |
| targets.visibleEvidence | local runner visionContext/returned target metadata; retained stage detail |
| targets.citations | correspondence validation; local runner evidence metadata; retained stage/audit response |
| uncertainties | workflow unresolvedQuestions and limitations passed to impact synthesis; retained stage/audit response |

New findingRef/targetRef are resolved only at the Sources boundary and remain in model
invocation debug. target.reason supplies the canonical short inspection intent. The
canonical decision format consumed by the existing runner, orchestration and UI does
not change. No downstream execution, capture, selection or vision prompt is modified.

## Calculated size and model policy

`inspection-decision-size.test.ts` builds and schema-validates maximum objects for both
contracts, including complete three-target/three-uncertainty Unicode and escaping cases.
New minified JSON.stringify maximum: 864 ASCII bytes or 1,984 UTF-8 bytes. Approximate bytes/4 estimates: 216 /
496 tokens; a deliberately conservative byte-token envelope is 1,984, below 60% of
4,096. Controls are excluded; a Unicode BMP code point costs at most three bytes per
UTF-16 unit, while quotes/backslashes cost two escaped bytes per unit and astral pairs
cost four bytes per two units. Thus this is an actual serialization bound, not just
one typical English sample. Dominant new content is seven 80-character prose strings
(560 UTF-16 units); other fields are small fixed enums/bounded IDs.

Keep maxOutputTokens **4096 → 4096** to leave room for always-enabled Muse reasoning;
no increase to 8192, reasoning-effort control, retries or fallback is added. A compact
output does not guarantee that hidden reasoning can never consume the full ceiling.
The default remains Baseten `meta-models/muse-spark-open-1026`; the existing configured
model resolution is unchanged. No non-Meta fallback exists or is introduced. Contract
metadata alone changes runtime-decision-v2 to runtime-decision-v3.

## Verification

Focused runtime-decision tests: 15 passed. Source compatibility: 146. AI structured/
logging: 53. Real Chromium visual/runtime: 69. Inspection/observation: 27.
Documentation: 153. PostgreSQL/Chromium mocked orchestration: 17. Lint, TypeScript,
production Webpack build and diff checks passed. Historical schema/lexical-route
checks remain; new IR tests replace obsolete model-authored citation-output tests.
An orchestration mock's old request discriminator was updated to recognize the new
supplied targets table. A sandbox-blocked observation port test passed when rerun
with local process/network permission. No model inference or workflow rerun occurred.

## Native c3ca9b6f exhaustion diagnosis

The retained c3ca9b6f request already used the v3 IR above, not the large historical
canonical schema. Its native JSON Schema is 1,029 bytes, semantic instructions 1,384
bytes, and input 10,796 bytes (3,256 reported input tokens). The input contains two
undetermined source findings, one issue-status capability, a 13-line patch and two
supporting files (46/108 lines). Canonical finding citations repeat parts of that
input, but no evidence text is requested in the output. The exact saved input,
instructions and schema are an offline replay fixture; the regression asserts native
payload equality and unchanged correspondence checks for each disposition.

At maximum, v3 emits seven 80-character prose fields, three finding/target ID pairs,
two enums and JSON structure: 864 minified ASCII bytes or 1,984 UTF-8 bytes in the
worst supported character case. These bounds describe minified data, not raw JSON
whitespace or provider completion-token accounting. Whitespace can expand raw JSON;
reasoning can consume completion budget without appearing in the returned data.
No tokenizer or reasoning-token breakdown was retained. Thus the 4,096 reported
completion tokens do not establish a 4,096-token semantic artifact. In the preceding
source call, 4,417 completion tokens accompanied only 2,175 visible JSON bytes, which
is consistent with substantial non-visible completion usage but does not quantify it.

The runtime request returned length/incomplete-output after 16,106 ms and was rejected
before parsing. No response body was retained, so hidden reasoning, excessive
whitespace, or provider schema/decoding behavior cannot be distinguished afterward.
In particular, native JSON Schema does not encode the local superRefine status/target
consistency check or nonblank trim check; strict application validation still enforces
both. There is no evidence that either caused this provider exhaustion.

Every remaining generated field is a bounded judgment: status, static-evidence
sufficiency, brief overall reason, selection of finding/target IDs, per-target visible
check, and uncertainties. Identifier values and their authority tables, routes,
capability IDs, citations/excerpts and canonical display enrichment are application
owned. Static sufficiency is distinct from the source assessment and from runtime
usefulness, so it cannot safely be copied from either. Removing these judgments is
not justified by this failure. No contract, prompt, provider policy, token ceiling,
runner, capture or vision behavior changes are made by this diagnosis. Another full
live run would be a repeat with no identified mitigation; provider completion-budget
behavior needs investigation before treating it as a reference demo path.
