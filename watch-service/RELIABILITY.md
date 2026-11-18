# Watch check reliability

## Bounds and diagnostics

- Cron remains `17 */6 * * *` (UTC); no separate scheduler or manual trigger is required.
- Four sources run concurrently, as before. MIXI detail pages are read sequentially within a source.
- A request has at most two attempts. A natural run shares at most three extra attempts across all sources.
- DNS timeout: 5 seconds; robots timeout: 8 seconds; page/API timeout: 12 seconds, including response body reads.
- Backoff is capped at 1 second. A longer or invalid Retry-After defers the retry rather than violating it.
- Each source has a 45-second wall-clock request budget within a 90-second run request budget. These are not CPU limits.
- DNS verification and raw robots responses are cached only within one run. Robots permissions are still checked separately for every URL.
- Responses exceeding 1,500,000 bytes are rejected before buffering more content.
- Workers structured console logs contain IDs, phase, status/error codes, elapsed wall time, request/retry counts and completion. They omit page text, names, URLs, headers and exception messages.
- Cloudflare invocation analytics, not application wall timers, supply CPU, memory and platform subrequest metrics.

## Health incidents

`0004_health_debounce.sql` adds only three fields with nullable/default values:
`transient_failure_count`, `health_failure_run_id`, `health_alerted_at`.

Only a new natural run ID increments the temporary-failure count. Request retries and manual health checks do not count as extra natural rounds. The first failure updates health without an event. The second alerts once; subsequent failures remain silent until a successful check resets the incident. High-confidence permanent faults can alert immediately.

The health event and its marker are persisted in one D1 batch transaction. Internal persistence failures and exhausted execution budgets do not become website-health alerts. Budget-deferred sources retain their prior check time, so oldest-first scheduling prioritizes them on the next natural run.

## Baseline safety

A compatible, meaningful snapshot tied to the same URL/source type remains comparable after a temporary health failure. Health recovery alone is not an initialization condition. Missing, invalid or incompatible snapshots initialize silently. Failed requests never overwrite snapshots or hashes.

Manual health-only inspection does not consume a real content change. Normal checks persist unchanged/initial snapshots immediately. Actual changes retain the existing run-wide shared-platform filter before event generation. Uncompleted changes remain retryable against the old baseline.

MyNavi continues to use its separate Entry state machine, identity checks and recommendation exclusion. `entry_status` is written only by verified healthy checks, so a fetch failure never erases the last verified state. After a transient failure, a stored `unavailable`/`reservation`/`closed`/`unknown` followed by `open` notifies once, so an opening during an outage is not lost. When the stored state is uncertain (`needs_review`) or the source is recovering from an identity mismatch, `open` notifies only if no `mynavi_entry_open` event has ever been recorded for that source, which keeps detector flicker from repeating an announcement.

## Encoding, identity and address checks

- Response bodies are decoded with the charset from `Content-Type`, else a UTF-8 BOM, else an HTML `<meta>` declaration in the first 4 KB, so Shift_JIS/EUC-JP recruitment pages are not read as mojibake. Unknown labels fall back to UTF-8.
- Company identity treats Japanese legal forms and English legal suffixes (Inc., Co., Ltd., Corporation, K.K., LLC) as the same company. The UI key in `src/watch/companyStatus.ts` mirrors the Worker key so both sides agree.
- DNS checks query A records first and AAAA only when no A record exists; private, link-local, IPv4-mapped and NAT64 IPv6 answers are rejected like private IPv4.
- `GET /api/targets` returns every unread event plus the latest 100 read events. `DELETE /api/session` revokes the caller's session on disconnect.
- Known limitation: the MIXI adapter only accepts 2028 new-graduate posts (the owner's graduation year). Update that year deliberately when the target year changes.

## Access-code rate limit

`0005_login_attempts.sql` adds one table, `login_attempts`, holding a SHA-256 client key and a timestamp per failed `/api/session` attempt. A client is limited after 5 failures in 15 minutes and all clients after 50, with HTTP 429 and `Retry-After: 900`. A successful login clears that client's failures; expired attempts and expired sessions are deleted on later logins. If the migration has not been applied yet, login keeps working without the limit and logs `LOGIN_RATE_LIMIT_UNAVAILABLE`, so apply the migration before deploying this Worker version.

## Robots policy retrieval

RFC 9309 sections 2.3.1.2-2.3.1.5 guide the robots fetch. Up to five consecutive HTTP redirects are followed manually, including public cross-authority destinations. Every destination uses the existing URL and public-DNS guards; loops, invalid locations and excessive redirects never grant access. Redirected rules are evaluated for the original authority, not the policy host.

Actual HTTP 404/410 is treated as unavailable, retaining the existing allowed-access choice. Access-restricted 401/403, server/network failures and unknown responses remain blocked; RFC permits, but does not require, access after 4xx, so this is intentionally conservative. Existing timeouts and retry budgets remain in force.

HTML error/login documents are not parsed as empty robots files. A 200 HTML soft-404 is logged as `html-soft-404`, not treated as an actual HTTP 404. Recognizable plain-text policies still use parseable rules despite malformed lines. Empty/comment-only and sitemap-only policies remain usable. Other arbitrary content is unverified.

The canonical health error stays `ROBOTS_POLICY_UNVERIFIABLE`; `robots_policy` structured log decisions provide finer diagnostics without resetting an existing health incident or changing notification debounce. A blocked source retains its baseline. Deployment does not itself mark any source healthy.

## Compatibility and rollback

The migration does not update existing URLs, snapshots, events or read flags. The prior Worker can run with the added columns present. To roll back, redeploy the prior Worker version and leave these columns unused; do not drop tables/columns or restore historical data.

## Production acceptance

Deployment does not itself verify monitoring. Use read-only SELECTs and actual scheduled invocation records for at least eight consecutive natural runs. Check version, invocation result, all enabled source timestamps, source completion logs, retained baseline hashes and actual notification transitions. Do not manually invoke Cron or synthesize notifications. A generic `exceededResources` result alone does not identify the limiting resource.
