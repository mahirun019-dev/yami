# Yami account / Sandbox integration (development only)

Update 2026-10-31: the earlier "runner not connected" limitation below is superseded
by the isolated runtime bridge and account monitor UI described in
[account-watch-validation.md](./account-watch-validation.md). The bridge reuses the
existing engine against local runtime tables, never the production monitoring DB.
Real website and long-running scheduled acceptance remain separate from fixture tests.

## Scope and architecture

This change reuses the existing React application and `account-sandbox` implementation. It does not create a replacement Yami project or deploy anything publicly. The normal GitHub Pages build stays anonymous/local as before. All shipped free functionality remains available in that normal build.

The integrated development build is **http://127.0.0.1:8790/app/**. It requires both Vite mode `account-lab` and `VITE_ACCOUNT_LAB=1`. The backend additionally rejects every origin except `http://127.0.0.1:8790` and every environment except `local-google-test`. No frontend mode flag is an authentication credential.

```text
existing Yami UI (account-lab build, same localhost origin)
 -> Google OIDC code + PKCE + state + nonce, server-verified ID Token
 -> stable users(issuer, subject) -> HttpOnly, hashed server session
 -> ACCOUNT_DB: user-owned workspace / files / backups
```

Cloudflare documents local Queues as a standalone Miniflare environment, not production provisioning: [local development](https://developers.cloudflare.com/queues/configuration/local-development/), [batching and retries](https://developers.cloudflare.com/queues/configuration/batching-retries/). Google uses the existing minimal-scope Web OAuth development client: [Web Server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server).

## Storage audit and isolation

Before this work, companies/events/materials/interviews/preparations/templates/preferences were stored in browser `career-flow-data-v5`; theme/locale/navigation/notification read IDs used additional browser keys. Attachments and automatic backups used IndexedDB. The monitoring Worker/D1 and its shared access code were not a personal account system.

In account development mode only:

- The existing Data v5 shape is preserved inside a server-owned workspace. GET/PUT always derive the owner from the validated session; there is no client owner parameter, cross-user list endpoint or global data import.
- A separate expected-user header is compared to the session, never trusted as authentication. Stale A tabs cannot write B after the browser switches accounts. React remounts the entire workspace when user IDs change, and old in-flight responses cannot overwrite the next user's memory.
- All application storage uses an account memory adapter in this mode, not anonymous localStorage. Legacy mode still uses the original browser storage. Company records are nested in the owner workspace; attachments and backups have composite `(user_id, kind, id)` ownership.
- Product update definitions remain shared public application content; each account's read IDs are private. Existing shared company notifications/targets are not loaded into the account build.
- Workspace revisions use compare-and-swap. Conflicts fail with 409 instead of overwriting another tab/device. Network failure retains the current unsaved in-memory draft, provides a v5-compatible recovery download and warns before leaving. It is not real-time collaborative merging or a durable offline cache.
- Session expiry removes the private workspace from the page. Reauthentication with the same Google subject reloads the same data; email changes do not change identity. Files and backups require authenticated, expected-owner requests for GET/PUT/DELETE/list.
- The local D1 prototype caps each snapshot/file request at 1 MB and retains five automatic account backups. These are test-storage constraints, not Free/Pro commercial limits, and do not alter production uploads or backups. Public file storage and larger data need a separate storage decision before any public rollout.

## Local schema and rollback

Executed **only with `--local`** after stopping the local service and copying its D1 state to ignored `account-sandbox/.wrangler/pre-account-integration-d1-20261030`:

1. `migrations/0002_user_workspace.sql`: adds `user_workspaces(user_id,revision,storage,updated_at)` and `user_files(user_id,kind,id,content,media_type,updated_at)`. Existing Google identities and sessions are unchanged.

No production schema, monitoring D1, URL, cron, historical notice or read state was migrated. No old table was dropped or replaced. The queue binding is local simulation only; no Cloudflare queue was provisioned.

Rollback the development code and its Wrangler configuration together, stop the new local consumer and retain all added tables/inbox rows for later recovery. Old code ignores the extra tables. **Do not automatically restore the pre-change database copy**, since that would discard records created afterwards. Restoring a database copy is a separate destructive operation requiring explicit review. Export newer owner data first.

Anonymous/shared data is never automatically assigned to the first Google login. A user may explicitly export their existing v5 backup and use the existing confirmed restore UI while signed into their own isolated workspace. The existing restore flow creates a pre-restore backup; it does not transfer identity, Stripe state or shared monitoring ownership. Old IndexedDB attachments are not contained in the JSON backup and are not automatically moved. Original anonymous data remains untouched. There is no completed mass-migration mechanism in this change.

Billing has been retired from the local account build. Earlier acceptance notes are historical.

## UI integration

Account controls and migration are available under Data & Backup on desktop and Account on mobile. The signed-out gate returns only to the fixed `/app/` destination.

Build/run locally:

```sh
# repository root dependencies must already be installed
cd account-sandbox
npm run build:app
npm run dev
```

All generated frontend assets are ignored under `public/app/`. PWA/service-worker generation is disabled only for this account build, avoiding anonymous bootstrap scripts and cached personal responses; the normal build retains its existing PWA behavior.

## Historical verification before billing removal

- 61 account/backend tests: Google protocol validation, stable IDs, replay/revocation, A/B workspace/settings/records/read-state isolation, attachments/backups ownership, CSRF, revisions, invalid payload rejection, signup/portal/cancel scope, inbox/retry, duplicate and out-of-order events, rollback, payment transitions and free capability preservation.
- 70 frontend tests include existing regressions and new memory-store/late-A-response/conflict/recovery/i18n/Billing-outage tests. The separate original Billing suite has 32 tests. Total: **163/163 automated tests passed**, separate from the 12 real Sandbox checks.
- Original Billing prototype regression suite, normal application build, account build, backend dry-run build, typechecks and whitespace checks are run separately. A successful dry-run is not a deployment.
- Actual integrated UI: created `账户隔离验收（仅本地测试）` in the empty account workspace; refresh restored it from D1. Restarted the local service, signed out, confirmed private panels disappeared, signed in through Google, returned directly to `/app/`, and recovered the same test company and active Sandbox Pro.
- **40 built-in-browser combinations**: PC 1440px / mobile 375px × Japanese / Simplified Chinese × Light / Dark × five font steps. No horizontal overflow. New account body text measured 11.9 / 12.88 / 14 / 15.4 / 16.8px. Matrix and screenshots are under `outputs/yami-account-integration/` outside the app source.
- The real Sandbox fixture lifecycle was rerun with the inbox/queue enabled: **12/12 passed**, 2026-10-30 17:56:44–17:57:54 JST (08:56:44–08:57:54 UTC). Natural signed CLI events reached the queue, renewal/failure/recovery/cancellation/re-subscription persisted correctly. That new fixture ended canceled. The owner's Google subscription was not canceled or modified.

## Explicit remaining gaps

1. **Monitoring is only partially accountized.** Local-only tables and authenticated APIs now support account-owned watch subscriptions, canonical source reuse, event de-duplication and per-account read receipts. The account build deliberately does not invoke the legacy shared Watch API, and no scraper/Cron bridge publishes production worker results into these tables. The API explicitly reports `runnerAvailable:false`, `not_connected`, `paused`, and Entry `unknown`; it must not be read as active monitoring. A reviewed worker bridge and account-owned UI integration remain necessary before this mode can replace production Yami. Existing shared production monitoring remains untouched.
2. A/B access checks are automated with separate synthetic, server-verified identities in disposable D1. A second real Google account, separate physical devices, real iPhone Safari/PWA and desktop Safari/Chrome have not all been exercised. Browser viewport checks are not physical-device certification.
3. This remains a localhost development backend: HTTP-only loopback cookies, Testing OAuth audience and placeholder/local database bindings. It is not publicly deployed or certified as a production identity service. No domain purchase or hosting migration is part of this task.
4. Public deployment would still need security/rate-limit/session lifecycle/recovery/operations review and actual account-scoped monitoring. Live payment activation remains prohibited without a separate explicit authorization.

## Local legacy-data transfer and personal-watch foundation (2026-10-30)

- The ordinary Yami build now has an explicit **account transfer package export** in Data & Backup. It reads an allowlist of app data/settings from localStorage, existing attachment and backup IndexedDB stores, hashes each binary, and leaves the source untouched. It does not export watch access tokens, billing state, or global monitoring records. V4 application data and regular v5 JSON backups are normalized without deleting the original data.
- In the signed-in account build, the user selects a package, receives a server-side preview of additions, duplicates and conflicts, then explicitly confirms. The server takes a complete owner-scoped workspace and file snapshot before merging; matching IDs/content deduplicate, conflicting existing items are retained, and a recent import can be rolled back to that pre-import state. Revision checks prevent importing against a workspace changed since preview. All file and workspace operations derive the owner from the validated session. Repeated committed fingerprints are rejected. Import is additive and is never triggered on login.
- A normal JSON backup may not contain attachment binaries; import blocks when referenced attachments are missing. The local prototype has a 1 MB per-request/file cap and may reject large packages without changing the account. A transfer must be exported on the original browser origin/profile that owns the legacy localStorage/IndexedDB. No source package has yet been supplied, so no real user data has been imported or moved.
- Local-only additive migrations `0003_user_imports.sql` and `0004_personal_watch.sql` were applied to the isolated account D1 emulator after copying its state to an ignored local backup directory. They add import/rollback snapshots and account-owned watch-source/subscription/event/read tables; no production DB was used.
- Synthetic two-user tests exercise owner checks for migration packages/files, duplicate/conflicting imports, pre-import rollback, canonical shared-source reuse, event delivery and independent read state. This is automated isolation evidence, not a real second-Google-account test. A real second account and separate device remain unverified.
- The personal-watch schema reuses a canonical URL once when multiple test users subscribe, while company subscriptions and notification read receipts are user-scoped. It does **not** schedule or scrape sources, nor change MyNavi Entry, health notifications, dedupe or Cron. Those algorithms are intentionally unchanged and remain production-shared until a separately reviewed bridge exists.

No credentials need to be resent. The existing configured Google development client and Stripe Sandbox were reused, without expanding OAuth scopes.

## File map

- Existing UI entry points: `src/main.tsx`, `src/App.tsx`, `src/plans/PlanSettings.tsx`.
- Storage/notification compatibility: `src/backups.ts`, `src/watch/WatchProvider.tsx`, `src/watch/productUpdates.ts`.
- New account frontend modules: `src/account/AccountBoundary.tsx`, `storage.ts`, `workspaceStore.ts`, `recovery.ts`, `i18n.ts`, `account.css`.
- Legacy import and transfer: `src/account/legacyTransfer.ts`, `src/account/AccountMigrationPanel.tsx`, `account-sandbox/src/imports.ts`.
- Personal monitoring ownership foundation: `account-sandbox/src/personalWatch.ts` and `account-sandbox/migrations/0004_personal_watch.sql` (runner not connected).
- Backend: `account-sandbox/src/index.ts`, `workspace.ts`, `imports.ts`, and the local `wrangler.jsonc` configuration.
- Additive schemas: `account-sandbox/migrations/0002_user_workspace.sql`, `0003_user_imports.sql`, `0004_personal_watch.sql`.
- Build/config: `vite.config.ts`, `tsconfig.app.json`, `account-sandbox/scripts/build-app.mjs`, `account-sandbox/package.json`, its ignore file and lab navigation HTML/copy.
- Tests: `test/account-store.test.ts`, `account-sandbox/test/workspace.test.ts`, plus expanded `auth.test.ts`.
- Documentation: this audit, `account-sandbox/README.md`; existing Sandbox validation artifacts are retained.
