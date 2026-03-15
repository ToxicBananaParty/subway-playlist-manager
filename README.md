# subway-playlist-manager

Keeps a **master** Subway playlist in sync with two **child** playlists (e.g. “Calm” and “Busy”). The master is the union of both children: it gets every track that appears in either child, and any track that is only in the master is removed.

## Setup

### 1. Spotify app

1. Open [Spotify for Developers](https://developer.spotify.com/dashboard) and create an app.
2. Note the **Client ID** and **Client Secret**.

### 2. Environment and refresh token

1. `npm install`
2. Copy `.env.example` to `.env`.
3. Set `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` in `.env`.
4. Get a refresh token by running the OAuth helper:

   ```bash
   npx tsx scripts/get-refresh-token.ts
   ```

   This will:
   - Start a local server on port 8888 and open your browser to Spotify’s authorization page.
   - After you log in and approve, Spotify redirects to `http://127.0.0.1:8888/callback` (or your `SPOTIFY_REDIRECT_URI`).
   - The script exchanges the authorization code for tokens and prints a line like:
     ```text
     SPOTIFY_REFRESH_TOKEN=...
     ```
   - Copy that line into your `.env` file.

5. **Scopes:** The script requests `playlist-read-private` by default. To allow the sync to **add and remove** tracks, the refresh token must also have `playlist-modify-private` (or `playlist-modify-public`). If you get permission errors when running the sync, add that scope in `scripts/get-refresh-token.ts` (e.g. set `SCOPE = 'playlist-read-private playlist-modify-private'`), then run the script again and put the new refresh token in `.env`.

### 3. Playlist IDs

In `.env`, set:

- `PARENT_SUBWAY_PLAYLIST_ID` – the master playlist (will be updated).
- `CHILD_PLAYLIST_CALM_ID` – first child playlist.
- `CHILD_PLAYLIST_BUSY_ID` – second child playlist.

You can get playlist IDs from the Spotify app (Share → Copy link); the ID is the part after `spotify.com/playlist/`.

## Running the sync

```bash
npm start
```

or:

```bash
npx tsx src/index.ts
```

The script will:

1. Refresh the access token using your refresh token.
2. Fetch all tracks from the master and both child playlists.
3. Add to the master any track that is in a child but not yet in the master (in batches of 100).
4. Remove from the master any track that is not in either child (in batches of 100).
5. Print a summary: “Added N track(s)” and “Removed N track(s)” with song names (e.g. `Artist – Track Name`), or “No changes needed” if the master was already correct.

Only the “add items to playlist” and “remove items from playlist” Spotify API endpoints are used; the playlist is never fully replaced.
