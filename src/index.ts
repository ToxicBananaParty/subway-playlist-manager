import 'dotenv/config';
import { SpotifyApi } from '@spotify/web-api-ts-sdk';
import type { AccessToken } from '@spotify/web-api-ts-sdk';

/** Track/episode object nested under item in GET /playlists/{id}/items response */
interface PlaylistItemTrack {
  uri: string;
  name: string;
  artists?: Array<{ name: string }>;
}

/** Response shape for GET /playlists/{id}/items */
interface PlaylistItemsPage {
  items: Array<{
    item: PlaylistItemTrack | null;
    track?: boolean;
  }>;
  total: number;
  limit: number;
  offset: number;
  next: string | null;
}

async function refreshAccessToken(): Promise<AccessToken> {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  const refreshToken = process.env.SPOTIFY_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      'Missing SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, or SPOTIFY_REFRESH_TOKEN in .env'
    );
  }

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
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
    throw new Error(`Token refresh failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    token_type: string;
    expires_in: number;
    refresh_token?: string;
  };

  return {
    access_token: data.access_token,
    token_type: data.token_type,
    expires_in: data.expires_in,
    refresh_token: data.refresh_token ?? refreshToken,
  };
}

/**
 * Fetches all tracks from a playlist via GET /playlists/{id}/items (non-deprecated).
 * Returns a Map of URI → display name ("Artist – Track Name"). Skips local files and items with no URI.
 */
async function getAllPlaylistTracks(
  spotifyApi: SpotifyApi,
  playlistId: string
): Promise<Map<string, string>> {
  const uriToName = new Map<string, string>();
  const limit = 50;
  let offset = 0;

  while (true) {
    const page = await spotifyApi.makeRequest<PlaylistItemsPage>(
      'GET',
      `playlists/${playlistId}/items?limit=${limit}&offset=${offset}`
    );

    for (const entry of page.items) {
      const item = entry.item;
      if (!item?.uri) continue;

      const artists = item.artists?.map((a) => a.name).join(', ') ?? '';
      const displayName = artists ? `${artists} – ${item.name}` : item.name;
      uriToName.set(item.uri, displayName);
    }

    offset += page.items.length;
    if (!page.next || page.items.length === 0) break;
  }

  return uriToName;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

async function main(): Promise<void> {
  const masterPlaylistId = process.env.PARENT_SUBWAY_PLAYLIST_ID;
  const childCalmId = process.env.CHILD_PLAYLIST_CALM_ID;
  const childBusyId = process.env.CHILD_PLAYLIST_BUSY_ID;

  if (!masterPlaylistId || !childCalmId || !childBusyId) {
    throw new Error(
      'Missing PARENT_SUBWAY_PLAYLIST_ID, CHILD_PLAYLIST_CALM_ID, or CHILD_PLAYLIST_BUSY_ID in .env'
    );
  }

  const accessToken = await refreshAccessToken();
  const clientId = process.env.SPOTIFY_CLIENT_ID!;
  const spotifyApi = SpotifyApi.withAccessToken(clientId, accessToken);

  console.log('Fetching playlist tracks...');
  const [masterTracks, calmTracks, busyTracks] = await Promise.all([
    getAllPlaylistTracks(spotifyApi, masterPlaylistId),
    getAllPlaylistTracks(spotifyApi, childCalmId),
    getAllPlaylistTracks(spotifyApi, childBusyId),
  ]);

  // Desired state: union of both child playlists
  const desiredTracks = new Map<string, string>([...calmTracks, ...busyTracks]);

  const toAdd = [...desiredTracks.entries()].filter(
    ([uri]) => !masterTracks.has(uri)
  );
  const toRemove = [...masterTracks.entries()].filter(
    ([uri]) => !desiredTracks.has(uri)
  );

  // Add missing tracks in batches of 100 (POST /playlists/{id}/items)
  for (const batch of chunk(
    toAdd.map(([uri]) => uri),
    100
  )) {
    await spotifyApi.makeRequest(
      'POST',
      `playlists/${masterPlaylistId}/items`,
      {
        uris: batch,
      }
    );
  }

  // Remove extra tracks in batches of 100 (DELETE /playlists/{id}/items)
  for (const batch of chunk(
    toRemove.map(([uri]) => uri),
    100
  )) {
    await spotifyApi.makeRequest(
      'DELETE',
      `playlists/${masterPlaylistId}/items`,
      { items: batch.map((uri) => ({ uri })) }
    );
  }

  console.log('\nSync complete.');
  if (toAdd.length === 0 && toRemove.length === 0) {
    console.log('No changes needed – master playlist is already up to date.');
    return;
  }

  if (toAdd.length > 0) {
    console.log(`\nAdded ${toAdd.length} track(s):`);
    for (const [, name] of toAdd) {
      console.log(`  + ${name}`);
    }
  }

  if (toRemove.length > 0) {
    console.log(`\nRemoved ${toRemove.length} track(s):`);
    for (const [, name] of toRemove) {
      console.log(`  - ${name}`);
    }
  }
}

main().catch(console.error);
