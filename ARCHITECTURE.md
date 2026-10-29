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
