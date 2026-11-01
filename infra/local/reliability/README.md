# Request Desk reliability baseline

This suite prepares three independent changes against
`45799b2fae07f1326296b8ba85fae51476fd153d`. It preserves existing architecture,
model identifiers, prompts/contracts, output ceilings, omitted sampling/reasoning
controls, and ordinary multi-batch product behavior. No command automatically
commits, pushes, merges, deploys, retries, repairs, or tunes models.

## Implemented scenarios and offline verification

| Scenario | Product change | Narrow documentation intent | Help route |
| --- | --- | --- | --- |
| A | New requests default to Urgent; explicit Normal, old records and missing-priority normalization remain Normal | Revise the existing create-request section | `/requests/new` |
| B | Close → Confirm close / Cancel; existing close and Reopen operations unchanged | Revise the existing closing procedure | `/requests/r-001` |
| C | Stored `closed` displays as Resolved on list/details; domain values and Reopen unchanged | Revise the existing status explanation | `/requests` |

`scenarios/A.patch`, `B.patch`, `C.patch` contain the complete focused app changes,
relevant domain tests, and app README updates. B's behavior is exercised through
browser assertions because its domain operation has not changed.

```sh
npm run reliability:test
npm run reliability -- scenarios
```

The second command exports the **committed** base into three ignored disposable
fixture directories, applies each patch independently, builds the SDK and app,
runs app and relevant mocked DocSyde contract tests, and starts one owned host at a
time on `127.0.0.1:45873`. It refuses an occupied port. It verifies direct
navigation/refresh and scenario behavior in Chromium, then executes the exact
trusted runner workflow with local storage. No selection or vision/model call is
made. The server is stopped; fresh browser contexts isolate sessionStorage.
Screenshots, trace states, configuration and receipts are retained under
`.artifacts/reliability`. Export receipts have `head: null` and **cannot admit live runs**.
These checks are not a live end-to-end reliability result.

A verifies the initial Urgent selection separately. Its trusted runtime script
explicitly selects Urgent, so its resulting-detail evidence never proves the
initial default. B traces open → confirmation → cancel → confirmation → closed;
a confirmation screenshot proves only those visible controls. C checks the
stored `closed` value, close/reopen outputs and display independently.

## Approval boundaries and Git preparation

Implementation does not authorize commits, pushes, paid inference or publication
mutation. Obtain those authorizations separately. The following preparation is
for an operator **after local commit authorization**, using one new disposable
worktree (leave `test-project` and its baseline tag alone):

1. Freeze this DocSyde implementation in a clean committed checkout. The manifest
   refuses dirty/untracked source and later SHA/file drift.
2. Add a disposable worktree at the common base on a new scenario-A branch.
   Apply `A.patch` there, inspect it, and create exactly one focused commit.
3. Reuse only that clean disposable worktree: switch to a new scenario-B branch
   created from the common base, apply `B.patch`, inspect, commit once. Repeat C.
4. Record the three full SHAs. Check each has exactly one parent, the common base.
   Never stack scenarios or use a worktree diff as DocSyde's source comparison.
5. Only after **separate push authorization**, push the three explicit scenario
   branch refspecs to the existing repository. No force, merges or primary-branch
   update. Do not push all refs/tags. Remote cleanup is separately authorized too.

For each clean committed scenario checkout, run:

```sh
npm run reliability -- offline A /absolute/scenario-checkout .artifacts/reliability/A-evidence
npm run reliability -- github reliability/A FULL_HEAD_SHA .artifacts/reliability/A-github.json
```

Use B/C accordingly. `offline` checks the one-parent commit, allowed paths and
exact source-tree equality to the reviewed patch, before rerunning offline checks.
`github` is read-only: it checks the remote branch SHA, single parent and comparison
through the existing adapter. It does not push or run inference. Its receipt is
required before paid execution. Keep refs stable throughout the experiment.

## Frozen baseline and database copies

Use an already migrated local database with **real existing saved documentation**.
Do not seed demo prose to make a scenario pass. If no appropriate existing target
can support a bounded section revision, record that scenario as blocked/outside
scope before inference. Stop other local document/publication writers while
freezing. Preserve the same non-secret environment and resolved model settings
for all three scenarios. `NODE_ENV` defaults to development for CLI snapshots;
set it explicitly to production if running the production server.

```sh
npm run reliability -- freeze .artifacts/reliability/baseline.json
npm run reliability -- clone .artifacts/reliability/baseline.json .artifacts/reliability/database-copy docsyde_reliability_trial1
```

`freeze` is read-only except its exclusive local output file. It captures all
eligible saved-document canonical/search-projection hashes, repository context,
publication mappings, physical column/constraint definitions, resolved inference
snapshots, non-secret environment, code/file/lock/prompt hashes and DocSyde SHA.
Credentials are never stored. Null inference controls mean omitted, not inferred
provider defaults. Use the same neutral `runContext: null` for all scenarios.

`clone` is an explicitly invoked preparation mutation: it creates three **new**
databases on the existing PostgreSQL server from one consistent `pg_dump`
archive. Requires compatible local `pg_dump`/`pg_restore` tools and create-database
permission; it adds no service. It refuses existing target names, changed source
inventory, or connection query options it cannot safely translate. It never
restores over/drops a database, changes original publications, or deletes history.
If restoration fails, preserve partial copies and stop; do not overwrite them.
The copy receipt records names and dump hash. Every copy is independently checked
against the frozen manifest before inference. Retain copies as scenario evidence.

Start a fresh DocSyde process for each scenario, setting server-only `DATABASE_URL`
to that scenario's copy. The shared pool must not be reused across database changes.
Use the same DocSyde port, storage root, origins, dependencies and model settings.
Run the corresponding exact Request Desk head on port 45873 and the same host
repository/delivery configuration. Stop owned processes before changing checkout.

## Single-batch admission and sealing

Before **any** paid call, choose the exact baseline document/section for the
scenario's intended small revision. Prepare a trusted local representative
`{ impact, plan, context: [] }` input using actual pinned source evidence and real
saved target IDs. This is an offline feasibility expectation, never supplied as
a model result or substituted for live analysis/planning.

```sh
npm run reliability -- batch representative-A.json .artifacts/reliability/A-batch.json
```

This runs production validation, target loading, authorization, request sizing
and minimum partitioning with **zero inference and no writes to the database**.
The receipt records exact target hashes, pinned source refs and batch bytes.
Eligibility requires one batch and no infeasible/invalid decisions. Exit code 2
means outside single-batch scope. Simplify before creating final commits/manifests,
or exclude the scenario. Multi-batch requirements are not a product defect.

Against A's isolated database, create a local operator spec:

```json
{
  "scenario": "A",
  "databaseName": "docsyde_reliability_trial1_a",
  "head": "FULL_IMMUTABLE_HEAD_SHA",
  "branch": "reliability/A",
  "runContext": null,
  "runtimePath": "/absolute/path/A-evidence/runtime.json",
  "batchReportPath": "/absolute/path/A-batch.json",
  "offlineGatePath": "/absolute/path/A-evidence/offline-gate.json",
  "githubGatePath": "/absolute/path/A-github.json"
}
```

Set `DOCSYDE_RUN_RUNTIME_CONFIG` to that exact runtime path, configure existing
credentials/storage/Chromium, and seal:

```sh
npm run reliability -- seal .artifacts/reliability/baseline.json A-spec.json .artifacts/reliability/A-manifest.json
```

Sealing validates the real clone identity, complete corpus, schema, publication
mappings, context, configuration and all evidence hashes. Both model credentials
and runtime availability must be present; no model is invoked. Use the same process
environment when starting DocSyde. Set `DOCSYDE_RELIABILITY_MANIFEST` to the sealed
manifest before starting its server. Do not change settings between A/B/C.

Only the relevant scenario capability is exposed; IDs select scope in the exact
operator-authored workflow. Pathname support is not interaction coverage. Models
cannot author selectors, commands, environment, navigation or checkpoints.
Maximum selectable images is one. Natural not-needed or zero-image selection is
valid; configured zero screenshots would disable runtime and is not used.

## Separately authorized live execution

After explicit paid-inference authorization, start exactly one pinned run through
the existing UI with the recorded branch/base/head, no path filters, no associations,
and null run context. Before dispatch, admission rechecks the baseline and frozen
files/options. A retained `.attempt.json` next to the manifest prevents reusing that
manifest for another run. Do not delete it to retry a failure.

Expected path is 6–8 calls: source, runtime decision, optional selection/one vision,
impact, plan, one transformation generation and support validation. The opt-in
async inference scope admits each operation once and at most eight attempts,
blocks unguarded calls in the experiment server, requires the invocation log insert
to succeed before paid dispatch, and stops after provider/schema
or grounding/correspondence rejection. No retries/repair/alternate models occur.

The **actual** generated plan is deterministically partitioned again before
transformation dispatch. If it needs multiple batches, stop before generation and
record `outside-single-batch-baseline-scope` (incomplete, no product failure).
Earlier analysis/planning calls remain recorded. Never truncate or rewrite that
plan to force admission. Simplifying and attempting again requires new approval.
Ordinary non-experiment multi-batch runs remain supported.

A failure ends that scenario's downstream inference. Continue to the next scenario
only after cleanup and its fresh baseline gates. Configuration/corpus drift or
restoration failure stops the entire experiment. Reopen retained runs without
regeneration; do not use Rerun.

## Review, exact publication lineage and cleanup

Review every decision explicitly through the existing proposal UI. Record
approve/reject choices; unsupported material rejected by the reviewer is a
non-successful reliability observation. Do not manually edit generated content.
Choose save only (no review-time publication choices), and record exact save receipts.

Publication checks require **separate authorization** and run only on the scenario
copy. With DocSyde and that exact host checkout running:

```sh
npm run reliability:publication -- .artifacts/reliability/A-manifest.json RUN_ID SAVED_DOCUMENT_ID .artifacts/reliability/A-publication.json
```

This verifies run → retained proposal ID/hash → accepted review selections/receipt
→ saved-document hash/ID before mutation. It rejects partial proposals and rejected
review decisions. It journals the original repository/route/publication ID/document
ID and uses current `observedId` conflict protection. It temporarily unpublishes,
verifies empty delivery, explicitly publishes only the scenario save, and checks
exact document/publication IDs through actual Request Desk help responses and
visible saved content. Refresh/reopen must add no run invocations.

In `finally`, it unpublishes only its observed scenario association, verifies
absence, restores the original document mapping without overwriting conflicts,
and verifies original document delivery (or empty if originally empty). A restored
association may have a new publication ID, recorded in the event journal. If
restoration fails, **stop before another scenario** and use that journal for
operator recovery. Never delete saved documents or count an old publication as success.
The original database's publications are never touched.

A scenario passes only after grounded analysis/synthesis, supported planning,
one-batch transformation/support, retained complete proposal, correct human review,
save, exact-document host delivery, inference-free refresh/reopen, and restoration.
Optional runtime skipping is acceptable. Partial completion is not a pass.

## Read-only reports and retained evidence

Against each scenario database:

```sh
npm run reliability -- report .artifacts/reliability/A-manifest.json RUN_ID .artifacts/reliability/A-publication.json .artifacts/reliability/A-report.json
npm run reliability -- compare .artifacts/reliability/A-report.json .artifacts/reliability/B-report.json .artifacts/reliability/C-report.json .artifacts/reliability/comparison.md
```

Use `-` for a missing publication proof. Reports do not initialize/reconcile the
run coordinator, regenerate content, or mutate publications. They preserve existing
invocation metadata/config snapshots, safe payloads/omission reasons, stage outcomes,
capability selections, selected-image counts and lineage. Missing logs/usage are
unavailable, never invented token counts. Successful reporting requires live evidence;
offline fixture results cannot be substituted. Scope exclusions and failures stay visible.

Compare tokens by operation, length completions, latency outliers and repeated
validation/grounding/correspondence failures. Describe observations, not causal or
statistical reliability claims. No dollar estimate without verified pricing.

Retain databases, runs/logs, proposals/reviews/documents, manifests and attempt
receipts, commit SHAs, and reporting screenshots/traces. Remove only owned disposable
worktrees, temporary browser sessions and permitted temporary artifacts. Never
bulk-delete records, reset unrelated worktrees, rewrite history or automatically
delete remote scenario refs. Baseline restoration for later scenarios is achieved
by selecting their untouched database copies, not removing earlier immutable saves.

## Non-database isolation protocol (specification 2)

This protocol supersedes the shared-root and manual host/server launch instructions
above. Database connection identity, copy mechanics and schema fingerprinting are
unchanged. Historical version-1 manifests/evidence remain evidence; they cannot
admit specification-2 execution. No command below authorizes paid inference.

Every reliability CLI/publication command requires `DOCSYDE_RELIABILITY_CONTEXT`
to name a local JSON file. Each command reads and freezes it once. Use a new process
for each mode/context; never change a running process's environment or context.
A scenario context starts with this shape (all paths must be absolute):

```json
{
  "version": 1,
  "experimentId": "trial-unique-id",
  "scenario": "A",
  "mode": "offline",
  "repositoryRoot": "/absolute/docsyde",
  "docsydeSha": "FULL_COMMITTED_DOCSYDE_SHA",
  "requestDeskSha": "FULL_COMMITTED_SCENARIO_A_SHA",
  "outputRoot": "/absolute/docsyde/.artifacts/reliability/trial-unique-id/A",
  "runtimeIdentity": null,
  "manifestPath": null
}
```

Keep operator context files outside the scenario output root, for example under
`.artifacts/reliability/contexts`. `outputRoot` is fixed by repository root,
experiment ID and scenario (`shared` when scenario is null); it cannot be reassigned
to another scenario's directory. Commands create/check ownership markers and refuse
symlink ancestors. Use a new experiment ID for a new attempt. Preserve prior roots,
receipts, databases and logs. The harness does not delete historical evidence.

Modes: `offline` for fixtures/contracts; `baseline-read` for freeze; `provision` for
clone; `scenario` for batch/GitHub/seal/host/serve/publication/execution; `report` for
report/compare. Freeze, clone and compare normally use `scenario: null`,
`requestDeskSha: null`, `runtimeIdentity: null`, and the `shared` output root.
A scenario/report context must name its exact scenario/head. Scenario mode also
requires the runtime identity and intended absolute manifest path. Reuse the same
experiment ID and DocSyde SHA across these context files.

`npm run reliability:test` creates its own disposable test context and launches the
unit/adversarial suite with an explicit environment. `npm run reliability:offline:test`
does the same for all three local browser fixtures. The latter needs Chromium and
loopback-server permission, uses only mocked providers, has no database credentials,
and emits only inadmissible `head: null` export gates. `reliability scenarios` is also
a preview: use a separate preview experiment ID rather than consuming a future
committed scenario's offline attempt.

For a real frozen preparation, use this order:

1. Commit the implementation and verify the expected clean DocSyde root/SHA.
   Prepare the independently committed Request Desk scenario SHAs as above.
2. With each scenario's `offline` context, run the existing `offline A|B|C checkout
   output` command. Put output under its scenario root, e.g. `A/offline`.
   A pre-existing output directory is always rejected, including an empty one.
3. Offline preparation reserves `A/offline.attempt.json` exclusively, stages output
   in a fresh owned directory, builds SDK/host files from pinned sources into that
   directory, and runs contracts with an in-memory invocation mock. Unmocked network,
   production persistence and arbitrary nested commands fail the child even if caught.
   The only nested renderer command is explicitly bounded and offline.
4. A success appears only after capture and owned-process cleanup succeed, at
   `A/offline/offline-gate.json`. Evidence is under `A/offline/evidence/`, including
   `runtime.json`, logs, images and trace. Failed staging directories have no gate.
   Receipts bind experiment/scenario, SHAs, runtime/build identity, workflow/capability
   hashes, contract inputs, evidence directory token and exact evidence-file hashes.
5. Freeze using `baseline-read` with output under `shared`, then clone using
   `provision` with output under `shared`. Existing database requirements still apply.
6. Copy `runtimeIdentity` from the committed offline gate into a new scenario-mode
   context file. Set `manifestPath` to the intended `A/manifest.json`. Set server-only
   `DOCSYDE_STORAGE_DIRECTORY` to the exact `A/artifacts` directory. Keep common model,
   origin, repository, delivery and `NODE_ENV=production` settings fixed from freeze.
7. Run batch and GitHub gates with this context and scenario-owned output paths.
   The seal spec's runtime path is now `A/offline/evidence/runtime.json`.
8. Start the host with `npm run reliability -- host A/manifest.json CHECKOUT`.
   This launch accepts the intended manifest path before sealing, using the committed
   offline gate/runtime identity in the context. After sealing it also checks the
   existing manifest. The host rebuilds pinned sources into a fresh owned directory;
   its harness-only `/health` response exposes scenario, source SHA, build hash and
   workflow/runtime versions, and rechecks served bytes. An ordinary host's plain
   `ready` response cannot admit reliability capture. Stop it with Ctrl-C.
9. Seal while that exact host is running. The intended manifest identity/path must
   match the context. File, workflow, ownership and live runtime checks precede run
   preparation. Sealing still performs no inference.
10. Start the production server with `npm run reliability -- serve A/manifest.json
    3000`. It uses an explicit environment, an owned direct child and startup
    preflight. Host and DocSyde processes are recorded separately; shutdown is bounded
    and never searches/kills processes by port. Ordinary `npm run dev/start` without
    reliability context retains ordinary behavior.
11. Only after separate inference authorization, use the normal UI. Run creation
    reserves `A/execution.attempt.json` before run insertion/reconciliation. This
    fixed identity-bound reservation rejects concurrent/copy/reseal attempts even
    when the manifest pathname changes. It is retained after completion/failure;
    there is no automatic reopening or retry. Existing per-dispatch budgets remain.
12. Review/save/publication are still separate explicit operations. Publication proof
    checks the execution receipt and expected runtime before mutation, records intent,
    acknowledgement and independently observed delivery, and hashes its journal/image.
    A lost publication acknowledgement with an unknown association identity is blocked
    for operator recovery; cleanup never guesses or overwrites an association.
13. Produce reports using the scenario's `report` context. Compare using the shared
    `report` context. Comparison requires one experiment and identical specification,
    DocSyde/common-base, contract/config, runtime policy and corpus/baseline identities.
    Ports, process IDs, instance paths and random capture IDs are exact evidence,
    not semantic comparison keys.

Child environments explicitly select context, working directory, storage/temp roots
and Node mode. Git selectors, Node hooks, proxies, browser overrides and stale
scenario values are not inherited. Only the explicitly invoked application server
inherits the required provider/GitHub credentials and allowlisted application/model
configuration; database-copy children receive only their existing explicit PG values.
Secret values never enter ownership records or manifests.

The original database and its 332 synthetic invocation rows remain retained audit
evidence. The known raw schema-fingerprint restore limitation remains unchanged by
this non-database pass and may still block a fresh frozen baseline's admission.

## Host lifecycle correction

New freezes require `host-restart.json`, bound by the sealed manifest. Run the
normal `host` command twice sequentially, prove each host healthy, and stop each
through the launcher's normal shutdown. Then run `reliability host-readiness` with
that scenario context. This emits readiness only from two distinct healthy/stopped
generations in `host-history/`. Start the host again for sealing. The same host
command can subsequently reacquire the stopped scenario for authorized execution.

`host-process.json` is now versioned current ownership state; immutable tokenized
transition files are the durable evidence. A short atomic directory mutex serializes
acquisition/transition. Running owners block. A recorded stop follows confirmation
through the actual owned ChildProcess handle. A crash record can be retired only
when both recorded PIDs are conclusively absent; acquiring records without a child,
legacy/malformed records, permission ambiguity, PID reuse/liveness and an interrupted
mutex fail closed. Disk PIDs are probed with signal 0 only, never killed. No broad
stale-file deletion occurs. Every host generation uses a fresh token-scoped build
root. Attempt reservations and all other evidence exclusivity remain unchanged.

The historical `frozen-v2-20261101214519436` is not upgraded or rewritten. Its
admitted-then-startup-blocked evidence remains authoritative for that old version.

## DocSyde server lifecycle and identity correction

The `serve` command now uses the same atomic, tokenized lifecycle as `host`, with
separate `docsyde-process.json`, `docsyde-record.guard` and `docsyde-history/`.
Stopped proof allows reacquisition; live/ambiguous/legacy ownership blocks. Retain
old failed experiments unchanged rather than converting their legacy records.

After sealing, keep the exact Request Desk host running. Start and stop `serve`
twice, verifying each launch's authenticated `/api/reliability/identity` response.
Then run `reliability docsyde-readiness`. Its receipt binds the immutable healthy /
stopped generation hashes to the exact sealed manifest. Run preparation requires
this receipt plus a fresh live identity check before reserving or inserting a run.
The identity includes scenario, experiment, checkout SHA, build ID, launch token,
PID and `current_database()`. Ordinary app execution exposes no identity.

For future paid execution, start both owned launchers and explicitly verify the
DocSyde identity against its current process record before submitting through the
UI. HTTP availability alone is never sufficient. No launcher authorizes inference.
The historical `frozen-restart-v2-20261101223813683` remains startup-blocked evidence,
including its accidental pending original-database row; do not delete or execute it.
