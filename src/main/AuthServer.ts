import { shell } from 'electron';
import { randomBytes, createHash } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Loopback OAuth + PKCE for Google sign-in.
 *
 * Flow: listen on 127.0.0.1:<random>, open Google consent in the system
 * browser, catch the redirect, exchange code for id_token, return it to the
 * renderer. Renderer then calls signInWithCredential() against Firebase.
 *
 * Desktop-type OAuth clients don't have a real secret per RFC 8252, but
 * Google still requires it in the token request — we treat it as public.
 */
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

const CLIENT_ID = process.env.VITE_GOOGLE_DESKTOP_CLIENT_ID ?? '';
const CLIENT_SECRET = process.env.VITE_GOOGLE_DESKTOP_CLIENT_SECRET ?? '';

interface PendingLogin {
  state: string;
  codeVerifier: string;
  redirectUri: string;
  resolve: (result: { idToken: string }) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  server: http.Server;
}

export class AuthServer {
  private pending: PendingLogin | null = null;

  async startGoogleLogin(): Promise<{ idToken: string }> {
    if (!CLIENT_ID) {
      throw new Error(
        'VITE_GOOGLE_DESKTOP_CLIENT_ID is not set. Add it to .env.local and restart.',
      );
    }
    if (this.pending) {
      throw new Error('A sign-in is already in progress.');
    }

    const state = randomBytes(32).toString('hex');
    const codeVerifier = base64url(randomBytes(32));
    const codeChallenge = base64url(
      createHash('sha256').update(codeVerifier).digest(),
    );

    const server = http.createServer();
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const port = (server.address() as AddressInfo).port;
    const redirectUri = `http://127.0.0.1:${port}/callback`;

    return new Promise<{ idToken: string }>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.finish(new Error('Sign-in timed out.'));
      }, LOGIN_TIMEOUT_MS);

      this.pending = {
        state,
        codeVerifier,
        redirectUri,
        resolve,
        reject,
        timer,
        server,
      };

      server.on('request', (req, res) => void this.handleRequest(req, res));

      const authUrl = new URL(GOOGLE_AUTH_URL);
      authUrl.searchParams.set('client_id', CLIENT_ID);
      authUrl.searchParams.set('redirect_uri', redirectUri);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('scope', 'openid email profile');
      authUrl.searchParams.set('code_challenge', codeChallenge);
      authUrl.searchParams.set('code_challenge_method', 'S256');
      authUrl.searchParams.set('state', state);
      authUrl.searchParams.set('prompt', 'select_account');

      void shell.openExternal(authUrl.toString()).catch((err) => {
        this.finish(err instanceof Error ? err : new Error(String(err)));
      });
    });
  }

  private async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const pending = this.pending;
    if (!pending) {
      respondText(res, 404, 'Not found');
      return;
    }

    // Drive-by browser tabs may hit this port; require the exact Host header.
    const expectedHost = pending.redirectUri.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (req.headers.host !== expectedHost) {
      respondText(res, 400, 'Bad host');
      return;
    }

    const url = new URL(req.url ?? '/', pending.redirectUri);
    if (url.pathname !== '/callback') {
      respondText(res, 404, 'Not found');
      return;
    }

    const err = url.searchParams.get('error');
    if (err) {
      respondHtml(res, 400, renderClosePage(`Sign-in failed: ${err}`));
      this.finish(new Error(`Google returned error: ${err}`));
      return;
    }

    const code = url.searchParams.get('code');
    const returnedState = url.searchParams.get('state');
    if (!code || returnedState !== pending.state) {
      respondHtml(res, 400, renderClosePage('Invalid sign-in response.'));
      this.finish(new Error('Invalid OAuth callback (state mismatch).'));
      return;
    }

    try {
      const idToken = await exchangeCodeForIdToken({
        code,
        codeVerifier: pending.codeVerifier,
        redirectUri: pending.redirectUri,
      });
      respondHtml(res, 200, renderClosePage("You're signed in. You can close this tab."));
      this.finish(null, { idToken });
    } catch (tokenErr) {
      respondHtml(res, 500, renderClosePage('Could not complete sign-in.'));
      this.finish(
        tokenErr instanceof Error ? tokenErr : new Error(String(tokenErr)),
      );
    }
  }

  private finish(err: Error | null, result?: { idToken: string }): void {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    clearTimeout(pending.timer);
    pending.server.close();
    if (err) pending.reject(err);
    else if (result) pending.resolve(result);
  }
}

async function exchangeCodeForIdToken(params: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: params.code,
    redirect_uri: params.redirectUri,
    client_id: CLIENT_ID,
    code_verifier: params.codeVerifier,
  });
  if (CLIENT_SECRET) body.set('client_secret', CLIENT_SECRET);

  const resp = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Token exchange failed (${resp.status}): ${text}`);
  }
  const json = (await resp.json()) as { id_token?: string };
  if (!json.id_token) throw new Error('Token exchange returned no id_token.');
  return json.id_token;
}

function base64url(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function respondText(res: http.ServerResponse, status: number, body: string): void {
  res.statusCode = status;
  res.setHeader('content-type', 'text/plain; charset=utf-8');
  res.end(body);
}

function respondHtml(res: http.ServerResponse, status: number, body: string): void {
  res.statusCode = status;
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(body);
}

function renderClosePage(message: string): string {
  const safe = message.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Fluxx</title>
<style>body{background:#09090b;color:#e4e4e7;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.card{max-width:420px;padding:32px;border-radius:12px;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.02);text-align:center}
h1{margin:0 0 8px;font-size:18px;font-weight:600}
p{margin:0;color:#a1a1aa;font-size:14px}</style></head>
<body><div class="card"><h1>Fluxx</h1><p>${safe}</p></div>
<script>setTimeout(function(){window.close();},500);</script></body></html>`;
}
