# Model usage and evidence flow

Audit date: October 30, 2026. This describes the current working tree, including
pre-existing uncommitted Meta vision and combined runner/capture proofs. It does
not imply those proofs are committed or connected to the product workflow.
[ARCHITECTURE.md](ARCHITECTURE.md) remains the architectural source of truth.

## Intended flow and current status

The intended flow is:

1. Muse Spark Open through Baseten interprets Git/source/documentation context
   and proposes whether runtime inspection is needed, with a reason and evidence
   requirements.
2. Feature-owned orchestration validates that request and invokes local runner +
   Playwright capture with explicit, bounded routes and scripted actions.
3. A Meta Model API multimodal model describes visible screenshot evidence.
   DOM/runtime evidence remains separately identified.
4. Application logic combines static findings, runtime/visual evidence and existing
   documentation before determining documentation impact and proposing updates.
5. Review, saving and publication stay explicit under the existing workflow.

This complete loop is **not implemented**. The current path is:

`GitHub comparison + selected pinned files + advisory notes → Baseten semantic
analysis → validated findings → Baseten draft generation → validation → explicit
save → explicit publication → exact repository/pathname SDK delivery`.

Separately, local verification can compose
`runtime readiness → Playwright capture → artifact storage → runtime cleanup`.
An independent vision CLI can read a stored PNG and call Meta. Neither path is
invoked by change analysis or documentation generation.
Sources also exposes an independent `decideRuntimeInspection(ProductResult)` step
through Baseten. It consumes already supplied static evidence and returns a bounded
inspection decision; it does not execute that decision or alter the current workflow.
An internal local-verification `executeRuntimeInspection()` helper can now consume
that direct validated decision and coordinate capture plus Meta vision. It is not
invoked automatically by Sources or documentation workflows.
An independent Sources `synthesizeProductImpact({ source, runtime? })` capability
now combines validated static findings with optional compact visual evidence in one
Baseten text call. It is contract-tested with mocked transport, not live-verified
or connected to draft generation. It invokes neither capture nor Meta.
Documentation now exposes independent `planDocumentationImpact({ impact })`:
one Baseten text call targets exact saved document/section UUIDs for revise/add/
no-change/unresolved planning. It is mocked-contract-tested, not live-model verified
or connected to draft generation, saving or publication.

| Intended responsibility | Current implementation | Gap |
| --- | --- | --- |
| Repository-scale semantic understanding over Git/source/docs | GitHub patches and operator-selected base/head files, advisory product/run notes, validated citations | Bounded selected evidence, not autonomous repository-wide investigation. Repository docs can be selected as files; saved DocSyde documents are not retrieved as analysis input. |
| Model decides whether runtime inspection is needed | Separate Sources operation returns validated not-needed/inspect/unresolved; internal local executor accepts inspect targets | Decision/execution composition is contract-tested with mocks; no automatic feature dispatch or closed-loop live proof. |
| Deterministic local evidence capture | Launch/attach readiness, explicit Playwright steps, screenshot and DOM/SDK metadata; combined local proof | Caller-scripted only; no product orchestration or runtime-to-commit provenance. Capture settings improve repeatability, but do not guarantee identical pixels or application state. |
| Meta multimodal visual verification | Stored PNG plus caller context produces locally validated visible evidence | Standalone capability; no before/after comparison or reconciliation with source claims. Visible controls do not establish that actions work. |
| Provider-neutral boundaries | Text and vision capability APIs isolate provider HTTP details | Each is wired to one provider internally; no automatic fallback or runtime provider selection. |
| Combined evidence before documentation updates | Independent Sources synthesis plus Documentation planning against bounded repository-scoped saved snapshots; existing draft flow remains source-only | These capabilities are not wired into the workflow. Replacement prose, content diff/update and automatic mutation remain absent. |

## Models, providers and replaceability

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
  and citation validation. [analyze-product-changes.ts](src/features/sources/analyze-product-changes.ts)
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
- Sources' independent [inspection decision](src/features/sources/decide-runtime-inspection.ts)
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
- Sources' independent [product-impact synthesis](src/features/sources/synthesize-product-impact.ts)
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
  retrieving at most ten canonical repository-scoped saved documents through existing
  queries. Incomplete listings, corrupt/missing/mismatched candidates and a complete
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

## Next implementation steps (planned, not part of this audit)

1. Connect the independently implemented inspection decision to the feature-owned
   workflow, preserving reasoned skips and explicit uncertainty. Its mocked contracts
   do not establish live semantic decision quality. Future execution must validate
   allowed targets and actions; model output must not become shell commands or
   arbitrary browser code.
2. Connect the locally composed decision executor to the feature-owned workflow. Record the
   intended revision, actual runtime identity, route/state, capture artifact/hash
   and coverage; do not infer that a local app matches a commit.
3. Invoke the existing vision boundary for selected captures. Preserve screenshot
   observations separately from DOM evidence and source inferences, including
   failures, limitations and conflicting observations.
4. Connect independent product-impact synthesis and documentation-impact planning
   to the workflow, preserving source/visual provenance, bounded retrieval and
   uncertainty rules. Existing source-only draft contracts remain unchanged.
   Implement targeted replacement generation/review separately before updates.
5. Extend actual run stages and tests for inspection/skip, capture or model failure,
   contradictory evidence and review/save behavior. Prove the closed loop live
   before describing it as implemented in the demo.

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
