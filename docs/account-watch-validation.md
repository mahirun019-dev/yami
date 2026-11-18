# Account development follow-up, 2026-10-31

## Scope

Only the localhost account emulator is changed. `watch-service` production code,
configuration, D1 bindings and deployments are unchanged. The account Worker imports
the existing monitoring engine; it does not call the shared production Watch API.
Migration 0005 adds isolated runtime tables in ACCOUNT_DB, not the production DB.

## Running

Run `npm run build:app`, `npm run db:local`, then `npm run dev` in account-sandbox.
Open http://127.0.0.1:8790/app/ and sign in. Settings > company watch now provides
account-owned source registration, removal, real local checks, results and read receipts.
Only a company in the session owner's workspace can be registered. Shared source
results are delivered only to subscribers whose expected company identity matches
the canonical checked company. A second company name cannot inherit an open Entry.

The development launcher invokes the local scheduled handler at 00:17, 06:17,
12:17 and 18:17 UTC while that process and computer remain running. It uses only
127.0.0.1; it is not a hosted scheduler and does not survive closing the process.
The UI can explicitly run a local check. A scheduled invocation is not proof that
every source succeeded: inspect source timestamps and account_watch_runs outcome.
The reused engine retains its leases, baseline recovery, retries, health debounce,
MyNavi state machine and content-change suppression. Persisted events are drained
after partial failures and fanout is idempotent. No production Cron is triggered.

## Executed tests and limits

67 account tests, 105 unchanged monitor-engine tests and 12 frontend/storage/transfer tests pass. The full existing
monitor engine was run against controlled network fixtures, proving silent first
baseline, one shared fetch for two subscriptions, real change delivery, and no
duplicate event on unchanged content. These are real engine executions with simulated
upstream responses, not evidence of live website availability or natural local Cron.
Real second Google account, physical iPhone/Safari/PWA, and prolonged local schedule
observations remain unverified. No actual legacy user package has been imported.

## Legacy-origin export plan (not deployed)

localhost cannot read GitHub Pages storage. The exporter is implemented in the
ordinary frontend source but is not published. To export actual production-origin
data, first obtain approval for an exporter-only frontend release: add the download
entry without enabling accounts or altering storage; read localStorage and existing
IndexedDB read-only; download checksummed JSON to the user's device without sending
data to a server. Keep every old store intact. Then the user selects the file in the
local account app, inspects counts/conflicts, and confirms. The existing importer
snapshots the account before commit and supports rollback. Missing binaries or
oversized local-test files block import instead of silently dropping records.

The migration integration tests cover companies, stages, schedules, ES, interviews,
preparation, templates/settings, binary attachments, backup files, deduplication,
conflicts, checksum errors, stale revisions and exact pre-import rollback. They do
not prove a real GitHub Pages browser export has occurred. No production deployment
or migration is authorized by this document.
