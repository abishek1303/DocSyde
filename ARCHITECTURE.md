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

This is a target, not the current end-to-end behavior. Baseten currently serves
source summaries, bounded semantic analysis and new-draft generation. The working
tree also contains independent Meta vision and combined local runner/capture proofs;
neither is connected to the product run. There is no model-driven inspection
decision, saved-document analysis input or static/runtime evidence reconciliation.
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
as described below; runtime orchestration and existing-document updates remain
deferred. No architecture boundary has moved.

## Canonical documentation drafts

`features/documentation/document.ts` owns canonical structured documentation v1.
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
initialization remains intact. Version history, editing, targeting existing docs,
updates, publishing and SDK delivery remain deferred.

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


## Change-to-run workflow

Changes now links to a pinned commit-details/setup screen. Sources owns commit
parents, first-parent defaults, branch browsing, revision pinning and evidence
selection. Documentation owns request-bound run execution, stage transitions,
proposed drafts, review and explicit signed saving. The existing source access
guard and all canonical/evidence validators remain intact. App routes compose the
Sources table with a narrow Documentation run-status entry; Sources does not import
Documentation, preserving acyclic feature dependencies.

Migration 0003 adds `docsyde.documentation_runs`, a bounded JSON record alongside
repository, lifecycle status and timestamps. An atomic pending-to-running claim
prevents repeated POSTs from executing the same run twice. Progress callbacks at
real operation boundaries persist stage transitions; a read-only status endpoint
supports polling. GET/rendering never calls a model. The run page issues the
execution POST only for a deliberately created pending run. Same-origin checks
protect that HTTP mutation in the existing trusted-local scope. Each read and
execution rechecks the repository allowlist; this is not public multi-user auth.

Context is frozen once at execution and recorded. Analysis snapshots retain only
the bounded evidence already supplied to the workflow; no credentials, provider
envelopes, browser, runner or SDK evidence are added. Completed run previews remain
separate from immutable saved documentation. A save retry reuses the exact signed
preview without model calls. New attempts create new run IDs. A running record
older than seven minutes is presented as interrupted without automatic resumption.
No queue, worker or durable background-execution guarantee is introduced.

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
