# DocSyde Architecture

## Purpose

DocSyde keeps product documentation synchronized with the software itself.

It should understand meaningful product changes, determine which documentation is affected, update that documentation, and surface it contextually inside the application.

The core flow is:

**Product change → contextual signals → semantic understanding → documentation impact → updated documentation → in-product presentation**

The system should optimize for a clear hackathon demo and a credible architecture rather than production-scale complexity.

---

## Architectural Principles

### Incremental integration

Major capabilities should be proven independently before they are combined into larger workflows.

Prefer small working vertical slices with clear inputs and outputs.

Do not build large orchestration layers around integrations that have not yet been independently verified.

### Clear boundaries

Keep these concerns conceptually separate:

- Application/domain logic
- Persistence
- External AI/model providers
- Repository and Git inspection
- Runner/runtime functionality
- SDK/client integration
- Demo/sample application
- UI/presentation

Code may live in the same repository, but responsibilities should remain distinct.

### Local-first where practical

Infrastructure should be self-contained when possible so the project is easy to run and review.

External services should only be required where they provide meaningful functionality that cannot reasonably be included locally.

Secrets and environment-specific values belong in `.env`.

### Provider independence

External providers should be isolated behind clear boundaries where doing so provides real value.

Core DocSyde logic should not be tightly coupled to one model vendor, persistence vendor, or runtime mechanism.

Do not introduce abstraction merely for theoretical flexibility.

### Structured AI outputs

Prefer typed, structured outputs from models rather than free-form text when the result is consumed programmatically.

Validate generated structures before using them.

Text-provider formatting is handled at the AI integration boundary. Eligible Baseten
Muse Spark Open calls use native strict JSON-schema output outside the prompt, then
strict JSON parsing, unchanged Zod validation and feature grounding. Provider model/
schema capability selection is centralized; opaque/open schemas, unlisted models or
explicit prompt compatibility mode retain conservative JSON
extraction, operation-specific model-facing projection, then unchanged strict canonical
validation and feature-owned grounding. Native calls never retry or downgrade after
a failed request. In compatibility mode at most one logged format-only retry is allowed;
truncation and semantic failures never retry, and explicit single-attempt experiment
budgets remain single-attempt. See the [boundary policy](src/integrations/ai/structured-output-boundary.md).

---

## Core Components

### Application/Core

Owns DocSyde's product-level logic.

Responsibilities include:

- Understanding what a change means to the product
- Determining documentation impact
- Coordinating already-proven capabilities
- Applying business rules around documentation updates
- Working with structured representations rather than provider-specific APIs

The application layer should not directly depend on Baseten, Git CLI commands, database drivers, or UI frameworks.

---

### Persistence

Stores DocSyde state and structured documentation data.

The persistence implementation should remain separate from application logic.

Likely persisted concepts include:

- Projects
- Documentation
- Documentation sections
- Associations between docs and product context
- Analysis results
- Source/provenance information
- Change history
- Runtime or route metadata where appropriate

For the hackathon, prefer local PostgreSQL through Docker Compose.

Do not depend on Supabase-specific features.

The first implemented slice uses local PostgreSQL 17 in Docker Compose, a named
volume, and Drizzle ORM with `pg`. Local service configuration lives under
`infra/local`, with PostgreSQL setup and verification entry points under
`infra/local/postgres`. `npm run db:setup` is a repeatable infrastructure step
that a future repository setup script can invoke. Root `.env` selects the Compose
file; an explicit Compose project name preserves the existing named volume.
Application tables live in the dedicated `docsyde` PostgreSQL schema and ORM
queries qualify that schema explicitly. The client, physical schema, SQL queries, and
versioned migrations live in `src/integrations/database`. Project application
types and validation live in `src/features/projects`; application operations call
narrow persistence functions without using driver or ORM APIs. This keeps the
persistence implementation separate without adding a generic repository layer.
The local `npm run db:verify` CLI exercises create/read through those operations;
no HTTP endpoint, authorization system, or Project UI is implemented in this slice.

---

### Model Providers

Model providers are responsible for communicating with external AI services and translating provider-specific responses into DocSyde-friendly structures.

Examples include:

- Baseten
- Meta-hosted models
- Other model providers added later if useful

Application code should depend on a model capability or provider boundary rather than directly embedding provider-specific HTTP logic throughout the codebase.

Different tasks may eventually use different models.

The intended allocation is Muse Spark Open through Baseten for semantic reasoning
and inspection decisions, local runner + Playwright for scripted evidence capture,
and a Meta Model API multimodal model for visible screenshot evidence. Feature
orchestration should reconcile static/runtime evidence and relevant existing docs
before proposing documentation impact and updates. Models do not own process
launch, capture policy, publication or resource authorization.

Historical source-to-draft behavior is retained for standalone tools and legacy rows.
Schema-v2 orchestration is described below. Baseten serves source summaries, bounded
semantic analysis, planning and transformation. Independent
inspection decisions, source/visual synthesis and saved-document impact planning
also exist. The local runtime visual-evidence CLI now composes a scripted workflow,
post-run checkpoint selection, Meta vision, synthesis and planning. Schema-v2 runs
now compose these capabilities automatically when configured.
The provider-neutral APIs isolate HTTP details but each currently selects one
provider internally, without automatic fallback. See [MODEL_USAGE.md](MODEL_USAGE.md)
for code references, model defaults, limits, gaps and planned connection steps.

---

### Repository / Git Integration

Responsible for extracting structured source-change context.

Potential responsibilities include:

- Changed files
- Diffs
- Commit metadata
- File contents
- Relevant surrounding code
- Previous/current versions
- Repository metadata

This layer should describe what changed in the source repository.

It should not be responsible for deciding what the product change means or which documentation should change.

That semantic interpretation belongs in application/model-driven logic.

The first implemented provider slice is a read-only GitHub adapter under
`src/integrations/github`, using Octokit and `GITHUB_TOKEN`. It resolves base/head
refs to immutable commits, returns normalized change evidence, and separately
reads text files at pinned commits. The result types are plain, provider-neutral
TypeScript structures colocated with their first producer; no Octokit response
types escape the integration. GitHub is one provider, not the core source-change
abstraction. A future local Git provider can produce equivalent evidence without
implementing GitHub payloads; no provider registry or broad abstraction is added.

Comparisons require ancestor-to-descendant history, paginate commit metadata,
and fail rather than claim completeness at GitHub's 300-file comparison cap.
Patch availability is explicit and distinct from file-list completeness. File
reads inspect Git tree modes and support regular UTF-8 text up to 1 MiB, with
explicit unsupported results for binary content and other file types. The local
`npm run github:verify` CLI lives under `infra/local/github`. This slice adds no
model analysis, persistence, user-facing endpoint, local Git provider, or runner.

---

### Runner

The runner operates locally alongside the user's project.

It can inspect context that a remote service would not naturally have access to.

Potential responsibilities include:

- Inspecting the repository
- Reading Git state
- Reading application/runtime context
- Launching or interacting with the demo application
- Capturing screenshots or contextual UI information
- Sending structured context to DocSyde
- Executing local analysis steps when appropriate

The runner should not contain the core DocSyde business logic.

It acts as the local bridge between the project being documented and DocSyde.

---

### SDK

The SDK is the integration surface used by the host application.

Keep it thin.

Potential responsibilities include:

- Registering route or feature context
- Exposing contextual documentation hooks
- Communicating with DocSyde
- Rendering or requesting documentation associated with the current application context

The SDK should not contain model orchestration, Git analysis, or persistence logic.

---

### Documentation Model

Documentation should be structured enough to connect content with the product.

Do not treat documentation solely as arbitrary Markdown files.

Useful associations may include:

- Route
- Feature
- Workflow
- UI element
- Page
- Section
- Source file
- Product capability
- Runtime context

Markdown or rich text may still be used for content, but metadata should make the documentation context-aware.

---

### Visual Analysis

Visual context can be used as an additional signal when understanding the product.

Potential sources include:

- Screenshots
- UI regions
- Runtime page state
- Visual changes

Visual analysis should complement Git, code, runtime context, and existing documentation.

It should not become the sole source of product understanding.

---

### Demo Application / UI

The demo application exists to make the DocSyde workflow obvious.

It should be simple enough that a reviewer immediately understands:

1. What the application currently does
2. What product change occurred
3. What documentation became outdated
4. How DocSyde detected the impact
5. How the updated documentation appears in context

Do not spend excessive effort building demo-product functionality unrelated to demonstrating DocSyde.

---

## Semantic Understanding

DocSyde's primary value is understanding what a software change means to the product.

For example, a code diff may indicate that a button was added.

The useful DocSyde interpretation is not simply:

> A button was added.

It should instead reason about things such as:

- What capability the button introduces
- Which workflow changed
- Who encounters it
- Which existing documentation became incomplete
- Whether a new documentation section is required
- Which application context should surface the updated documentation

Git, code, runtime context, screenshots, and existing docs are inputs to this understanding.

None of them independently define the product meaning.

---

## Dependency Direction

Prefer dependencies flowing toward core application concepts.

For example:

**UI / Runner / Provider / Persistence implementations → application interfaces and structured domain concepts**

Avoid allowing application logic to become dependent on:

- Database-specific APIs
- Baseten-specific request objects
- Git CLI output formats
- Browser automation APIs
- Demo UI components

Provider and infrastructure implementations should translate external concerns into structures that the application can understand.

---

## Implementation Guidance

Before adding a new capability:

1. Determine which architectural component owns it.
2. Check whether an existing abstraction already represents that boundary.
3. Implement the smallest working slice.
4. Verify the integration independently when practical.
5. Only then connect it to broader orchestration.

Prefer concrete code and observable behavior over speculative architecture.

If a new abstraction does not make a current boundary clearer, it probably does not need to exist yet.

---

## Architecture Changes

This document is the architectural source of truth for the repository.

When an intentional architectural decision changes:

- Update this document.
- Remove obsolete assumptions.
- Keep `AGENTS.md` generic so it continues directing coding agents back here.

Previously rejected technologies or patterns should not be reintroduced silently.

If a new requirement appears to conflict with this architecture, discuss the conflict before restructuring the project.

## Independent capability proofs

This section records the initial proofs; the connected workflows below and
[MODEL_USAGE.md](MODEL_USAGE.md) describe subsequent implementation status.

The remaining infrastructure slices are now implemented independently:

- `src/integrations/ai`: narrow text-only `generateStructured` capability with
  Baseten transport, JSON parsing, local Zod validation and sanitized failures.
  The event model is configurable; native schema enforcement supplements, but never
replaces, application validation.
- `src/integrations/local-git`: committed comparisons and pinned file reads using
  type-only reuse of the existing neutral GitHub evidence definitions. No GitHub
  type relocation or provider registry is introduced.
- `src/runner/runtime`: explicit local launch/attach, readiness, runtime identity,
  and direct-child cleanup using Node APIs, without process-group assumptions.
- `src/sdk`: dependency-free host context registration and an inert JSON DOM
  bridge. No documentation delivery API or embed UI exists yet.
- `src/integrations/browser`: caller-scripted Playwright capture. PNG screenshots
  are visual evidence; DOM text, regions, headings and SDK metadata are runtime
  evidence. This layer does not interpret either kind of evidence.

Verification CLIs live in corresponding `infra/local` directories. Test fixtures
are not product/demo implementations. Generated artifacts live under ignored
`.artifacts`. All five slices use existing dependencies, and none adds persistence,
application HTTP routes, source-to-model wiring, semantic interpretation, or
orchestration. Application/feature ownership of documentation impact, generation,
review, publishing, and contextual delivery remains future work. Runtime-to-commit
provenance is not inferred by these infrastructure proofs.

## Completed runtime visual-evidence slice

The explicit local `runtime:visual:verify` CLI now composes one caller-scripted
workflow with bounded checkpoint capture, post-run text selection, selected Meta
vision analysis, existing Sources product-impact synthesis and existing Documentation
impact planning. It consumes an already validated source result and trusted local
workflow configuration; it does not generate browser actions or mutate documentation.
The standalone change-to-draft workflow remains source-only; schema-v2 runs use the workflow below.

`runner/runtime/capture-workflow.ts` owns one launch/attach and cleanup lifecycle;
`integrations/browser/capture-trace.ts` owns Playwright sampling, masked screenshots
and provider-neutral trace structures. No models run during browser execution.
Sources owns sanitized state grouping/deduplication, the single selection call,
reference/budget validation and sequential vision orchestration. Images use existing
ArtifactStorage; the CLI also stores ordinary JSON manifests there, without adding
a run repository, database schema or persistence service. Runner imports no features;
Sources imports no `infra/local` implementation.

The inference image budget is integer 0–3, default 3; zero disables selection/vision.
One completed eligible trace produces one selection call, with a 32 KiB request
bound and declared deterministic compaction. Default local limits are 12 checkpoints,
32 states, 32 MiB of unique image bytes and 120 seconds. Exact PNG hashes and
sanitized semantic state/crop fingerprints remove redundant candidates. Stored image
hashes are verified before vision transmission. Editable values are excluded/masked;
configured required masks fail closed. Controlled local data and explicit non-input
masking remain necessary; no universal secret/prompt-injection detection is claimed.

Selection links are relevance metadata only. Existing RuntimeVisualEvidence and
source/visual synthesis retain temporal, contradiction and runtime-revision limits;
documentation revise/add still needs source support. Invalid selection, failed vision,
missing artifacts and cancellation produce explicit incomplete outcomes; the CLI
does not synthesize those partial results. No automatic retries or repair models run.
No SDK changes, database migration, live stream, replay, autonomous browser agent,
or expansion of request-bound run deadlines is included. Earlier independent capture
proof descriptions remain applicable to their compatibility APIs, not this new path.

## Connected Sources workflows

Sources now implements GitHub change summaries, pinned selected-file review, and
semantic product-change interpretation in the existing modular monolith. Semantic
analysis composes normalized comparison evidence and pinned context through the
existing structured-model capability. Feature operations own authorization, coverage,
limits and evidence validation; GitHub and Baseten implementations remain isolated.
This supersedes earlier descriptions of source-to-model wiring as entirely planned.
Documentation generation/mutation, persistence of analyses, runtime orchestration,
and contextual delivery were outside that Sources slice. Draft generation,
persisted run snapshots and narrow contextual publication/delivery are implemented
as described below. Schema-v2 orchestration now connects runtime evidence and
targeted existing-document proposals. No architecture boundary has moved.

## Canonical documentation drafts

Canonical v1 remains readable and is still produced by the source-to-draft path.
The targeted transformation capability now emits canonical v2 candidates for
immutable revisions. V2 preserves the same content model and flat reference graph,
adding bounded evidence contexts owned by findings/evidence and separate revision
provenance (current context, baseline UUID/hash, plan hash, applied decision IDs).
Historical comparisons are retained for unchanged content; document-level revision
metadata does not reattribute every statement to the latest comparison. V2 is
self-contained and requires no history traversal, version family or new service.
Migration 0005 widens only the existing JSONB envelope constraint to versions 1/2;
there is no backfill or rewrite of historical rows.

Documentation owns `transformDocumentation`: validate impact/plan correspondence,
load exact immutable targets, assign per-decision authority, batch structured generation,
validate entries independently, check newly authored wording and materialize typed
patches into canonical candidates. Exact subset partitioning minimizes calls within
32 KiB requests, 128 KiB aggregate input and bounded output capacity. Typical work
uses one generation plus one bounded support check; worst case eight plus one.
No-change/unresolved use neither. No repair loops run. The support checker cannot
reconsider targeting, old content/provenance or upstream mutation eligibility.

The proposal boundary distinguishes generation, support, review readiness, canonical
save compatibility and approval. Normal section revisions/additions and document
replacement produce validated v2 candidates; ambiguity, conflicts, incomplete checks
or genuine bounds block materialization. Local verification and schema-v2 runs
compose this same operation; mocked integration proofs exercise its boundaries.
Transformation performs no signing, approval, save, publication or publication replacement.
Existing persistence/publication tests cover v1/v2 compatibility through explicit
operations; they do not imply that transformation invokes those operations.

`features/documentation/document.ts` owns canonical structured documentation v1/v2.
Document/section UUIDs, explicit context associations and bounded provenance are
independent of Markdown, which is content only. Draft blocks reference semantic
facts/findings and their validated citations; server assembly preserves uncertainty.
Documentation calls Sources through a narrow entry and uses the existing structured
AI boundary for one generation call. The local demo composes analysis + generation
in one request. Drafts remain unreviewed; explicit saving now persists one complete
canonical document per JSONB row in `docsyde.documentation_drafts`, with the existing
document UUID and a separate first-save timestamp. Sections, associations and bounded
provenance remain structured JSON, preserving identities without normalization or a
Project binding. Saves are immutable and idempotent by PostgreSQL JSONB equality.

Documentation's three persistence operations validate canonical graph integrity on
write/read and call narrow database queries; database JSON enters the feature as
`unknown`. Corrupt rows are isolated during listing. A documentation-specific HMAC
handoff authenticates the exact generated preview string before save parsing, with
signing metadata outside the canonical document. This does not add authentication.
Saved list/detail routes use persistence and the existing renderer independently of
AI, semantic analysis, GitHub/source retrieval and signing credentials. Lazy database
initialization remains intact. Targeted planning/transformation and narrow publication/
SDK delivery are implemented independently as described here. Editing UI, version-family
history and polished review UI remain deferred; schema-v2 run orchestration and
retained model-free review/save are described below.

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

## Product overview and navigation

Slice 1 adds overview, recent GitHub changes, and repository-scoped saved-draft
library routes. Sources validates configured repository selection and owns narrow
browsing operations; GitHub normalizes repository metadata and recent commits.
Documentation filters existing provenance in SQL before pagination and supports
scoped detail reads. No Project binding or schema migration is added. The existing
reader and technical source tools remain available. Run persistence and execution tracking are described below. Existing-document
updates remain deferred.


## Schema-v2 analysis runs

New runs use Documentation-owned composition: pinned source analysis → runtime
availability/decision → optional single-workflow capture/selection/vision → one
ProductImpact → one documentation-impact plan → conditional transformation → trusted
proposal retention. New execution never calls `createDraftFromChanges`, generates a
legacy v1 draft, approves, saves or publishes. Standalone draft tools and historical
unversioned run records remain supported; legacy pending runs require a new attempt.

`run-record.ts` distinguishes lifecycle, active stage, stage outcomes and final
`awaiting-review`, `no-change`, `incomplete`, `failed`, `cancelled` or `interrupted`
dispositions. Empty comparisons finish `no-source-differences` without inference;
planner-derived documentation accuracy finishes `documentation-unchanged`. Unresolved
plans skip transformation. Mixed plans preserve every decision and may retain a
partially review-ready proposal. Unsupported/uncertain results are incomplete;
technical failures are failed. Intermediate checkpoints survive later failures.

`run-coordinator.ts` owns one active task on `globalThis` in a single long-lived
local Node application process. POST execute reserves the slot, serializes short
PostgreSQL admission with a transaction advisory lock, claims an ownership token,
starts the application-owned promise and returns 202. A different run gets 409;
there is no queue. Neither Next.js `after()`, route duration nor client connection
owns execution. Request disconnect does not cancel work. Runner remains the only
owner of launch/attach/browser cleanup; the slot releases after workflow cleanup
and pending control operations settle. No new runner host/process is introduced.

Heartbeat is 10 seconds, control polling 2 seconds, stale threshold 60 seconds,
renewal-failure abort 30 seconds, maintenance reconciliation 15 seconds. An independent
40-minute application deadline aborts work; it does not extend HTTP lifetime.
Initialization is lazy on first run API access, followed by explicit reconciliation
and maintenance; ordinary subsequent GETs are read-only. Reconciliation also runs
before admission. It persists interruption only for stale running executions without
a matching local owner, using guarded row updates. Fresh orphaned execution blocks
admission until stale. Every checkpoint verifies the execution token; cancellation
and heartbeat merge under short row locks without replacing newer stage outputs.

This is self-hosted hackathon execution, not durable job infrastructure. Process
termination can interrupt runs and abrupt termination cannot guarantee child/browser
cleanup. A restart never resumes inference. Pre-retention failures require an explicit
new run (and may repeat paid calls); retained completed runs reopen without models.
Multiple application processes/serverless hosting are outside this boundary.

Trusted operator configuration binds one workflow to a canonical repository, ID,
version and supported pathnames. It reuses Runner's workflow configuration schema;
HTTP cannot provide executable configuration. Only descriptor/hash enters the run.
Availability checks can skip semantic inspection decision when execution is unavailable.
Runtime distinguishes not-needed, unavailable, requested-but-uncovered,
attempted-and-failed and completed. Useful but unavailable/uncovered inspection may
continue source-only with bounded server-owned coverage context in impact provenance,
planning qualifications and transformation/retained limitations. It is never evidence
or authority. Attempted incomplete runtime evidence stops synthesis. No per-target
legacy executor or autonomous browser actions are used.

Existing run JSONB stores bounded source evidence/hash, impact/plan, stage/model
metadata, runtime artifact references and compact transformation/retention summaries.
It contains no screenshots, executable secrets, complete retained proposal or duplicate
canonical candidates. No migration is required. `documentation_proposal_reviews`
remains proposal authority. Admission and review-row insertion/idempotent verification
plus final run linkage commit transactionally; failed retention cannot claim awaiting
review. Review/save/publication remain separate explicit human operations.

The implemented read-only inspection slice described below copies existing eligible
masked checkpoint PNGs. It adds no screencast or additional screenshot capture.

## Explicit publication and contextual delivery

Documentation now owns explicit publication of already persisted immutable drafts.
A single `documentation_publications` association stores UUID, the existing shared
canonical repository identity, exact pathname, draft FK and timestamp. Its unique
repository/pathname key permits one active association; row existence is published.
Saving stays separate. Same-document publication is idempotent, explicit replacement
atomically changes the reference and publication identity/time, and unpublish deletes
only the association. Observed publication UUIDs protect replace/unpublish against
stale writes without a general concurrency layer. Canonical draft JSON/status and
saved timestamps remain unchanged. A publication-history association now retains the
retired publication UUID, route, draft reference, original publication time and archive
time. Replacement and unpublish archive the observed association in the same
transaction as the active-link mutation. No canonical content is copied; stale and
idempotent requests do not create history. Earlier retired associations cannot be
reconstructed from saved snapshots.

Feature operations enforce the existing repository allowlist through Sources' narrow
repository-access entry, validate saved documents and derive a versioned host-only
structured DTO. Database integration owns SQL; a read-only route exposes deterministic
repository/pathname lookup with no-store responses. No models, generation, source
retrieval, unpublished-draft search or semantic fallback are used. Exact matching
excludes host query/hash and rejects trailing slashes except `/`, encodings, dot
segments and patterns. Dynamic route targeting remains unimplemented.

The dependency-free SDK adds explicit retrieval and cancellation, retaining existing
HostContext metadata semantics. Request Desk in the separate test-project worktree
owns an escaped-plain-text help surface, using `/requests/new` as the static proof.
One explicit `.env` host origin enables read-only local CORS without credentials or
a public authentication redesign. The original baseline/tag and host product behavior
are preserved. SDK build output is copied into ignored host artifacts for this proof.
Earlier descriptions of publishing/SDK delivery as deferred are superseded only by
this narrow slice; broader embed UX, editing and semantic retrieval remain deferred.

## Deterministic retained proposal review

Documentation now owns trusted proposal retention, explicit per-decision review,
approved-subset rematerialization, immutable save and optional contextual publication
replacement. This supersedes references above to transformation review/save being
entirely deferred; polished UI remains deferred; schema-v2 orchestration now retains proposals as described above.
Transformation itself still has no persistence/publication side effects.

Migration 0006 adds only `documentation_proposal_reviews`: immutable authority JSON
and normalized hash, canonical repository, 24-hour initial expiry, server-derived
publication descriptors and bounded frozen selection/receipts. Independent proposals
do not fit the strict running-only run-result schema. No signing, version families,
authentication tables, workflow engine or event store is introduced. Trusted direct
producer output is admitted through deterministic graph/candidate/support checks;
unsigned artifact/client proposal upload is not an authority boundary.

Review's model-free Sources evidence entry exports schemas/validation without loading
inference capabilities. First acceptance freezes a normalized selection and operation
UUID. Baseline groups are rematerialized from approved patches only, keeping original
evidence contexts and using stable operation/subset candidate identities. Canonical
V1/V2 semantics and existing grounding restrictions remain unchanged.

Database integration owns review row locks, transaction-aware immutable insert/equality,
exact baseline reads, publication insert/observed-ID+baseline CAS and receipts. Features
receive narrow transaction operations, never ORM executors. Save+receipt is atomic per
independent document; publication+receipt is a later independent transaction. Publication
conflicts retain successful saves and old immutable snapshots. Replay consults receipts;
changed selections conflict, no rebase/model retry occurs. Cancellation stops new units.
Repository allowlisting remains trusted-local authorization, not multi-user identity.
The local CLI is the integration surface; SDK/contextual delivery remains unchanged.

## Deterministic planner candidate selection

Documentation now defines a typed, read-only section-context projection: immutable
snapshot UUID/hash + section UUID, existing purpose enum, titles/text, and existing
route/feature/workflow/UI-surface/audience associations. Explicit associations retain
operator identity; inferred associations resolve to their supporting finding and
v1 analysis or v2 evidence-context identity. No new labels or inferred classifications
are generated or persisted. Publication/current state remains in its existing separate
boundary; recency, publication and UUID ordering confer no targeting authority.

A derived PostgreSQL JSONB search projection matches exact case-sensitive association
kind/value pairs and bounded lowercase ASCII word overlaps. Only up to 41 hit identities
leave SQL. At most ten documents/40 matching sections are admitted; all eligible hits
within those bounds are retained, including ties. Validated snapshots are loaded
through existing operations, and local matching recomputes scores/explanations. Full
section outlines/text of selected documents still enter the bounded planner call.

Scoring is fixed: association 40, each matching document-title word 2, section-title
word 3, body word 1. Text-only eligibility needs two distinct title words (across
both titles) or three body words. Query words are distinct, stop-word filtered,
3–40 ASCII characters, capped at 24; query associations are capped at 20. No stemming,
embeddings, semantic ranking or ranking model is used. Nonmatching/unsupported text
can fall back to broad loading rather than guessing semantic similarity.

The validated selection result records selected document UUIDs, matched section
UUIDs/snapshot hashes, scored reasons, coverage and broad-fallback usage. Zero useful
hits use the unchanged complete broad-loading path and its integrity/completeness
checks. Search-selected coverage never means corpus-complete. Too many plausible
matches return typed incomplete selection without silently cutting competitors; runs
finish semantically incomplete before planner inference. Storage/validation failures
do not masquerade as an empty search. The planner receives coverage/relevance hints
but still owns semantic targeting and must leave unjustified ambiguity unresolved.

Selection metadata is not evidence and cannot justify revise/add/no-change or prove
missing documentation. Existing grounding, exact targets, 32 KiB request bounds and
human review remain intact. Server-owned selection is optional on retained plans for
legacy compatibility; selected target hashes are rechecked by transformation/retention.
No migration, materialized index, taxonomy service, navigation restructure, new model
call or SDK retrieval change is introduced. Physical indexing can follow measured need.

## Application navigation and run preparation

The application now uses an icon sidebar for Overview, Your runs, Documentation,
and AI/MCP. Overview is explanatory and performs no provider/data reads. Existing
source tools and commit pages remain secondary destinations. Shared presentation
lives in `components/application`; routes compose feature-owned operations.

`/runs/new` is a compact demo form: branch, latest-change headline, optional run
context and Start run. Sources owns automatic selection of the branch with the
newest tip commit, using a GitHub-owned paginated GraphQL read (up to 1000 heads;
ties prefer the repository default branch). Explicit branch choices override it.
The selected branch’s latest commit headline supplies the short change summary;
changing branches updates that text locally without inference or another button.

Submission, rather than page rendering, resolves the selected branch and performs
the existing bounded comparison checks. It pins the current tip and its first
parent before creating the schema-v2 run. Client input cannot supply comparison
revisions, source paths or association catalogs through this demo action. Technical
source tools retain their existing explicit controls. Saved product context is still
captured by the workflow; the visible Context field supplies the optional run note.
Reruns retain their original pinned comparison/context and cannot execute while
active. Whole-project initial analysis, automatic baseline advancement and full
reanalysis remain unimplemented; this UI change does not change the evidence model.

Documentation has fixed-header Latest, Pending and Archive segments. Latest renders
the newest persisted draft in the selected repository. Pending includes only
unaccepted, unexpired retained proposals with actionable review-ready changes.
Archive lists recorded retired publications and renders their immutable snapshots.
Latest and archived readers share a feature-owned three-column workspace: a
searchable document navigation derived from actual document titles, a bounded
article viewport beneath its breadcrumb, and section jump navigation. Mobile uses
the existing dialog primitive for documents and a compact section disclosure. No
synthetic categories or document splitting are introduced; canonical content and
publication semantics are unchanged. The application shell supplies a generic
workspace layout slot while feature UI owns article scrolling and navigation.
Documentation-owned operations authorize repository scope and validate canonical
identity; database integration owns ordered queries and pagination. Proposal previews
are readable in the browser; acceptance/save continues through the existing CLI.
Existing publication controls remain available through saved document readers.
AI/MCP documents the implemented read-only endpoint/SDK and identifies the MCP server
as planned. No inference, publication, SDK, runner, or coordinator boundary changed.

## Run navigation and public failure diagnostics

Run history uses a repository-wide table with branch, pinned comparison, outcome,
start time and duration. History is repository-wide, with no branch selector or
branch label in its page header. Fresh Start run links choose the latest branch
automatically and the setup form permits manual override. Breadcrumbs connect setup,
comparison, execution, evidence, source details and review. Active comparisons can
be inspected without permitting another execution; the retry action still rejects
active attempts. Proposal breadcrumbs verify their originating run association.

Schema-v2 payloads optionally retain `failure: { stage, code }` from a fixed enum.
Documentation classifies known source/model/validation/database failures without
copying exception messages, SQL, stacks, credentials or provider bodies. Terminal
summaries and the failed stage use fixed public text; machine-readable `reason`
codes remain separate. The status projection includes the diagnostic, and the UI
adds a fixed recovery suggestion. Existing rows remain readable without migration;
older failed records explicitly report that no detailed cause was retained.
Source-returned model rejections and evidence-budget failures are classified too.
Execution admission, checkpoints, cancellation and review authority are unchanged.

## Read-only AI responses in the run timeline

The run status projection supplies bounded response previews and availability per
stage. Source analysis, inspection decisions, product impact and documentation
planning are projected from their existing validated run outputs. Runtime analysis
loads the saved manifest through its trusted artifact UUID and verifies its SHA-256
before projecting selection and vision results. Documentation generation loads the
retained proposal, checks repository/identity/hash correspondence, and projects
its authored changes and support verdicts without exposing complete canonical
candidates, baseline documents or authorization catalogs.

`GET /runs/<id>/responses/<stage>` is an authorized, no-store read of existing data.
It performs no inference, generation, acceptance, save or publication operation.
Full responses are bounded to 256 KiB and fetched only for the displayed output stage;
normal status polling carries only the short previews. Two optional bounded display
fields retain runtime/generation excerpts for inexpensive previews. These excerpts
are presentation metadata and never model input, evidence or authority. Existing
rows require no migration and can show unavailable output where nothing was retained.

The output panel renders validated task results as escaped text. Provider transport bodies,
prompts, source bundles, executable workflow settings and rejected model output are
not displayed. Deterministic results are distinguished from AI responses. Results
appear after their checkpoint is saved; token streaming is not introduced.

## Application viewport scrolling

The root layout fills the dynamic viewport and prevents body scrolling. AppShell
keeps its repository header outside an independently scrollable main region; the
application sidebar/mobile navigation remain stationary. Legacy standalone routes
use the root content viewport as their scroll fallback. The document reader uses a
fixed grid with separate article/navigation scroll regions and content-relative
anchor offsets. Page scroll pacing targets the marked content viewport, leaving
nested code blocks, dialogs and navigation scrollers native. Layout changes add no
product, persistence, provider or execution responsibilities.

## Pipeline and output workspace

The feature-owned run monitor presents a selectable pipeline beside a sticky output
panel on desktop, stacked on mobile. It follows the running stage by default;
manual selection holds that stage until Follow pipeline is selected. Terminal runs
prefer the failed/incomplete/cancelled stage or the last completed stage. The right panel displays only the
selected stage: a thinking indicator for active AI work, a capture indicator for
runtime inspection, a one-line description for deterministic steps, or the saved
AI result when complete. It does not repeat pipeline labels or retain previous-stage
output. Runtime inspection has no live browser stream; the UI shows capture activity
and existing validated results only. Selecting a stage fetches
only its existing response through the authorized no-store endpoint; requests abort
on selection changes, and polling does not refetch an unchanged available result.
Responses remain escaped, bounded, checkpoint-based results with explicit loading,
retry and unavailable states. GSAP animates stage changes and output reveals while
respecting reduced motion. No execution, inference, persistence, authorization or
publication responsibilities change.

The run screen keeps only the change headline, optional user-added context and the
pipeline/activity workspace. Cancellation is a labelled button with a stop icon beside the
headline. Technical metadata, redundant summary/status blocks, breadcrumbs and
secondary action lists are omitted from this screen. Failure recovery stays with
the failed stage output, and a completed update exposes one review/open action
in that panel. The existing endpoints, history and other detail routes are unchanged.

## Runtime planning authority and proposal review UI

Runtime planning now consumes two separate inputs: source evidence explaining the
change, and optional operator-declared capabilities describing the existing trusted
workflow's executable scope. Sources validates selected capability IDs and routes;
Documentation supplies the repository-bound workflow descriptor/hash. Capability
metadata and selection are planning/authority, never evidence of product behavior.
Runner still executes only the trusted local script. Capture/vision observes current
runtime state; it does not prove historical behavior or every interaction.

Optional operator-selected supporting source files use Sources' existing pinned reader:
maximum three files, immutable head only, 16 KiB combined content, whole-file exclusion
with explicit missing/unsupported/oversized states. This is explicit context, not
retrieval, repository scanning or a new service. Legacy configurations use source-derived
routes without implicitly promoting supported pathnames into interaction coverage.

The existing retained-proposal page now exposes per-decision human review through a
validated Server Action. Browsers submit proposal/hash references and choices only;
`applyDocumentationReview` retains authorization, frozen selections, materialization,
immutable saves and receipts. Publishing stays a separate explicit saved-document action.
No inference is used by review, save, publication or result reopening.

Model errors carry small optional sanitized diagnostics through existing run JSON:
kind, model, completion reason, timing, returned usage and known schema issue paths.
No general telemetry service or raw rejected output storage is introduced. Historical
rows remain readable. Unsupported Baseten Management API billing tooling is removed;
inference billing failures remain classified.

## AI invocation debug metadata

Text and vision generation share a server-only invocation lifecycle under
`integrations/ai`. A single `docsyde.ai_model_invocations` table stores bounded
metadata and existing sanitized failure diagnostics. Explicit run/stage/operation
context supplies correlation; standalone calls may have no run. IDs remain local
to integration callers and never enter feature result/evidence contracts.

Provider/schema success is `structured-success` while local grounding or
correspondence validation is pending, then `succeeded` or `failed`. Feature
validation updates never overwrite provider completion/usage metadata. Unrelated
workflow failures do not become model failures; interrupted rows remain intermediate.
All writes are best effort, bounded, and never retried. Failures preserve the original
model result/error and emit only a fixed warning with an invocation UUID.

Invocation payloads are default-denied. The operation retention policy and UTF-8 limits
live in `integrations/ai/invocation-debug.ts`. Runtime decision, product-impact synthesis
and documentation planning retain sanitized model-facing instructions, input, JSON schema
and schema-valid output before semantic validation. Rejection preserves that output.
Documentation transformation retains sanitized requests and protocol diagnostics, but
not envelope entries: those are `unknown` until independent per-entry validation.
Vision keeps its existing bounds/certainty/count projection without pixels/context/prose.
Existing selection/support/receipt projections remain strict and bounded.

Sections carry original SHA-256/byte length, retained byte length, explicit truncation
and redaction flags. Instructions/schema are each capped at 8 KiB, input/output at
32 KiB; serialized request/response columns remain <=128 KiB, including escaping.
Known credential forms/credential-keyed values are redacted; no transport headers,
environment dumps, unrelated files, raw provider bodies or reasoning are captured.
Only actual model-facing content is considered; no source is reconstructed for logging.
This is bounded diagnostic retention, not a universal secret-detection guarantee.

Runtime semantic failures retain fixed invariant codes, target/citation paths and hashes
of expected/rejected correspondence data, preserving original error identity. Planning
and transformation use bounded fixed protocol codes; unknown validator errors retain
only a generic fixed diagnostic. The authorized detail reader validates snapshots before
rendering separate instruction/input/output/diagnostic/schema sections. Historical missing
content remains unavailable; no backfill or inference is attempted. Logs are debugging artifacts only,
never evidence, authorization, future model/retry input, or automatic training data. The Logs navigation tab
opens the repository-scoped AI model usage log, with 25 rows per page and optional
status, provider, and exact-stage filters. URL-backed filters carry across pagination;
applying filters resets to the first page.
Rows open invocation details with all retained metadata and sanitized diagnostics.
Run screens link to filtered logs and model-failure details instead of rendering
diagnostic JSON inline. Failure links resolve the latest failed invocation for the
stage; older failures can show their existing saved diagnostic on a fallback page.
Reads preserve repository authorization; standalone calls without a repository-bound
run remain SQL-only. Log read failures stay isolated from run rendering. Historical
runs need no backfill. No telemetry service or reconciliation worker is added.


## Controlled model reliability changes

Generation-only source analysis and legacy draft schemas enforce their prose limits
without shrinking stored/historical contracts. Source generation permits two citations,
200-character confidence reasons; v3 citation references replace the earlier model-authored
500-character excerpts (canonical excerpts retain their 600-character cap). Legacy generated draft
blocks are limited to 800 characters while historical canonical blocks retain 1500.
Other evidence counts/spatial fields and all completion ceilings are preserved. Product
impact owns an independent 8192-token constant rather than sharing the source constant.

The AI integration resolves typed requested inference options and records a small
contract/configuration snapshot. Runtime decision alone requests top-level low reasoning
for Baseten Muse Spark Open (canonical and -1026); other operations omit reasoning and
all sampling defaults remain omitted. The -1026 reasoning control was exercised in a
single explicit capability check; this does not establish planning quality. Sampling
controls remain restricted to the documented canonical slug. Safe diagnostics retain
provider-reported reasoning-token counts when present, visible response UTF-8 bytes/
UTF-16 character length (including truncated responses), completion reason and requested
effort. Hidden reasoning content and raw malformed responses are never retained. These
optional diagnostic fields require no migration and preserve historical reading. No model switching, arbitrary
provider-option passthrough, repair, retry, or automatic tuning loop is introduced.

## Opt-in reliability baseline tooling

`infra/local/reliability` owns operator preparation, the three independent pinned
Request Desk patch fixtures, offline browser/runner checks, snapshot-copy commands,
and evidence/reporting tools. It adds no service, model provider or runtime authority.
Documentation owns frozen-corpus/run admission and reuses the production transformation
preparation for deterministic batch inspection. The AI boundary has an opt-in async
invocation budget around existing logging/provider dispatch; experiment runs permit
each operation once, eight attempts total, and one transformation generation batch.
A multi-batch plan is an experiment scope exclusion before generation, not a product
defect. Ordinary runs keep existing multi-batch behavior and inference settings.
Independent database copies on the existing PostgreSQL server preserve earlier
scenario evidence without contaminating later candidate searches or deleting history.
The complete operator protocol and separate authorization boundaries are documented
in [the reliability runbook](infra/local/reliability/README.md).


Reliability specification 2 adds a narrow server-only process contract under
`integrations/reliability`: immutable execution identity, explicit child environments,
scenario filesystem ownership and runtime identity verification. The existing local
harness owns fixture builds, a Request Desk launcher that enriches only its process's
health response, owned process lifecycles and staged evidence. Documentation still
owns run admission and semantic report comparability; invocation logging remains
best effort outside reliability mode. Offline contract children explicitly mock the
invocation lifecycle and forbid real transport/persistence. This adds no service,
general resource manager, database identity/copy/schema change or model-policy change.

Host ownership now uses a narrow tokenized lifecycle: an atomic short mutex,
immutable transition history, and a replaceable versioned current-state record.
Only real owned child handles release a running lease after confirmed exit;
ambiguous/crashed acquisition state remains blocked. Sealing requires proof of two
healthy, stopped host generations. This fixes preflight-to-execution restart without
changing experiment treatments, inference policy, persistence, or publication.

Reliability-only DocSyde server identity is exposed through a token-gated route
composed from integration-owned checks (checkout/build, actual database and process
identity). Both Request Desk and DocSyde launchers share the bounded two-kind
ownership lifecycle; ordinary product execution remains unchanged. Admission
requires separate stopped-generation proofs and checks the live DocSyde identity
before the experiment execution reservation or run insert.

## Read-only live runtime inspection

Documentation owns the read-only inspection pane and authorized run readers. Browser
and Runner emit strict, versioned allowlisted observation events at execution boundaries
of the existing canonical session. Sources emits selection/vision boundaries through
the same optional synchronous observer. Observer exceptions never change capture,
actions, RuntimeTrace, eligibility, masking, image budgets or provider inputs/settings.
There is no playback, screencast, extra browser or periodic screenshot capture.

`globalThis.docsydeRuntimeInspections` holds the active run and most recent terminal
metadata. Each run is bounded to 512 events, 256 KiB metadata and 1 KiB per event;
eight events and 8 KiB are reserved for terminal/failure/truncation, with omitted
counts. A single copied eligible masked checkpoint PNG (at most 2 MiB) is provisional.
It is replaced rather than accumulated, cleared on new admission, and expires within
60 seconds after terminal completion. No preview bytes enter SQL or ArtifactStorage.

Browser cleanup still precedes canonical image storage; Runner cleanup precedes trace
manifest storage. Only successful manifest storage and guarded run linkage permit a
canonical retention announcement. Readers independently resolve retained manifest
membership and validate manifest, state and PNG hashes/bounds; callbacks are not
image authority. Failed capture, cleanup, storage or linkage cannot promote previews.

A separate bounded best-effort downstream writer replaces one pending snapshot, starts
at most once per second, and permits one global write in flight. Its separate single
connection pool uses 500 ms connection/statement timeouts. SQL checks the execution
token and increasing revision without modifying or locking heartbeat state. The
coordinator never awaits an observation flush. Migration 0010 adds only versioned,
bounded JSONB metadata keyed by the cascading run FK. Process loss may omit recent
events; persisted metadata and existing canonical artifacts remain readable.

The three `/runs/[id]/inspection` GET routes use existing run validation and repository
allowlisting, Node's default runtime and no-store responses. They accept run/capture
identities and preview revisions, never storage keys/paths. Missing/replaced/expired
previews return 410. Independent one-second polling retries after three seconds and
fetches once again on terminal transition. The pane distinguishes browser activity,
captured evidence, and validated model analysis. No semantic run state is added.


## Compact visual selection

Sources owns visual-selection v3: a strict model-facing object containing only
`selected`, with exact candidate checkpoint IDs, source references and nonblank
questions of at most 80 characters. The configured 0–3 limit is reflected in the
schema and independently checked alongside identity/reference correspondence.
Empty selected means skip. Array order remains vision execution order. The retained
v3 envelope adds a server-owned version field; readers accept historical v2 objects
without rewriting them or fabricating model rationale.

Only this operation moves from 2048 to 3072 output tokens, leaving bounded reasoning
headroom around a compact answer. Baseten Muse still uses schema-bearing instructions
and strict local JSON/Zod validation, without supported provider-side JSON Schema
enforcement, retries or repair. Selection alone joins the existing sanitized bounded
debug-retention policy for instructions/input/schema/schema-valid output and fixed
post-validation code/path diagnostics. Output survives correspondence rejection;
malformed/schema-invalid raw output is never retained. Reliability reports understand
new envelopes and historical projections. Logs remain diagnostics, never evidence.
Candidate projection/eligibility/deduplication/compaction and capture are unchanged.
The existing vision context, prompt/schema, other AI stages, and runtime-inspection
registry/routes/pane remain unchanged; existing observer events follow validated IDs.

The runtime inspection view is rendered inside the selected/active runtime stage,
using the existing observation reader and independent polling rather than a generic
failure card. Presentation maps typed events to fixed human-readable labels and
failure explanations; DOM labels, selectors, input values and exception text are
never collected for the UI. The same canonical browser now announces its actual
launch/close, navigation (sanitized pathname), page readiness and stored checkpoint
references. Runner announces application health readiness. Fixed diagnostics distinguish
health, browser launch/context, navigation, page readiness, action/timeout, state capture,
browser/runtime cleanup, artifact storage and guarded manifest linkage failures.
These callbacks preserve error identities, trace semantics, masking and storage order.
A stored-PNG event is not a retention announcement; canonical evidence remains gated
by cleanup, manifest storage and successful run linkage. Historical v1 events remain
readable. No event transport, screenshot path, provider behavior or SDK change is added.

Source analysis now joins the existing bounded invocation-debug allowlist for the
actual model-facing instructions, projected input/schema and schema-valid output.
Its existing grounding validator remains unchanged. Feature-owned diagnostics attach
fixed rejection codes, citation positions, returned/allowed coordinates, up to eight
matching excerpt ranges and input/citation/evidence hashes to the original error.
Citation identifiers/paths pass through the centralized redaction and byte-limited
section format. Invocation readers use their existing strict snapshot validation.
The earlier separate raw local semantic-rejection writer is retired; existing files
remain untouched, with no historical SQL backfill. These snapshots are diagnostics,
not evidence, future model input or authority. Malformed/schema-invalid output is
never retained. Provider settings, prompts and all downstream stages are unchanged.

## Source citation references and canonical excerpts

Source-analysis generation v3 returns only evidenceId and inclusive startLine/endLine
for each citation. Sources resolves these references against the exact supplied bundle
and reconstructs excerpt text with split("\n").slice(start-1,end).join("\n") before
existing canonical analysis validation and downstream use. IDs, availability, integer
bounds, nonempty/bounded canonical excerpts, changed evidence and reachability remain
validated. No trimming, source-coordinate reinterpretation or semantic truth guarantee
is introduced. Whole reconstructed excerpts must fit the existing canonical 600-character
limit; excessive ranges fail rather than truncate. In-bounds references prove evidence
membership, not that the chosen lines substantiate a claim.

Only new generation uses the reference schema. Historical canonical citation schemas
and their excerpt correspondence validation remain unchanged; no stored record or
experiment evidence is rewritten. The retained model-facing debug output is labeled
as model-returned references, while canonical run analysis/provenance contains resolved
excerpts. Source-analysis-v3 identifies this contract in invocation metadata. Other
operations retain their current schemas, prompts and model configuration.

Product-impact retains its five-field semantic output schema (assessment, summary,
claims, contradictions, uncertainties). Its instructions now explicitly name this
root and reject wrappers, echoed input/provenance and extra metadata. Canonical
provenance/revision warnings remain server-owned and are attached only after strict
schema and existing semantic validation. No output repair or permissive parsing is
introduced. Product-impact alone opts into bounded schema-failure shape diagnostics:
fixed public structural key names (at most eight per issue), total/withheld key counts,
sanitized schema paths, schema/output hashes and output byte length. Arbitrary key
names and all schema-invalid values remain excluded. Other operations preserve their
current diagnostic projection and inference behavior. No migration or backfill.

## Compact runtime inspection decisions

Sources now generates runtime-decision-v3 as a bounded semantic IR: status, short
reason, staticEvidence, up to three finding/target-reference pairs with short check
reasons, and up to three short uncertainties. Invocation-local IDs resolve against
validated source findings and the existing literal-route/operator-capability table.
Sources reconstructs canonical paths, capability IDs and citations, using each short
check reason for the canonical description/visible-evidence context. The existing
canonical correspondence validator runs afterward. Unknown IDs, duplicate pairs,
invalid evidence/authority or excessive canonical citations reject; no evidence is
silently dropped. Canonical/historical decision schemas and downstream execution stay
unchanged. Debug output is labeled as compact references, separate from resolved run
metadata. No provider/model/ceiling or reasoning option changes; no fallback or retry
is added. See the Sources runtime contract and exact review diff for calculated bounds.

## Bounded repository understanding

Sources owns explicit onboarding at `/sources/understanding`, linked from run setup.
It resolves one GitHub revision, reads a bounded tree (12,000 entries, no silent truncation), detects ecosystems from manifests, and ranks at most six overview/manifest/entry/workflow files with one local import/module hop. A metadata-only single-call fallback runs only when deterministic signals are insufficient; only high-confidence existing paths are accepted. It reads through the
existing authorized pinned reader, and sends at most 3500 characters per available
file under a 32 KiB aggregate request budget to the existing structured provider.
Understanding output has an 8192-token ceiling with unchanged concise schema.
A repository-keyed JSONB artifact stores purpose, audience, terminology, workflows,
surfaces, gaps, SHA, timestamp and full-file SHA256 references. One upsert replaces
only a successful validated result; failed refreshes preserve prior understanding.
Reopening reads persistence without inference. Operator notes remain separate.
Normal runs snapshot this optional artifact and send it as explicitly advisory data
outside source evidence. Historical snapshots remain valid. Runtime, impact,
planning, transformation and proposal-retention contracts remain unchanged.

Onboarding refresh accepts an optional 500-character product note using the existing
saved product-context setting. The submitted text (blank means repository-only)
is advisory input, separate from files and source evidence. Successful artifacts
record it in optional `generationContext.productContextUsed`; historical artifacts
remain valid. Saved notes and generated understanding remain distinct records.

## Neutral source finding boundary

New source-analysis-v5 generation classifies grounded source facts only as
`product-behavior`, `internal-change` or `undetermined`. It does not assign directional
capability/behavior labels or generate a capability-reachability list. Descriptions,
source-supported before/after text, qualifications and bounded citation references remain.
Overall assessment is derived after reference validation: any product finding yields
product-change; complete nonempty exclusively internal findings yield internal-only;
otherwise insufficient-evidence. Advisory context never establishes evidence.

Canonical findings accept the neutral product kind alongside historical directional kinds.
New findings get an empty legacy reachability list at canonical reconstruction. Existing
artifacts keep their kinds, excerpts and validation; there is no backfill or reinterpretation
of historical claim permissions. ProductImpact accepts neutral product findings as support
for behavior, workflow or UI interpretation, while retaining its existing output schema,
reference checks, temporal-value correspondence and runtime/vision evidence limits.
Publication and run orchestration are unchanged.

## Demo activity and document lifecycle views

The run monitor projects existing persisted workflow states, invocation summaries and
runtime inspection events into human-readable activity and substeps. It does not schedule
work, simulate progress, weaken validation or change model contracts. Detailed responses
and diagnostics remain expandable. Browser previews remain provisional until canonical
retention, with existing masking, expiry and evidence rules unchanged.

The Documents hub reads existing active publications for Live, retained review authority
for Pending changes, and immutable saved documents for History. Saved-but-unpublished
snapshots are explicitly separate from Live. History identifies snapshots by revision ID,
save date and originating source SHA. No parallel store or migration is introduced.
Human review compares exact target snapshots with the candidate before the existing
review/save operation; publication remains a separate explicit operation.
