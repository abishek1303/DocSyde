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
and contextual delivery remain future work. No architecture boundary has moved.

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
