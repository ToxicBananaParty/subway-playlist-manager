import 'dotenv/config';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import open from 'open';

const REDIRECT_URI =
  process.env.SPOTIFY_REDIRECT_URI ?? 'http://127.0.0.1:8888/callback';
const SCOPE =
  'playlist-read-private playlist-read-collaborative playlist-modify-public playlist-modify-private';
const PORT = 8888;

function generateState(): string {
  return randomBytes(16).toString('hex');
}

async function exchangeCodeForTokens(
  code: string,
  clientId: string,
  clientSecret: string
): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
}> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
  }).toString();

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString(
    'base64'
  );

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${credentials}`,
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };
  return data;
}

function runServer(
  clientId: string,
  clientSecret: string,
  state: string,
  resolve: (value: void) => void
): http.Server {
  const server = http.createServer(
    async (req: http.IncomingMessage, res: http.ServerResponse) => {
      const url = req.url ?? '';
      if (!url.startsWith('/callback')) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      const q = url.includes('?') ? url.slice(url.indexOf('?') + 1) : '';
      const params = new URLSearchParams(q);
      const code = params.get('code');
      const returnedState = params.get('state');
      const error = params.get('error');

      if (error) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(
          `<p>Authorization failed: ${error}</p><p>You can close this tab.</p>`
        );
        server.close();
        resolve();
        return;
      }

      if (returnedState !== state) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(
          '<p>State mismatch. Please try again.</p><p>You can close this tab.</p>'
        );
        server.close();
        resolve();
        return;
      }

      if (!code) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(
          '<p>No authorization code received.</p><p>You can close this tab.</p>'
        );
        server.close();
        resolve();
        return;
      }

      try {
        const tokens = await exchangeCodeForTokens(
          code,
          clientId,
          clientSecret
        );
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(
          '<p>Success! You can close this tab.</p><p>Check the terminal for your refresh token.</p>'
        );

        console.log('\nAdd this to your .env:\n');
        console.log(`SPOTIFY_REFRESH_TOKEN=${tokens.refresh_token}\n`);
        console.log('(Copy the line above into your .env file.)\n');
      } catch (err) {
        console.error('Token exchange error:', err);
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(
          `<p>Error: ${err instanceof Error ? err.message : String(err)}</p><p>You can close this tab.</p>`
        );
      } finally {
        server.close();
        resolve();
      }
    }
  );

  server.listen(PORT, () => {
    const authUrl =
      'https://accounts.spotify.com/authorize?' +
      new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        scope: SCOPE,
        redirect_uri: REDIRECT_URI,
        state,
      }).toString();
    open(authUrl);
    console.log(
      `Server listening on http://localhost:${PORT}. If the browser did not open, visit:\n${authUrl}\n`
    );
  });

  return server;
}

async function main(): Promise<void> {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error('Missing SPOTIFY_CLIENT_ID or SPOTIFY_CLIENT_SECRET in .env');
    process.exit(1);
  }

  const state = generateState();

  await new Promise<void>((resolve) => {
    runServer(clientId, clientSecret, state, resolve);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
