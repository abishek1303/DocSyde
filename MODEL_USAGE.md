# Model usage and evidence flow

Updated October 31, 2026. [ARCHITECTURE.md](ARCHITECTURE.md) defines ownership.

## Schema-v2 run flow and conditional accounting

New analysis runs compose existing capabilities, without orchestration-specific inference:
source analysis → existing runtime decision when available → optional one scripted
workflow/checkpoint selection/vision → ProductImpact → documentation-impact plan →
conditional transformation/support → retained proposal awaiting human review.
Legacy source-to-v1 generation remains a standalone tool and historical run contract;
it is never a fallback for new runs.

| Capability | Calls per run |
| --- | ---: |
| Source analysis | 0–1 |
| Existing runtime-inspection decision | 0–1 |
| Post-capture screenshot selection | 0–1 |
| Selected Meta vision | 0–3 |
| ProductImpact synthesis | 0–1 |
| Documentation-impact planning | 0–1 |
| Transformation generation | 0–8 |
| Transformation support check | 0–1 |
| Retention, review, save, publication | 0 |

Typical actionable source-only runs cost five calls when runtime is unavailable,
six when inspected semantically as unnecessary. A successful runtime path costs
7–10 with one transformation batch. Worst bounded path is 17 calls (14 text, three
vision). Empty comparison costs zero. No-change/unresolved-only plans use no
transformation/support/retention. Failures stop later calls; no automatic retries,
repair, fallback or hidden regeneration occurs. Metadata records returned model IDs,
elapsed time, batch/support attempts and failures where capability contracts expose
them; no token/cost estimates are invented.

Availability filtering is deterministic. Unavailable before decision means decision
not evaluated, never not-needed. Requested-but-uncovered and unavailable inspection
continue source-only with explicit bounded server-owned context passed to synthesis,
retained in impact provenance, projected into planning, and carried into proposal
limitations. That context cannot support claims. Incomplete attempted visual evidence
blocks synthesis, preserving the completed visual-slice semantics. All existing
source support, contradiction, revision-correspondence and request-size rules remain.

One workflow owns one runner/browser lifecycle. Runtime cleanup precedes selection;
there are no model calls during capture and no older per-target capture/vision loop.
The existing local visual CLI remains an independent verifier, using the same trusted
workflow schema. Model transports are mocked in the PostgreSQL/real-Chromium full-run
proof; no paid calls are needed for verification.

## Models, providers and replaceability

Targeted documentation transformation now uses the existing Baseten structured-text
boundary. It consumes an already validated impact/plan and exact immutable snapshots;
it does not repeat source analysis, browser capture or planning. Normally one bounded
shared generation call handles all actionable decisions, then one bounded support
call checks newly authored factual wording. Minimum deterministic batches are the
fallback when exact required context/output capacity cannot fit. Each request is
32 KiB, aggregate generation input 128 KiB, at most eight decisions/generation calls,
and at most one support call (worst case nine calls). The separate planner adds one
call only when the local verifier is invoked without a supplied plan.

No-change/unresolved use zero transformation/support calls. Per-decision catalogs
prevent cross-decision authority; unknown targets/refs/provenance reject independently.
Malformed whole output fails its batch. There are no retries, repair loops or new
providers. The checker only labels new wording supported/unsupported/uncertain and
cannot reevaluate planner targeting, existing provenance or retained baseline text.
Its failures/uncertainty block readiness, and its success is not proof of truth or
human approval. All product/document/model text stays untrusted data.

Accepted typed changes materialize canonical v2 candidates with historical/current
evidence contexts, preserving existing qualification and revision limitations.
Transformations never save, approve, sign or publish. The local proof uses mocked
transport and real feature/canonical validators; no paid provider calls were made
for this slice. See the Documentation README and SETUP for commands and explicit
live-verifier costs. Standalone draft generation remains source-only/v1.

| Model/provider | Capability boundary and current use | Fallback / replacement |
| --- | --- | --- |
| Muse Spark Open via Baseten; default `meta-models/muse-spark-open-1026` | `generateStructured({ instructions, input, schema, maxOutputTokens?, signal? })` in [generate-structured.ts](src/integrations/ai/generate-structured.ts). Used by change summaries, semantic product analysis and documentation draft generation. | `BASETEN_MODEL` overrides the requested model. No automatic fallback or retries. Another provider requires changing the capability's internal adapter while preserving output validation and failure behavior; feature callers need no provider HTTP types. |
| Meta Model API; default `muse-spark-1.3` | `generateStructuredVision({ png, context, signal? })` in [generate-structured-vision.ts](src/integrations/ai/generate-structured-vision.ts); storage wrapper [analyze-screenshot.ts](src/integrations/ai/analyze-screenshot.ts). Describes visible UI elements, observations and limitations. | `META_VISION_MODEL` overrides the requested model. `META_API_KEY` is separate from Baseten credentials. No fallback to Baseten, automatic retries or provider registry. Replacement must preserve the PNG/context and `VisualEvidence` contract. |
| Local runner + Playwright (no model/provider inference) | [runtime.ts](src/runner/runtime/runtime.ts), [capture.ts](src/integrations/browser/capture.ts), local [capture-runtime.ts](infra/local/runner/capture-runtime.ts). Explicit startup/attach, readiness, scripted capture and cleanup. | Runtime/browser APIs hide Node process and Playwright objects. No alternative runtime/browser adapter exists. Attach never owns the external process; launch stops only its direct child. |
| Baseten Management API (no model inference) | Billing utility under `integrations/ai/baseten/billing.ts`; independent read-only accounting. | Provider-specific operational utility, not a product reasoning capability or fallback. |

These model IDs and endpoints describe code defaults, not independently verified
current provider availability or account access. The Baseten event identifier is
also recorded in the user-supplied [hackathon guide](hackathon.md).

## Evidence contracts and ownership

- Sources owns source selection, access checks, evidence coverage, semantic prompts
  and citation validation. [analyze-product-changes.ts](src/features/sources/analysis/analyze-product-changes.ts)
  directly composes GitHub evidence with `generateStructured`. Local Git provides
  an independent compatible evidence proof, not an automatic GitHub fallback.
- Semantic analysis allows at most 30 changed files, 12 KiB per supplied patch,
  10 selected context paths and 64 KiB combined serialized evidence. Larger or
  missing evidence is rejected or explicitly marked unavailable/limited. The
  prompt says no investigation/tools are available. It cannot claim runtime success.
- Documentation owns orchestration in
  [generate-documentation-draft.ts](src/features/documentation/generate-documentation-draft.ts):
  freeze advisory context, analyze changes, prepare validated facts, generate and
  assemble a proposed draft. The draft call receives facts/association choices and
  limitations, not screenshots, DOM, raw source or saved-document content. Its
  serialized input is bounded to 32 KiB. No-change/unusable findings skip generation;
  failed analysis blocks generation. Canonical provenance remains source-based.
- Runner/browser integrations collect evidence and do not decide product meaning.
  PNG bytes are stored through `ArtifactStorage`; capture evidence references an
  artifact key, MIME type and hash. Runtime identity does not establish commit identity.
- Sources' independent [inspection decision](src/features/sources/runtime/decide-runtime-inspection.ts)
  revalidates existing results/citations and uses at most one Baseten text call.
  A consistent no-change result skips inference; upstream errors reject. The complete
  evidence/findings/candidates request is capped at 64 KiB without truncation.
  Limited coverage cannot justify not-needed. Static sufficiency is independent of
  runtime usefulness. Concrete targets must match conservatively extracted literal
  routes with exact source citations; unresolved targets retain uncertainty instead
  of inventing routes. Source correspondence does not prove deployed reachability.
  No selectors, actions, runtime URLs, commands or capture configuration are generated.
- Vision reads the stored PNG and sends only image bytes and caller context to
  Meta. It does not send artifact keys, local paths, DOM or Git state. Inputs are
  untrusted. The prompt forbids documentation impact decisions and unsupported
  behavior claims. Output shape and bounds are validated locally, not factual truth.
- The internal [local inspection executor](infra/local/runner/execute-runtime-inspection.ts)
  accepts only direct validated decision output, reparses its shape and requires
  inspect before side effects. Structural typing/parsing is not provenance proof.
  It delegates one full capture/runtime lifecycle per target, followed by Meta
  analysis of the returned screenshot key, using explicit storage throughout.
  Target paths are unchanged; origin comes only from trusted runtime configuration.
  Vision context contains only description/evidence requests. Source citations are
  preserved separately in compact results with existing capture IDs, screenshot
  references and validated visual data. No DOM/binary duplication or Baseten call
  occurs. Targets execute sequentially, fail fast without partial return/rollback,
  and cannot assume shared transient state across launch-mode restarts.
- Text and vision parse final JSON and validate with Zod; they do not salvage
  reasoning/prose. Provider failures remain sanitized. No schema validation proves
  semantic accuracy. See the [AI guide](src/integrations/ai/README.md) for limits.
- Sources' independent [product-impact synthesis](src/features/sources/impact/synthesize-product-impact.ts)
  revalidates source results/citations and accepts at most three Sources-owned compact
  captures. One Baseten text call receives bounded source excerpts and projected
  visual evidence with server-assigned reference IDs, never screenshot bytes or
  artifact keys. The entire serialized capability request is limited to 64 KiB.
  Claims resolve back to server-owned provenance; visual-only support describes
  rendered state, not temporal change or successful behavior. Temporal values must
  match one supporting source finding. Material unresolved source/visual conflicts
  force insufficient evidence; limited coverage cannot justify internal-only.
  A fixed runtime/revision mismatch warning is injected server-side when visual
  references contribute. Neither evidence kind automatically overrides the other.
  This adds no documentation decisions, model fallback or runtime/Meta invocation.
- Documentation's independent [impact planner](src/features/documentation/plan-documentation-impact.ts)
  reparses Sources ProductImpact and validates its retained reference graph before
  selecting at most ten canonical repository-scoped saved documents using deterministic
  exact metadata/bounded text matching, with unchanged complete broad fallback on no hits. Incomplete listings, corrupt/missing/mismatched candidates and a complete
  capability request over 32 KiB reject before inference. Baseten receives projected
  claims and document/section text/IDs, not upstream provenance or screenshot identity.
  Model claim/target references resolve locally; source-supported eligibility is
  required for revise/add, and insufficient/conflicting impacts permit only unresolved.
  Upstream qualifications remain server-owned. Relevance, positive accuracy and
  coverage gaps remain semantic judgments, not locally proven facts. Saved UUIDs
  identify immutable snapshots, never authority or inferred version families.
  No document is generated, saved, replaced or published by this capability.
- Future combined orchestration belongs to the existing feature workflow, through
  narrow entries. Provider, browser, runtime, storage and SDK modules retain their
  present responsibilities; no new service, queue or generic framework is needed
  merely to describe this target.

## Remaining presentation/integration work

Polished run/review UI, live presentation-only Playwright streaming, MCP tooling and
final demo polish remain deferred. The schema-v2 run now connects decision, capture,
selection, vision, synthesis, planning, transformation and retained proposal state.
Human approval/save/publication remain separate model-free operations. Local verifier
and historical proof descriptions below do not imply those capabilities are still
absent from new-run orchestration.

## Intentionally not used

No SAM segmentation, Muse Image generation, Muse Wonder, Muse Glimmer, audio model,
embedding model, vector retrieval, Modal or Fireworks inference is implemented in
this flow. Baseten's text boundary does not send images. Muse Code is not a runtime
dependency. Additional models should solve a concrete evidence problem; model count
is not an architectural goal. No provider fallback, autonomous browser exploration,
agent framework or automatic documentation publication is implied by this plan.

## Verification

The initial audit checked the current working tree using mocked model tests only.
Those tests exercise contracts and failure handling, not live availability or
factual quality. Real provider calls are opt-in and spend credit.
See [SETUP.md](SETUP.md#model-and-runtime-flow-audit) for exact audit results and
commands to rerun the capability checks.

Subsequent authorized vision sanity checks reached Meta but failed local validation:
the model returned bounding-box coordinates above 1. These were model-output/schema
failures, not account/authentication failures. No coordinates were repaired.

After enabling Meta's documented image-compatible JSON-schema response constraints,
one authorized live request to `muse-spark-1.3` returned HTTP 200 and locally valid
`VisualEvidence` in 6,726 ms. The existing Request Desk screenshot was stored and read
through configured local `ArtifactStorage` under `.artifacts/storage` (process-only
configuration; `.env` unchanged), key `f96ae3b9-477d-4d93-b83e-a3bb0f626746`.
The response identified `New request`, `Title (required)`, `Description (optional)`
and `Create request`, with normalized boxes in `[0,1]`, observations and limitations.
There was exactly one model request, without retries, fallback, coordinate conversion
or clamping. The artifact remains ignored local verification data, not a committed
fixture or persisted analysis result.

The Meta adapter now sends `response_format.type = "json_schema"` with
`json_schema.strict = true`, using the JSON Schema generated from the same Zod
definition used locally. Local validation still rejects invalid coordinates and
enforces edge ordering and uncertain/null bounds; those cross-field refinements
are not represented by the generated JSON Schema. Meta documents structured output
with image inputs in its [structured-output contract](https://dev.meta.ai/docs/structured-output).
All 20 mocked vision/Meta tests and 10 unchanged Baseten text tests passed after
this change. This single live success establishes account/model access and a valid
result for this screenshot, not universal output reliability, factual accuracy,
localization quality or integration into the product workflow.

## Review, approval, save and publication replacement: zero inference

The retained review path makes **zero model calls** and imports no generation/vision
capability. A narrow Sources evidence entry supplies only schemas and deterministic
validation. Trusted transformation output must first be retained; unsigned artifacts
are not authority. Admission rechecks impact/plan/catalog/support/candidate correspondence
without redoing semantic inference. Explicit human choices freeze one accepted selection.
Approved subsets rematerialize deterministically, immutable saves and optional observed-ID
publication replacement commit with durable receipts. Incomplete/unsupported content
cannot be approved into readiness. No review-time support check, repair, regeneration,
provider fallback or paid verification occurs. Transformation's existing generation plus
bounded support-check call profile is unchanged; `--retain` persists its direct result
only when explicitly requested. Saving does not imply publishing, and publication
conflict may follow a successful save. See the Documentation review guide and SETUP.

## Deterministic candidate narrowing: zero additional inference

The planner now receives a bounded candidate set selected by exact association and
word-overlap rules, plus typed score reasons, section IDs/hashes and explicit coverage.
It makes the same one planning call and only reasons about supplied targets; there is
no ranking/classification model or hidden semantic score. Search-selected coverage
cannot establish missing documentation. Ambiguous candidates are retained together;
overflow stops before inference and yields an incomplete run. Existing source-support
and no-change/unresolved rules remain unchanged. Broad fallback preserves prior
loading/integrity behavior. No canonical metadata enrichment or SDK retrieval change
is included. See SETUP for exact scoring/bounds and the PostgreSQL/mocked-provider proof.

## Bounded diagnostics, capabilities and human review

New model-output failures preserve safe diagnostic subtypes, model/timing/completion
metadata, returned token usage and known schema issue paths when available. Invalid
outputs remain rejected; no raw rejected response, automatic retry or repair call is
introduced. Failed historical runs cannot recover discarded response detail. Baseten
Management API billing tooling is removed because the supplied inference key does
not support it. Returned usage is not a dollar-cost estimate.

Trusted runtime capabilities and explicitly pinned supporting context improve the
existing inspection-decision input without adding inference calls. Capabilities are
operator authority, not evidence. Supporting context is at most three files / 16 KiB
from immutable head. Selected screenshot budget still governs vision; the priority
live-demo configuration is limited to one image, intended to show resulting priority,
not prove both form defaults and post-creation state.

Proposal review/save is available through UI controls backed by the existing review
operation. Save and Publish remain separate, model-free actions. Refreshing retained
results and contextual help does not regenerate documentation.

### Priority vertical-slice verification (October 31, 2026 PDT)

The bounded live run reached real trusted capture and Meta vision using exactly one
selected image of `Priority: Urgent` on request details. Product-impact synthesis
then failed `unsupported-change-claim`; planning/transformation/retention were not
reached. The model input now advertises per-finding allowed claim kinds using the
same compatibility function as both validators. Validation is unchanged; mismatched
references remain rejected. Regression tests cover the contract; its live efficacy
has not been retested because the paid-attempt budget was exhausted.

The separate isolated synthesis diagnostic failed provider-envelope validation.
No raw response was retained, so its precise cause and the original historical
failure cannot be recovered. Optional usage metadata is parsed independently from
content; unavailable usage never invalidates otherwise valid output.

Review/save/reopen and identical retry passed a desktop-browser proof using an
existing deterministic test fixture, followed by fixture cleanup. That is independent
UI validation, not proof that the live run produced publishable documentation.

### Frozen-scope offline priority verification

The retained priority source/vision inputs now have a deterministic regression proof
through corrected synthesis, planning against a frozen existing Request Desk snapshot,
transformation/support, proposal validation, review-component rendering and approved
save materialization. Provider outputs are controlled fixtures; database transports are
mocked and all writes are prohibited. The source-kind compatibility matrix is unchanged.
Negative cases reject incompatible kinds, visual-only behavior, invented history and
visual-only documentation updates. The original rejected claim wording was not retained;
the proof reproduces its known rejection class, not an unavailable historical response.

The vertical slice is implemented and awaiting final live verification. Corrected
synthesis has not been proven live; downstream live documentation stages remain
unreached. No additional paid inference was used for these checks or presentation polish.
