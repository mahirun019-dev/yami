# Account acceptance, 2026-10-31 (JST)

Historical record: the local billing prototype was subsequently retired. The Pro/Sandbox verification steps below no longer apply.

## Real public-page checks

Executed `account-sandbox/scripts/live-watch-acceptance.ts` in disposable Miniflare D1.
Two automatic short acceptance timers ran at approximately 04:11:37 and 04:11:53 JST.
These timers do not count as natural six-hour scheduled Worker executions.
No Google user workspace, production database, subscription or notification was modified.

| Source | HTTP | Identity | First / repeat result |
| --- | --- | --- | --- |
| Aiming HRMOS job 2210232845074915332 | 200 | Aiming matched | healthy; 3408-character valid snapshot; unchanged SHA-256 on repeat |
| MyNavi corp292189 (Recomot) | 200 | Recomot matched | healthy; Entry open; verified company-specific `/28/pc/corp292189/list.html` |

Both checks completed for both sources; zero events and zero account deliveries on
first baseline and unchanged repeat. No real opening transition or upstream outage
occurred during this observation. Notification generation, outage debounce and
recovery therefore remain supported by controlled tests, not falsely claimed as
live website transitions. Raw sanitized result: ignored local file
`account-sandbox/.wrangler/live-watch-acceptance.json`.

The local account DB had zero `account_watch_runs` rows when inspected. The running
launcher schedules 00:17/06:17/12:17/18:17 UTC (09:17/15:17/21:17/03:17 JST).
Natural six-hour acceptance remains pending; keep the Mac awake and the local
development process running. HTTP invocation alone is not evidence of full success:
read the run outcome plus all enabled targets' check times after the due slot.
No Codex automation was created and no production scheduled endpoint was called.

## Actual interface inspection

The in-app browser loaded the signed-in account app, account watch settings and
migration panel. Current signed-in Google account shows Free/not subscribed and an
empty workspace. No test enterprise was inserted there and no Stripe operation was
performed. This is not a completed two-real-account round trip, nor Safari/Chrome
or iPhone/PWA certification.

## Defect found and fixed

Imported raw pre-v5 archives have non-timestamp IDs. The account backup list had
converted them to NaN and requested an invalid URL. It now distinguishes raw
archives from timestamped restorable v5 snapshots. Raw bytes remain retained.
Automatic five-backup retention could also delete imported backup files; committed
import-manifest files are now excluded from that pruning. Regression tests verify
archive selection and imported-file survival after seven new automatic backups.
No schema change or production data edit is needed.

## Complete legacy export: approval required before publication

Existing standard JSON contains companies/stages, schedules, resources, interviews,
preparation and theme/locale/preferences/templates. It contains attachment references,
not attachment binaries, and does not include the saved IndexedDB backup history.
It is not sufficient for complete migration.

The existing one-time transfer exporter reads the original browser's allowlisted
localStorage and both IndexedDB stores, verifies attachment references and writes a
checksummed local download. It excludes shared access tokens, Google/Stripe identity
and global monitoring data. Original stores are read-only and are not cleared.
It is implemented but has not been deployed to the original GitHub Pages origin.

Safe procedure after explicit approval for an exporter-only release:
1. Publish only the export entry, without switching account mode or changing storage.
2. In the exact original browser/profile, use Settings > Data & Backup > account
   transfer export. Keep this file and the old browser stores unchanged.
3. Sign in to the desired local Google account. Select the file in Plans > account
   migration; inspect new/duplicate/conflict/file counts. Confirm only after review.
4. The importer snapshots that account before commit, retains existing conflicting
   records, and allows rollback. Refresh and verify records/files; re-import must
   not duplicate them. Rollback restores the pre-import account, including files,
   and discards subsequent changes only after explicit confirmation.

Do not open a copied localhost page expecting it to see github.io storage. Current
1 MB per-file/request lab limits can block larger attachments; never omit them to
make the import succeed. No real production-origin export/import has occurred.

## Owner-assisted account/device steps

1. Open the exact `http://127.0.0.1:8790/app/` in two separate desktop browser profiles
   (Safari and Chrome are suitable). Both Google accounts must be authorized Testing
   users of the existing Google development app. The owner must perform login/consent.
2. Sign into original Sandbox Pro account A in one profile; confirm Pro. In account B,
   confirm Free and a separate workspace. Add an unmistakable disposable record in A;
   B must not see it. Repeat with one attachment and a monitoring subscription.
3. Mark one account's notification read; the other account's own receipt must remain
   unchanged. Sign A out, reload, then log A back in: private content must be hidden
   while logged out, then A's own data/plan must return. Do not purchase or cancel
   subscriptions solely to perform this comparison.

Desktop localhost works separately in Safari/Chrome on the same Mac. An iPhone's
127.0.0.1 is the phone, not the Mac. The current backend explicitly rejects other
origins and the account build disables its service worker. Thus authenticated
iPhone Safari/PWA testing is BLOCKED, not passed. A future isolated HTTPS test
deployment, Google callback configuration and secure session policy are required;
a Cloudflare test hostname is sufficient in principle, with no domain purchase.
Do not tunnel the HTTP-only loopback app or weaken its origin checks to bypass this.

## Remaining release gates

- Natural scheduled execution and prolonged live upstream failure/recovery evidence.
- Real A/B Google account round-trip and Safari/Chrome authenticated comparison.
- Complete original-origin export/import with real attachments, and larger-file support.
- Isolated HTTPS/device test configuration and account-mode PWA acceptance.
- Production security/operations review and separately approved deployment/migration.
- Stripe remains Sandbox. All existing free capabilities remain unchanged.
