import * as oidc from 'openid-client';
import { AuthError, CALLBACK, GOOGLE_ISSUER, type GooglePort } from './auth';

export function portFromConfiguration(config: oidc.Configuration): GooglePort {
  const server = config.serverMetadata();
  if (server.issuer !== GOOGLE_ISSUER) throw new AuthError('UNEXPECTED_OIDC_ISSUER', 503);
  for (const value of [server.authorization_endpoint, server.token_endpoint, server.jwks_uri]) {
    if (!value) throw new AuthError('INCOMPLETE_OIDC_METADATA', 503);
    const endpoint = new URL(value);
    if (endpoint.protocol !== 'https:' || !['accounts.google.com', 'oauth2.googleapis.com', 'www.googleapis.com'].includes(endpoint.hostname) || endpoint.username || endpoint.password) throw new AuthError('UNEXPECTED_OIDC_ENDPOINT', 503);
  }
  config.timeout = 8;
  // Validate JWT signatures against Google's JWKS in addition to the TLS-secured code exchange.
  oidc.enableNonRepudiationChecks(config);
  return {
    async authorization(state, nonce, verifier) {
      return oidc.buildAuthorizationUrl(config, { redirect_uri: CALLBACK, scope: 'openid email', response_type: 'code', state, nonce,
        code_challenge: await oidc.calculatePKCECodeChallenge(verifier), code_challenge_method: 'S256', prompt: 'select_account' }).href;
    },
    async exchange(url, state, flow) {
      const tokens = await oidc.authorizationCodeGrant(config, url, { expectedState: state, expectedNonce: flow.nonce, pkceCodeVerifier: flow.verifier, idTokenExpected: true });
      const claims = tokens.claims();
      if (!claims || claims.iss !== GOOGLE_ISSUER || typeof claims.sub !== 'string' || !claims.sub || typeof claims.email !== 'string' || claims.email_verified !== true || (claims.azp !== undefined && claims.azp !== config.clientMetadata().client_id)) throw new AuthError('INVALID_GOOGLE_IDENTITY');
      return { issuer: GOOGLE_ISSUER, subject: claims.sub, email: claims.email, emailVerified: true };
    },
  };
}
let cached: { clientId: string; secret: string; pending: Promise<GooglePort> } | undefined;
export function googlePort(clientId?: string, secret?: string): Promise<GooglePort> {
  if (!clientId?.endsWith('.apps.googleusercontent.com') || !secret) throw new AuthError('GOOGLE_NOT_CONFIGURED', 503);
  if (!cached || cached.clientId !== clientId || cached.secret !== secret) {
    const pending = oidc.discovery(new URL(GOOGLE_ISSUER), clientId, secret, undefined, { timeout: 8 }).then(portFromConfiguration);
    cached = { clientId, secret, pending };
    void pending.catch(() => { if (cached?.pending === pending) cached = undefined; });
  }
  return cached.pending;
}
