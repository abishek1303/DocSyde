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
  The event model is configurable; schema enforcement is not assumed remotely.
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

The next presentation slice can attach a transient screencast observer where
`capture-trace.ts` creates its page, with teardown in the same lifecycle. Live frames
must not affect evidence, hashes, checkpoints, selection or model budgets.

## Explicit publication and contextual delivery

Documentation now owns explicit publication of already persisted immutable drafts.
A single `documentation_publications` association stores UUID, the existing shared
canonical repository identity, exact pathname, draft FK and timestamp. Its unique
repository/pathname key permits one active association; row existence is published.
Saving stays separate. Same-document publication is idempotent, explicit replacement
atomically changes the reference and publication identity/time, and unpublish deletes
only the association. Observed publication UUIDs protect replace/unpublish against
stale writes without a general concurrency layer. Canonical draft JSON/status and
saved timestamps remain unchanged; no history or content copy is introduced.

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
