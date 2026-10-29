# Documentation drafts

Implemented: `/documentation/draft` composes Sources semantic analysis and one
structured draft-generation call in a trusted server invocation. It does not accept
a client-supplied analysis as validated. No persistence, handoff cache or signing.
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
New generations create new UUIDs; later edits/persistence can preserve existing IDs.

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

Deferred: storage, document history, stale-doc targeting, automatic updates,
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
