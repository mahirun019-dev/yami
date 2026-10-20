# Yami Frontend Releases

## Current state

As of 2026-10-20 the project has no published GitHub Release or version tag.
`package.json` contains the original tooling version `1.0.0`; it is not evidence
of an official product release. Historical announcements have no assigned version.
The About page therefore shows an unmarked formal version, not an invented number.

## Release record

`src/watch/productUpdates.ts` is the single source for product announcements and
the About update history. Every production product update needs one bilingual
announcement with a stable unique ID and the actual release date. Reuse the same
ID for corrections to a release. Never alter historical read IDs or create a
company-monitoring event to announce a product release.

When the maintainer explicitly designates a formal version, add a stable SemVer
`version` field (major.minor.patch) to that release's announcement. Do not assign
versions retroactively without evidence. No version is inferred from commit
counts, dates, or package.json. The most recent versioned record supplies the
formal version and date. Unversioned updates do not auto-increment that version.

For future formal releases, use patch for compatible fixes, minor for compatible
features, and major for incompatible changes. The initial formal version must be
explicitly chosen by the maintainer, not guessed by a coding agent. A matching
GitHub tag/release can then document the same already-chosen version.

## Build identity and licensing

Vite embeds `GITHUB_SHA`, already provided by GitHub Actions, with a local Git SHA
fallback. This is a diagnostic build identifier, not a user-facing version. An
unavailable SHA is shown as unavailable. No timestamp is fabricated as a release date.

The build reads a root project LICENSE file if one exists, and the real license
files shipped with the main runtime libraries. Third-party MIT/ISC licenses do
not license Yami itself or its brand assets. No project license is assigned by this change.

## Publishing

The existing main-branch GitHub Pages workflow is unchanged. Before publishing,
run typecheck, frontend tests, build and git diff --check. After publishing, verify
the About build identity and the new announcement in the product notification feed.
No Worker deployment, D1 migration, URL change, or monitoring baseline reset is
part of a frontend release.
