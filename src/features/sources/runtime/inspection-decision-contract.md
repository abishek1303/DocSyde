# Runtime-decision v3 compact semantic IR

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
