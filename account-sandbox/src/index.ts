import { AuthError, CALLBACK, FLOW_COOKIE, LOCAL_ORIGIN, SESSION_COOKIE, beginFlow, consumeFlow, cookie, cookieHeader, currentSession, establishSession, hash, type GooglePort } from './auth';
import { googlePort } from './google';
import { workspaceRequest } from './workspace';
import {runAccountWatch} from './watchRunner';
export interface Env { AUTH_ENV: string; ACCOUNT_DB: D1Database; GOOGLE_CLIENT_ID?: string; GOOGLE_CLIENT_SECRET?: string; ASSETS: Fetcher }
const securityHeaders = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; form-action 'none'" };
const DESTINATION_COOKIE='yami_local_google_destination';
const APP_DESTINATION='app'+'_'.repeat(40);
const json = (value: unknown, status = 200, cookies: string[] = []) => {
  const headers = new Headers({ ...securityHeaders, 'content-type': 'application/json' });
  for (const value of cookies) headers.append('set-cookie', value);
  return new Response(JSON.stringify(value), { status, headers });
};
const redirect = (location: string, cookies: string[] = []) => {
  const headers = new Headers({ ...securityHeaders, location });
  for (const value of cookies) headers.append('set-cookie', value);
  return new Response(null, { status: 303, headers });
};
export function createHandler(factory: (env: Env) => Promise<GooglePort> = env => googlePort(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET)) {
  return async (request: Request, env: Env): Promise<Response> => {
    const url = new URL(request.url);
    if (env.AUTH_ENV !== 'local-google-test' || url.origin !== LOCAL_ORIGIN) return json({ error: 'LOCAL_ACCOUNT_TEST_ONLY' }, 403);
    if (url.pathname === '/api/workspace' || url.pathname.startsWith('/api/files/') || url.pathname === '/api/migrations' || url.pathname.startsWith('/api/migrations/') || url.pathname === '/api/watch/run' || url.pathname === '/api/watch/targets' || url.pathname.startsWith('/api/watch/targets/') || url.pathname === '/api/watch/events' || url.pathname.startsWith('/api/watch/events/')) return workspaceRequest(request,env);
    const callback = url.pathname === '/auth/google/callback';
    try {
      if (request.method === 'GET' && url.pathname === '/api/session') {
        const session = await currentSession(env.ACCOUNT_DB, cookie(request, SESSION_COOKIE));
        return json({ configured: Boolean(env.GOOGLE_CLIENT_ID?.endsWith('.apps.googleusercontent.com') && env.GOOGLE_CLIENT_SECRET), authenticated: Boolean(session), user: session, environment: 'local-google-test', callback: CALLBACK });
      }
      if (request.method === 'POST' && ['/auth/google/start', '/auth/logout'].includes(url.pathname)) {
        if (request.headers.get('origin') !== LOCAL_ORIGIN) throw new AuthError('ORIGIN_DENIED', 403);
        const body = await request.text();
        if (body.trim() && body.trim() !== '{}') throw new AuthError('CLIENT_IDENTITY_FORBIDDEN');
        if (url.pathname === '/auth/logout') {
          const asserted=request.headers.get('x-yami-user');
          if(asserted&&(await currentSession(env.ACCOUNT_DB,cookie(request,SESSION_COOKIE)))?.userId!==asserted)throw new AuthError('ACCOUNT_CHANGED',409);
          const session = cookie(request, SESSION_COOKIE);
          const flow = cookie(request, FLOW_COOKIE);
          const mutations = [];
          if (session) mutations.push(env.ACCOUNT_DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await hash(session)));
          if (flow) mutations.push(env.ACCOUNT_DB.prepare('DELETE FROM login_transactions WHERE browser_hash=?').bind(await hash(flow)));
          if (mutations.length) await env.ACCOUNT_DB.batch(mutations);
          return json({ loggedOut: true }, 200, [cookieHeader(SESSION_COOKIE, '', 0), cookieHeader(FLOW_COOKIE, '', 0),cookieHeader(DESTINATION_COOKIE,'',0)]);
        }
        const provider = await factory(env);
        const flow = await beginFlow(env.ACCOUNT_DB, cookie(request, FLOW_COOKIE));
        const authorization = await provider.authorization(flow.state, flow.flow.nonce, flow.flow.verifier);
        const target = new URL(authorization);
        if (target.origin !== 'https://accounts.google.com') throw new AuthError('INVALID_AUTHORIZATION_URL');
        // Only two fixed local destinations; no client-controlled redirect URL or authority.
        return json({ url: authorization }, 200, [cookieHeader(FLOW_COOKIE, flow.browser, 600),cookieHeader(DESTINATION_COOKIE,url.searchParams.get('app')==='1'?APP_DESTINATION:'lab'+'_'.repeat(40),600)]);
      }
      if (request.method === 'GET' && callback) {
        const state = url.searchParams.get('state');
        if (url.searchParams.getAll('state').length !== 1) throw new AuthError('INVALID_LOGIN_FLOW');
        const flow = await consumeFlow(env.ACCOUNT_DB, state, cookie(request, FLOW_COOKIE));
        if (url.searchParams.has('error')) return redirect('/?auth_error=declined', [cookieHeader(FLOW_COOKIE, '', 0)]);
        if (!url.searchParams.get('code') || url.searchParams.getAll('code').length !== 1) throw new AuthError('INVALID_LOGIN_FLOW');
        const provider = await factory(env);
        const identity = await provider.exchange(url, state!, flow);
        const session = await establishSession(env.ACCOUNT_DB, identity, cookie(request, SESSION_COOKIE));
        return redirect(cookie(request,DESTINATION_COOKIE)===APP_DESTINATION?'/app/':'/', [cookieHeader(SESSION_COOKIE, session.raw, 86400), cookieHeader(FLOW_COOKIE, '', 0),cookieHeader(DESTINATION_COOKIE,'',0)]);
      }
      if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) return json({ error: 'NOT_FOUND' }, 404);
      const assetRequest = url.pathname.startsWith('/app/') && !url.pathname.split('/').pop()?.includes('.')
        ? new Request(new URL('/app/',url),request) : request;
      const response = await env.ASSETS.fetch(assetRequest);
      if (url.pathname.startsWith('/app/')) {
        const appResponse=new Response(response.body,{status:response.status,headers:{...Object.fromEntries(response.headers),...securityHeaders,'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' https://geocoding-api.open-meteo.com https://api.open-meteo.com; img-src 'self' data: blob:; font-src 'self' data:; frame-ancestors 'none'; form-action 'self'"}});
        // Legacy anonymous-storage bootstrap scripts must not execute in the account build.
        return response.headers.get('content-type')?.includes('text/html')
          ? new HTMLRewriter().on('script',{element(element){if(!element.getAttribute('src'))element.remove();}}).transform(appResponse) : appResponse;
      }
      return new Response(response.body, { status: response.status, headers: new Headers({ ...Object.fromEntries(response.headers), ...securityHeaders }) });
    } catch (error) {
      // Never log auth codes, token responses, state, nonce, cookie values or personal information.
      if (callback) return redirect('/?auth_error=signin_failed', [cookieHeader(FLOW_COOKIE, '', 0)]);
      return json({ error: error instanceof AuthError ? error.code : 'ACCOUNT_SERVICE_UNAVAILABLE' }, error instanceof AuthError ? error.status : 503);
    }
  };
}
export default { fetch: createHandler(), async scheduled(_event:ScheduledController,env:Env,ctx:ExecutionContext){ctx.waitUntil(runAccountWatch(env));} };
