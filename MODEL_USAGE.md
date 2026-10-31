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

| Intended responsibility | Current implementation | Gap |
| --- | --- | --- |
| Repository-scale semantic understanding over Git/source/docs | GitHub patches and operator-selected base/head files, advisory product/run notes, validated citations | Bounded selected evidence, not autonomous repository-wide investigation. Repository docs can be selected as files; saved DocSyde documents are not retrieved as analysis input. |
| Model decides whether runtime inspection is needed | Semantic output has assessment, findings and uncertainties | No inspection decision, reason/plan contract, tool loop or runtime dispatch. |
| Deterministic local evidence capture | Launch/attach readiness, explicit Playwright steps, screenshot and DOM/SDK metadata; combined local proof | Caller-scripted only; no product orchestration or runtime-to-commit provenance. Capture settings improve repeatability, but do not guarantee identical pixels or application state. |
| Meta multimodal visual verification | Stored PNG plus caller context produces locally validated visible evidence | Standalone capability; no before/after comparison or reconciliation with source claims. Visible controls do not establish that actions work. |
| Provider-neutral boundaries | Text and vision capability APIs isolate provider HTTP details | Each is wired to one provider internally; no automatic fallback or runtime provider selection. |
| Combined evidence before documentation updates | Static analysis feeds a second draft-generation call | No runtime/vision inputs, existing-document targeting, content diff/update or automatic mutation. Publishing/replacing a reference to an immutable saved draft is implemented separately. |

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
- Vision reads the stored PNG and sends only image bytes and caller context to
  Meta. It does not send artifact keys, local paths, DOM or Git state. Inputs are
  untrusted. The prompt forbids documentation impact decisions and unsupported
  behavior claims. Output shape and bounds are validated locally, not factual truth.
- Text and vision parse final JSON and validate with Zod; they do not salvage
  reasoning/prose. Provider failures remain sanitized. No schema validation proves
  semantic accuracy. See the [AI guide](src/integrations/ai/README.md) for limits.
- Future combined orchestration belongs to the existing feature workflow, through
  narrow entries. Provider, browser, runtime, storage and SDK modules retain their
  present responsibilities; no new service, queue or generic framework is needed
  merely to describe this target.

## Next implementation steps (planned, not part of this audit)

1. Add a bounded inspection-decision contract to semantic analysis, preserving
   a reasoned skip outcome and explicit uncertainty. Validate allowed targets and
   actions in feature operations; model output must not become shell commands or
   arbitrary browser code.
2. Connect the proven runner/capture capabilities to that decision. Record the
   intended revision, actual runtime identity, route/state, capture artifact/hash
   and coverage; do not infer that a local app matches a commit.
3. Invoke the existing vision boundary for selected captures. Preserve screenshot
   observations separately from DOM evidence and source inferences, including
   failures, limitations and conflicting observations.
4. Add combined-evidence reasoning before final documentation impact/generation.
   Extend validators and provenance deliberately; current source-only citation
   contracts cannot silently accept runtime claims. Retrieve relevant existing docs
   through Documentation's narrow ownership boundary before proposing targeted updates.
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

The audit checks the current working tree, including existing changes. Mocked model
tests exercise contracts and failure handling, not live availability or factual
quality. Real provider calls are opt-in and spend credit; none were made in this audit.
See [SETUP.md](SETUP.md#model-and-runtime-flow-audit) for exact audit results and
commands to rerun the capability checks.
