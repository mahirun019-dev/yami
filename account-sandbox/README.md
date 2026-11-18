# Yami local Google account test

2026-10-31 follow-up: account monitoring now has a local runtime bridge, scheduled
handler and management UI. Earlier "not connected" notes below describe the prior
stage; see [current validation and limitations](../docs/account-watch-validation.md).
No production monitoring service or database was modified.

Independent local Google OIDC login and account-isolated Yami development build. No production deployment is configured.

## Local addresses

- Page/origin: **http://127.0.0.1:8790** (use exactly this host, not `localhost`).
- Google Web OAuth redirect URI: **http://127.0.0.1:8790/auth/google/callback**.
- Database: the account D1 emulator under `.wrangler/state`.

```sh
npm ci
npm run db:local
npm run dev
```

The development launcher binds only to 127.0.0.1, disables Wrangler telemetry and normal access logging, and directs Wrangler's persistent debug log through an ignored `.log` symlink to `/dev/null` so OAuth callback query codes are not saved in access/debug logs. Application code logs no credentials or identity data. This local launcher targets macOS/Linux, not production.

## Google configuration: owner action required

The development Client ID and Secret are configured in ignored `.dev.vars`, mode 600. Do not paste secrets into chat.

Setup progress on 2026-10-30: project `yami-local-account`, Testing application and localhost Web client created with explicit owner authorization; no Google Cloud billing enabled. The owner completed real Google login. The page displayed authenticated server identity and retained it after refresh. The owner account was explicitly approved and added as a test user. Real logout/refresh/relogin is now verified and preserves the same server user ID; a second real Google account remains to be tested.

1. Open [Google Cloud Console > Google Auth Platform > Clients](https://console.cloud.google.com/auth/clients). Sign in personally, then select or create a **separate development project** such as `Yami Local Account`. Do not enable billing, start a paid trial or alter an unrelated production project for this test. If organizational policy requires additional access/billing, stop and review it first.
2. Configure the Google Auth Platform application if prompted. Use a clearly local-testing app name, your own support/developer contact and a suitable audience. For an external consumer test, keep publishing status **Testing** and add only the Google accounts you intend to test under **Test users**. Do not publish the consent screen to production in this task.
3. Configure only the minimal identity scopes used by this app: `openid` and `email`. No Drive, Gmail, contacts, cloud administration, offline Google API access or broad profile scope is requested.
4. Create an OAuth client of type **Web application**. Suggested name: `Yami Local Web 8790`.
5. Set the authorized JavaScript origin to `http://127.0.0.1:8790` if requested. Set the authorized redirect URI to exactly `http://127.0.0.1:8790/auth/google/callback` (no extra slash, no query). No production domain is needed for this local development callback.
6. Save the returned Client ID and Client Secret **directly into local `account-sandbox/.dev.vars`**:

```dotenv
GOOGLE_CLIENT_ID=<your development Web client ID>
GOOGLE_CLIENT_SECRET=<your development Web client secret>
```

The placeholders above are not credentials. Do not commit the file or put these values in frontend `VITE_` variables. You can also download Google's client JSON and keep it outside Git for private configuration; never send its contents through chat. Do not reuse the monitoring access code.

7. Restart only this local service, open the page, and click **Google でログイン / 使用 Google 登录**. Personally review Google's consent screen and authorize only the intended local app and minimal scopes. Do not enter a password into any Yami form; credentials belong only on Google's login page.
8. After returning, the backend must show a real opaque Yami user ID, verified email and session expiry. Refresh; it should stay logged in. Log out; refreshing must remain logged out. In another browser/profile, signing into the same Google subject should produce the same local user ID; another Google account must produce a different ID. This is local identity testing, not cross-device cloud-data sync.

Google's UI labels and organization requirements can differ. Official sources: [Google OIDC](https://developers.google.com/identity/openid-connect/openid-connect), [Web Server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server). No OAuth client creation or consent grant is automated by this prototype.

## Implemented security and data flow

```text
Local page -> same-origin POST /auth/google/start
  -> standard OIDC authorization code flow, S256 PKCE, random state + nonce
  -> Google (owner personally signs in/consents)
  -> fixed local callback, browser cookie + state consumed atomically once
  -> official issuer discovery and token endpoint (TLS), ID Token/JWKS validation
  -> local stable user mapping (issuer, sub), verified email
  -> random 24-hour server-side session, only SHA-256 token hash stored
  -> HttpOnly, SameSite=Lax, host-only cookie
```

- Uses `openid-client` rather than custom OAuth/JWT parsing. Explicit signature/JWKS validation is enabled via `enableNonRepudiationChecks`, in addition to audience, issuer, expiration, state and nonce checks. Google's endpoints are allowlisted to expected HTTPS Google hosts. Token audience/authorized-party mismatches fail closed.
- Scope is `openid email`; the current code does not request refresh tokens or retain Google access/ID tokens. The verified subject and email are stored only in local test D1. Email changes do not change identity, and different subjects sharing an email are not merged.
- Login flows expire in 10 minutes, are bound to an opaque HttpOnly browser cookie and are deleted atomically on consumption. A replay cannot exchange twice. Callback URLs are cleaned by a redirect before rendering the page.
- Sessions expire in 24 hours, rotate after reauthentication, and are revoked on logout. Logout also cancels this browser's pending flow. No localStorage/sessionStorage identity markers. Status comes only from server session lookup.
- POSTs require the exact local Origin and accept no client-provided identity or role. GETs cannot trigger logout. No CORS allowance or arbitrary post-login redirect.
- No `Secure` cookie attribute is used **only because this exact-loopback prototype uses HTTP**. Runtime checks reject all other origins, aliases and environments. Production requires a separate HTTPS/cookie/domain deployment design, not enabling this prototype remotely. Do not expose it with a tunnel/reverse proxy or copy its cookies into production.
- The token/code exchange and provider requests have an 8-second library timeout. Errors are sanitized; failed/denied login never becomes a successful session.
- The test UI sends only same-origin API requests; text uses `textContent`, no external scripts or profile pictures, no password input, no analytics. CSP restricts assets/scripts/connections to self.

## Local tables only

`users`: opaque user ID, Google issuer/subject, verified email and creation/login times.

`sessions`: session hash, user ID and expiry (no raw session token).

`login_transactions`: short-lived state/browser hashes, nonce and PKCE verifier. Expired pending transactions and sessions are cleaned on a new login. These temporary secrets must not be logged or exported.

There is no production migration, automatic import, or linkage to `developer-test-001` or existing shared monitoring records. A user can explicitly export an account-transfer package from the legacy app, preview it in the signed-in local account build, and confirm an additive import with a pre-import snapshot and rollback. Nothing imports on login. Watch tokens, Stripe state, and shared monitoring targets/events are excluded. Standard JSON backups may omit attachment binaries, so import refuses a package with missing referenced files. The transfer must be created in the original browser profile/origin containing the legacy data; no actual legacy user data has been imported yet. Google login itself does not imply Pro or public production sync.

## Verification and limits

```sh
npm run typecheck
npm test
npm run build
node --check public/app.js
```

The build is `wrangler deploy --dry-run`, not an upload. Tests use a disposable D1 emulator, mock OIDC responses and synthetic RSA-signed ID Tokens. The **real `openid-client` code** verifies the signatures and protocol checks in tests; no real Google user is created or logged in by those tests.

Historical automated checks (before billing removal): **61/61 account/backend + 70/70 frontend + 32/32 legacy Billing = 163/163 passing**. Real Google login, session rotation and persistence across local service restart are confirmed. The integrated app passed 40 width/language/theme/font-size combinations without horizontal overflow; these do not certify physical Safari/Chrome/PWA. See the integration audit for the separately reported build results and remaining rollout gates.

Billing has been retired from the local account build. Earlier acceptance notes are historical.

## Existing Yami UI integration

Run `npm run db:local`, `npm run build:app`, then `npm run dev`, and open **http://127.0.0.1:8790/app/**. Account controls and legacy import are under Data & Backup on desktop and Account on mobile.

See [account monitoring and validation](../docs/account-watch-validation.md). The development runner uses only local data and does not connect to production monitoring.

