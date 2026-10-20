# Yami Release Requirements

- Every new Yami version published to production must include a corresponding product update announcement in Yami's notification feed.
- Use the existing product update mechanism in `src/watch/productUpdates.ts`. Include Japanese and Simplified Chinese titles, summaries, and concise user-facing changes.
- Give each released version one stable, unique announcement ID. Amend that same announcement for corrections or retries of the same release; do not create duplicates.
- Use the actual release date. Preserve date-only display for product announcements; do not invent publication times.
- Preserve historical announcements and read/unread state. Do not create company-monitoring events to announce product releases.
- Before publishing, verify that the release announcement is present in the release changes. After publishing, verify it appears in the production notification feed.
- Documentation-only changes that are not published as a product version do not require an announcement.
- Follow `RELEASING.md` for version assignment. Never infer a formal version from package.json, commit counts, or deployment dates; only explicitly versioned product release records qualify.
