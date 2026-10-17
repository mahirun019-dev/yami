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

MyNavi continues to use its separate Entry state machine. Its transition conditions, identity checks, recommendation exclusion and recovery suppression are unchanged.

## Robots policy retrieval

RFC 9309 sections 2.3.1.2-2.3.1.5 guide the robots fetch. Up to five consecutive HTTP redirects are followed manually, including public cross-authority destinations. Every destination uses the existing URL and public-DNS guards; loops, invalid locations and excessive redirects never grant access. Redirected rules are evaluated for the original authority, not the policy host.

Actual HTTP 404/410 is treated as unavailable, retaining the existing allowed-access choice. Access-restricted 401/403, server/network failures and unknown responses remain blocked; RFC permits, but does not require, access after 4xx, so this is intentionally conservative. Existing timeouts and retry budgets remain in force.

HTML error/login documents are not parsed as empty robots files. A 200 HTML soft-404 is logged as `html-soft-404`, not treated as an actual HTTP 404. Recognizable plain-text policies still use parseable rules despite malformed lines. Empty/comment-only and sitemap-only policies remain usable. Other arbitrary content is unverified.

The canonical health error stays `ROBOTS_POLICY_UNVERIFIABLE`; `robots_policy` structured log decisions provide finer diagnostics without resetting an existing health incident or changing notification debounce. A blocked source retains its baseline. Deployment does not itself mark any source healthy.

## Compatibility and rollback

The migration does not update existing URLs, snapshots, events or read flags. The prior Worker can run with the added columns present. To roll back, redeploy the prior Worker version and leave these columns unused; do not drop tables/columns or restore historical data.

## Production acceptance

Deployment does not itself verify monitoring. Use read-only SELECTs and actual scheduled invocation records for at least eight consecutive natural runs. Check version, invocation result, all enabled source timestamps, source completion logs, retained baseline hashes and actual notification transitions. Do not manually invoke Cron or synthesize notifications. A generic `exceededResources` result alone does not identify the limiting resource.
