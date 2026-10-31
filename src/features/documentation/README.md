# Documentation drafts

## Targeted transformations and canonical v2

`transformDocumentation({ impact, plan, context? }, { signal? }?)` accepts direct
validated server outputs from product-impact synthesis and documentation-impact
planning. Shape/correspondence checks do not authenticate client JSON or re-prove
absent source bodies. The feature loads each exact repository-scoped immutable
target once, validates ownership, freezes normalized SHA-256 identities and returns
a strict `DocumentationChangeProposal`. It never saves, signs, approves or publishes.

Every planner decision survives in original order, with a server-owned decision ID,
original reasoning/references, authorization catalog, generation/support status,
limitations, review readiness and materialization readiness. No-change/unresolved
make no generation or support calls. Section revisions replace only that section;
section additions preserve old content and need an explicit known placement anchor.
Ambiguous placement retains grounded content but blocks materialization. Whole-document
revisions account for every original section using retain/write entries; initial
scope does not delete sections. New documents use existing typed title/sections/
Markdown blocks, with no slug concept or invented association values.

Default cost: one shared structured generation call plus one support check. Exact
subset partitioning of at most eight actionable decisions finds the minimum feasible
number of deterministic batches, with original-order tie breaking. Each generation
request is capped at 32 KiB including schema/instructions and transport headroom;
all generation requests together at 128 KiB. Required target content is never
truncated. Output is capped at 8,192 tokens, 800 characters per authored block and
12 conservative block-capacity units per batch (section operation: two; complete
document: eight). This conservatively budgets possible output, not just input size.
Worst case is eight individually unbatchable generation calls plus one check.
Individually infeasible/aggregate-over-budget work becomes explicitly incomplete.

Sharing a request grants no shared authority. Each entry selects only its own
authorized claims/facts/associations, exact target and snapshot hash. A bounded JSON
envelope is parsed first, then each entry is strictly validated independently.
Missing/duplicate IDs, fabricated targets/references/provenance or unsupported markup
reject that entry. Unknown entries are explicit protocol issues. Invalid whole JSON
or provider failure fails its batch; no salvage, retries or repair loops occur.

At most one 32 KiB batched support call evaluates newly authored/materially modified
factual titles, blocks and factual placement rationale. Exact retained sections and
unchanged titles are excluded. The checker sees authorized current claims/facts and,
for placement only, a structural outline. It cannot reassess targeting, necessity,
historical provenance, retained text or upstream source/visual eligibility. It only
returns supported/unsupported/uncertain; it never repairs content or creates evidence.
Over-budget checking omits no required wording: affected content remains incomplete.
Provider/cancellation failures and missing/duplicate verdicts also block readiness.
The check is fallible and never implies human approval or factual certainty.

All documentation/source/runtime/visual-derived text and generated wording are
untrusted data, never task/schema/budget instructions. Visual-only observations
cannot authorize mutation. Insufficient/conflicting impacts remain non-actionable.
Internal-only additions are blocked; revisions require the planner reason to name
an exact existing target title/text anchor (at least eight characters). Source and
impact confidence are conservatively combined, with assumptions/uncertainty retained.
New associations select validated operator context; historical finding-origin
associations survive through exact retained context, not relabeled new support.

Canonical v1 remains valid and existing draft generation still emits v1. Canonical
v2 uses the same document/section/block/fact concepts and renderer. Its provenance
contains up to eight evidence contexts (comparison, assessment, coverage, limits),
48 facts, 16 findings and 64 evidence entries. Findings/evidence own context IDs;
facts inherit origin through their findings. Citations cannot cross incompatible
contexts; pinned file commits must match the owning comparison, while patches retain
their original base/head context. The existing four-section/two-block limits and
128 KiB UTF-8 document limit remain. V2 allows up to 52 context associations.

V2 revision metadata separately records the current evidence context, based-on UUID
and normalized hash, plan hash and applied decision IDs. Ordinary changes deterministically
produce a fresh immutable candidate: v1 is promoted in memory, historical sections
and provenance retained, new IDs namespaced, and only unreachable catalog entries
pruned. Existing v2 catalogs extend without nested snapshots or history traversal.
Retained content is explicitly not reverified. Multiple compatible decisions for one
baseline produce one candidate; incomplete siblings block that baseline's candidate.
Ambiguity, conflicts, failed grounding and genuine canonical limits remain blockers.

Migration `0005_nice_meggan.sql` only widens the existing JSONB envelope CHECK to
versions 1/2. It creates no table/history system, backfills nothing, and rewrites no
saved documents. Later explicit save can use existing immutable persistence; existing
publication/host DTO behavior remains unchanged. `saveCompatible` means canonical
validation succeeded, not saved/approved/published. Proposal approval is always
`not-requested`. No run-result or UI orchestration is added.

Run `npm run documentation:transform:test` for the mocked planner-to-candidate proof,
and `npm run documentation:transform:persistence:test` after `npm run db:migrate` for
isolated v1/v2 save/load/publication compatibility. The opt-in paid verifier is
`npm run documentation:transform:verify -- <impact.json> [plan.json]`; omitting the
plan adds the existing planning call. Inputs are trusted local full objects, not
untrusted authenticated evidence. It writes an owner-only inspection artifact under
ignored `.artifacts/documentation-transformations/` and exits nonzero for incomplete
proposals. No source analysis is regenerated and no document is saved/published.

Implemented: `/documentation/draft` composes Sources semantic analysis and one
structured draft-generation call in a trusted server invocation. It does not accept
a client-supplied analysis as validated. Generated previews can be explicitly saved
through a signed handoff; saved drafts load independently of Sources and AI.
Existing Sources operations remain intact; `product-analysis.ts` is the narrow
cross-feature entry. The existing allowlist and single-process guard apply to
each provider stage. Keep this local-only; public exposure requires authentication
and user/resource authorization. Provider credentials stay server-side.

## Independent documentation-impact planning

`planDocumentationImpact({ impact }, { signal? }?)` accepts direct validated
`synthesizeProductImpact()` output and returns `{ plan, model, elapsedMs }` using
one existing Baseten structured-text call. It is server-only and independent of
draft generation. It performs no source reads, capture, vision, saves or publication.

Sources owns strict ProductImpact parsing and retained reference-graph validation:
unique catalogs, source citation/evidence correspondence, pinned identities,
capture/reference correspondence and deterministic claim consistency. This cannot
re-prove excerpts or visual facts from absent source bodies/screenshots. Zero-claim
impacts reject before retrieval/inference. This is trusted server input, not a new
client JSON entry point or authorization mechanism.

Existing repository-filtered list/load operations retrieve at most ten canonical
saved documents. Another page, unavailable/corrupt/disappearing rows or repository
mismatch rejects before inference. General/unassociated documents remain candidates;
route associations are hints only. Presentation is sorted by UUID, never recency or
authority. Completeness describes the observed listing, not a transactional lock
against concurrent new saves. No search/index or version-family inference is added.

The strict generated plan has at most eight decisions and six uncertainties.
Decisions contain action (`revise`, `add`, `no-change`, `unresolved`), nullable
document/section UUIDs, reason/update intent (500 characters each), and one to six
operation-local `claim-1`… references. Revise and no-change require a supplied
document; any section must belong to it. Add with an existing document and null
section means a new section; both IDs null means a new document. Blocks lack stable
identity and cannot be targeted. Revise/add require source-supported claims and an
update intent. Insufficient evidence/material contradictions permit only unresolved.

The prompt requires a supported coverage gap before add, positive accuracy evidence
before no-change, explicitly documented internal behavior before internal-only
revision, and unresolved decisions for ambiguous targets. Empty retrieval alone
does not justify add. These semantic judgments are not proved by local validation;
the local checks enforce structure, references and conservative eligibility only.
Plans contain update intent, never replacement prose. Exact saved UUIDs refer to
immutable transformation inputs for future work, not mutable documents or authority.

The complete serialized capability request (instructions, input and output schema)
is capped at 32 KiB UTF-8 before the model call, without truncation. It contains only
projected claims/qualifications and candidate IDs/titles/routes/section markdown;
historical provenance, source reference IDs, artifact/capture identities, DOM and
provider envelopes are excluded. Product/document content is untrusted data.
Cancellation is checked between existing reads and forwarded to generation; the
existing database APIs do not support aborting an already-running query.

Server-owned plan qualifications preserve upstream assessment, contradictions,
uncertainties (including the runtime/revision warning), source coverage and limits.
The claim catalog maps local IDs to original claim indices/claims and evidence refs.
Downstream callers retain the original ProductImpact to resolve those refs through
its original provenance; no second impact identity or duplicated provenance catalog
is introduced. Run `npm run documentation:test` for mocked planning and existing
draft/preparation regressions. Planning has not been live-model verified or wired
into the documentation workflow.

## Canonical v1 representation

`document.ts` owns the typed Zod representation: Document has id, schemaVersion,
draft status, title, associations, sections, context, provenance and generation.
Sections have server-assigned identity, title, kind, association references, derived
finding references, server-preserved qualifications and ordered content blocks.
A block is Markdown plus fact references, intended as one paragraph or short list.
Markdown does not define identity, section boundaries or context associations.
New generations create new UUIDs; saving/loading preserves those identities exactly.

Facts are limited to finding description/before/after, with qualifications. Unknown
values are absent. Context choices are sparse route/feature/workflow/ui-surface/
audience entries with exact values and origin. The model selects IDs only. Operator
labels are not proof of behavior; source audiences/surfaces retain finding origin.
No registry, inferred taxonomy or context hierarchy is introduced.

Provenance chain: block → fact → finding → validated citation. IDs are scoped by
a server-generated analysis snapshot UUID. Only referenced facts/findings/evidence
metadata are retained in the final document, with citation excerpts and global
limitations; full source bodies and patches are not retained. Qualifications are
copied server-side and displayed independently of generated prose.

## Generation and limits

`DOCUMENTATION_DRAFT_INPUT_BUDGET_BYTES` is 32 KiB on the actual serialized input.
Overflow fails before generation without silently dropping facts. Generation uses
8,192 output tokens, at most four sections with two blocks each and 1,500 characters
per block; prompting prefers shorter content. No retries, repair calls or NLP
validator are added. No-change/failed analysis or no usable findings skips generation.
Qualified limited/internal findings can yield a scoped draft.

Unknown references/associations, missing grounding and invalid structures reject
the draft. Reference validation cannot prove prose faithfulness: proposals remain
unreviewed. Inspect for invented steps, commands, certainty or current use of removed
behavior. No automatic publication or acceptance occurs. React Markdown renders
content with raw HTML disabled, no images/headings and only HTTP(S), local absolute
paths and fragment links allowed. No custom Markdown parser or MDX is used.

## Verification

`npm run documentation:test` covers canonical assembly/roundtrip, grounding,
qualification retention, byte limits, one-call behavior, injection isolation,
rejection, and safe rendering. `npm run documentation:verify` performs the real
analysis + generation flow for cb08108 → e321954 with context page/form paths.
Optional arguments: base head followed by explicit context paths. It prints the
proposed draft and bounded provenance, not full source bodies. Requires existing
GitHub/Baseten credentials and uses API credit. Invalid output is withheld.

Deferred: editing UI, document history, workflow wiring of impact targeting, automatic updates,
Markdown export, embeddings and investigation. Explicit publication and SDK delivery
are implemented narrowly below.

Live verification: the existing database comparison (4cf816f → 40bd71f) produced
a three-section draft faithful to supplied create/read and local-setup facts,
with limited-evidence warnings attached server-side. Two source-review runs and
a docs-only run were rejected upstream by semantic citation/schema validation,
so no draft-generation call was made for those attempts. Browser Use was disabled;
the draft route returned HTTP 200 but interactive inspection remains unverified.

## Upstream rejection diagnostics

Rejected semantic results now preserve an `analysisRejection` with a fixed stage/code
and optional zero-based finding/citation positions. The draft screen and live CLI
expose this metadata without logging prompts, raw model responses or source bodies.
Schema mismatch differs from unknown/unavailable evidence, invalid ranges, exact
excerpt mismatch, missing reachability and assessment conflicts. Generation remains
skipped on upstream error; no matching/eligibility rules or retries were changed.

Historical draft-check outputs retained only generic errors: two source-review
failures reached evidence/assessment validation, while docs-only failed output
schema validation. The precise rules for those two old source failures cannot be
reconstructed from the retained metadata. With diagnostics, the same source-review
rerun rejected schema-mismatch; the same docs-only rerun produced a bounded draft
with the limited-evidence warning preserved. No repeatable eligibility bug was found.
Connected regressions prove limited, insufficient-overall analysis with supported
findings remains eligible, and rejected outputs make zero draft-generation calls.

## Persistence and signed saving

`operations.ts` exposes only `saveDocumentationDraft`, `getDocumentationDraft`, and
`listDocumentationDrafts`. Feature operations validate; narrow Drizzle queries in
`integrations/database/documentation-drafts.ts` read JSONB as `unknown`. One entire
canonical document occupies one `docsyde.documentation_drafts` row. Only its ID and
first save time are relational columns; no Project binding or section tables exist.

Same ID + equal JSONB returns the original record and `savedAt`; different content
returns a conflict. No save updates a row. JSONB key order is immaterial and arrays
preserve order. Stable cursor pages sort by save time and ID. Corrupt rows are
unavailable entries containing only row ID/save time; other drafts still list.

`document-validation.ts` checks canonical shape/version, unique identities,
reference closure, retained fact values, copied qualifications, association origins,
section/block and retained-provenance counts, and internal citation ranges. It does
not retrieve sources, repeat excerpt matching, evaluate prose, or rerun analysis.
Validation runs after assembly, before saving and on reads. The named
`DOCUMENTATION_DOCUMENT_MAX_BYTES = 128 * 1024` limits serialized UTF-8 bytes.

`draft-handoff.ts` signs the exact canonical JSON string returned to the preview.
The dedicated save action verifies that exact string with HMAC-SHA256 and
constant-time comparison **before parsing**; it does not reserialize first. The
signature and `DOCSYDE_DRAFT_SIGNING_KEY` stay outside the canonical document.
Set a server-only key of at least 32 random characters in `.env`; missing signing
configuration disables saving while leaving generation available. A changed key
invalidates unsaved handoffs but cannot affect saved documents. No handoff cache,
token system, authentication infrastructure or signing dependency is introduced.

`/documentation/drafts` and `/documentation/drafts/[id]` use database operations and
the existing inspector/Markdown renderer, with no runtime AI/Source integration.
They need PostgreSQL only. Lazy database initialization keeps unrelated routes and
production builds usable without database configuration. Loading never falls back
to generation. Keep this developer/demo UI local, as with the existing draft flow.

Apply migration `0001_persist-documentation-drafts.sql` with `npm run db:setup` or
`npm run db:migrate`. Run `npm run documentation:persistence:test` against the local
database for signed-save/reconnect/full-roundtrip/repeated-render, concurrent retry,
conflict, pagination and corruption checks. Tests remove only their own UUID rows
and compare Projects before/after. External HTTP is blocked and provider credentials
are removed. `npm run documentation:persistence:verify` leaves one labeled fixture;
`npm run documentation:persistence:verify -- <id>` reopens it after restart. Neither
command spends model credit. The live generation verifier above still does.

The shared reader presents the draft as a document with section navigation, saved
status and readable typography using existing shadcn/Tailwind styles. Sources and
confidence, evidence limitations and developer JSON are expandable. Actual
assumptions/uncertainties remain visible next to affected sections. This is display
only: saved canonical content, identities, provenance and safe Markdown are unchanged.

The saved-document help center uses shadcn’s neutral dark theme, a document sidebar
with a filter over the latest loaded titles, and section navigation. Mobile navigation
is collapsible. The generation prompt favors task-oriented help; analysis may retain
up to four focused findings with supported UI labels. Existing documents remain unchanged;
use a fresh generation to evaluate the updated writing instructions.

Repository context: the draft screen offers an optional saved product note (500
characters) and optional run note (300). Sources owns the setting; narrow Drizzle
queries store it in `docsyde.repository_contexts` (migration 0002). Provider
coordinate validation/location and access checks share trimmed, case-insensitive
GitHub identity. Existing draft provenance is never rewritten. Empty notes become
null; nonempty notes retain their exact whitespace. With no DATABASE_URL configured,
no repository context exists; database read failures otherwise remain explicit.
A frozen pair is read once before analysis and passed separately as advisory data
to both calls under unchanged budgets. New draft generation metadata records both
values (or null); historical drafts retain absent fields. Saving run context never
updates the repository setting. Save/update/clear use explicit controls; selection
changes discard stale form responses. Context cannot establish behavior or bypass
citations. Reopening a draft reads only historical JSON. Run
`npm run documentation:context:test` for isolated PostgreSQL/mocked-provider checks.
These tests establish plumbing and boundaries, not universal factual correctness.

Live context check: the Request Desk baseline comparison with the documented support-
staff context and creating/closing focus rejected finding 0 with
`evidence-validation: missing-reachability-evidence`. Draft generation was skipped;
no retry, repair or validation relaxation was performed. No context-enabled draft
is available from that attempt for a qualitative before/after comparison.

## Explicit contextual publication (local demo)

Saving remains separate from publication. A publication row references an immutable
saved document; canonical JSON and its first-save timestamp never change. The saved
reader provides Check target, Publish, explicit Replace and Unpublish controls.
Targets are exact case-sensitive pathnames (max 300 characters). Only ASCII letters,
digits, `.`, `_`, `~`, `-` and segment separators are accepted; dot segments,
patterns, encodings and trailing slashes except `/` are rejected. Query/hash are
excluded from host matching. The proof target is `/requests/new`.

Migration 0004 adds `docsyde.documentation_publications`: UUID, existing canonical
repository identity, route, saved-draft FK, publication time; repository/route is
unique. Row existence means published. Same-document publishing is idempotent.
Replace/unpublish require the observed publication UUID; replacement changes the
association UUID/time and FK atomically. No history, content copy or status exists.

`publication-operations.ts` owns validation, repository allowlist enforcement and
host-visible projection. `integrations/database/documentation-publications.ts`
owns SQL. `GET /api/documentation/context?owner=...&repo=...&route=...` returns a
version-1 structured delivery DTO or a normal `publication: null`. Invalid persisted
content fails closed. No draft search, AI, source fetch or semantic fallback occurs.
Sections retain ordered blocks with the existing Markdown field; the DTO excludes
provenance, excerpts, generation and advisory/debug metadata. Visible qualifications
and limitations remain. `DOCSYDE_HOST_ORIGIN` permits exactly one read-only local
browser origin with no credentials; it is not user authentication. Repository and
host context are not authorization credentials. Keep the service local.

The dependency-free SDK retrieves explicitly and supports cancellation. Request
Desk owns a minimal DOM help surface and displays all Markdown blocks consistently
as escaped plain text. No highlighting, widget framework or Markdown parser is added.
No-store retrieval happens on help open and context changes; close/reopen or refresh
observes unpublish. Previously delivered browser content is not remotely recalled.

Run `npm run documentation:publications:test` with local PostgreSQL. It cleans only
its own fixture UUIDs, blocks external fetches, removes provider credentials, and
checks lifecycle, isolation, immutable snapshots, projection and CORS. Delivery
never creates or regenerates a suitable document for a demo proof.

## Static and runtime evidence status

The current orchestration in `generate-documentation-draft.ts` freezes advisory
context, calls Sources semantic analysis, and generates a new draft from validated
source findings. It does not retrieve existing saved documentation for analysis,
request runtime inspection, call vision, or merge screenshot/DOM evidence. Saving
and publication are explicit; publication replacement changes the saved-document
reference rather than editing its content. The intended combined-evidence flow and
planned implementation steps are recorded in [MODEL_USAGE.md](../../../MODEL_USAGE.md).
