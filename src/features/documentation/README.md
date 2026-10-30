# Documentation drafts

Implemented: `/documentation/draft` composes Sources semantic analysis and one
structured draft-generation call in a trusted server invocation. It does not accept
a client-supplied analysis as validated. Generated previews can be explicitly saved
through a signed handoff; saved drafts load independently of Sources and AI.
Existing Sources operations remain intact; `product-analysis.ts` is the narrow
cross-feature entry. The existing allowlist and single-process guard apply to
each provider stage. Keep this local-only; public exposure requires authentication
and user/resource authorization. Provider credentials stay server-side.

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

Deferred: editing, document history, stale-doc targeting, automatic updates,
publishing, Markdown export, embeddings, SDK delivery and investigation.

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
