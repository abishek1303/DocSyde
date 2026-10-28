# DocSyde

Contextual documentation, inside your product.

DocSyde will generate documentation from source code and product context, and surface relevant documentation and answers inside a host application. This repository currently contains a minimal Next.js homepage, shared UI primitives, and a modular monolith scaffold. Feature modules and integrations are planned, not implemented.

## Local development

Use Node.js 20.9 or newer and npm with the checked-in lockfile.

```bash
npm ci
npm run dev
```

Open http://localhost:3000. No provider credentials or environment variables are required for the starter. The existing Geist fonts use `next/font/google`, which requires network access to Google Fonts during compilation.

## Checks and production

```bash
npm run lint
npx next typegen
npx tsc --noEmit
npm run build
npm run start
```

`next typegen` generates the route types used by the layout before TypeScript checking. `npm run start` serves the production build; run it after a successful build.

## Architecture

One Next.js application, organized by product feature. README-only folders document planned ownership:

```text
src/
  app/                    routes, layouts, handlers, actions, screen composition
  features/
    projects/             project setup, membership, settings
    sources/              connected sources, synchronization, ingestion
    documentation/        documents, generation, revisions, publishing
    assistant/            retrieval, answer generation, citations
    embed/                documentation and assistant UI inside host apps
  integrations/
    github/               planned GitHub client and provider operations
    ai/                   planned model and embedding provider operations
    database/             planned database clients and connection configuration
  components/ui/          existing shared UI primitives
  lib/                    small shared helpers, including utils.ts
```

## Module boundaries

- Keep `app/` focused on routing, request/response handling, framework caching, and screen composition. Product behavior belongs in features.
- Colocate each feature's UI, operations, schemas, types, and queries. Feature server operations own business rules, resource authorization, and feature-specific data access.
- Integrations own SDK setup and provider-specific operations; they must not import features or `app/`. Shared UI and generic helpers must not depend on features.
- Access another feature through a narrow, explicit entry module when needed. Avoid imports into another feature's internal components or queries, keep dependencies acyclic, and place orchestration in the feature that owns the workflow.
- Keep request objects, HTTP responses, redirects, and UI state out of reusable business operations. Return results for routes or actions to translate.
- Keep types and validation schemas with their owners; share contracts only when multiple modules use them. Avoid generic repositories, global service layers, broad barrel exports, and speculative abstractions.
- Default to Server Components, with client boundaries limited to interactive UI. Keep credentials, database access, ingestion, and model calls on the server; mark sensitive modules with `import "server-only"`. Deliberate Server Action entries must validate and authorize every invocation.
- Fetch server-rendered data through feature server functions. Use HTTP endpoints only for real HTTP boundaries, and validate untrusted input and enforce resource permissions in server operations.
- Preserve shared UI, theme tokens, and `src/lib/utils.ts`. Add implementation files only for concrete requirements.

See [AGENTS.md](AGENTS.md) for the full development rules. Authentication, provider connections, AI calls, ingestion, an embedded SDK, and background infrastructure are outside the current scaffold.
