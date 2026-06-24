# Spotify Vibe Sorter

Sort your scattered Spotify library into custom **vibe playlists** (techno, rock, sad songs, shower songs…) and get a shareable **music-personality card** — all running locally on your machine.

It reads your whole library, lets **GPT-5.5** classify every track into buckets *you* define, creates real playlists in your account, and analyzes the whole picture to surface cross-playlist correlations and a music "archetype." A full backup is taken before anything is ever edited or deleted.

> **Why local?** Your playlists live on Spotify's servers; this tool talks to them over the Spotify Web API using a token you grant through Spotify's own login. Nothing runs in the cloud, and your login is never seen by anyone but Spotify.

## Status

Greenfield build, in progress. See [`docs/plans/`](docs/plans) for the implementation plan and [`docs/brainstorms/`](docs/brainstorms) for the requirements.

## How it works

```
Connect (OAuth) → read library → backup → classify (GPT-5.5) → create vibe playlists
                                        ↘ aggregate → analyze → personality card (PNG)
```

A single minimalist local web page is the entire interface.

## Setup

Requires **Node ≥ 20**, a **Spotify Premium** account, and an **OpenAI API key**.

1. **Create a Spotify app** at the [developer dashboard](https://developer.spotify.com/dashboard) (Premium required to register a dev app).
   - Add this redirect URI **exactly** (Spotify rejects plain `localhost` for non-HTTPS redirects — use the loopback IP):
     ```
     http://127.0.0.1:4477/callback
     ```
2. **Configure env:**
   ```bash
   cp .env.example .env
   # then fill in SPOTIFY_CLIENT_ID and OPENAI_API_KEY
   ```
3. **Install & run:**
   ```bash
   npm install
   npm run dev
   ```
   Open <http://127.0.0.1:4477> and click **Connect**.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Run the local web app with reload |
| `npm start` | Run the local web app |
| `npm test` | Run the test suite (Vitest) |
| `npm run typecheck` | Type-check without emitting |

## Data & Privacy

Everything stays on your machine. State (tokens, backups, caches, bucket config) lives in a gitignored `.data/` directory; the Spotify token file is written with `0600` permissions.

What is sent to OpenAI for classification: each track's **name, artist, genre tags, and popularity**, plus a compact library aggregate — **not** full PII. If you prefer, enable OpenAI's zero-data-retention option in your OpenAI org settings.

## Safety

- Sorting only ever **creates new** playlists — it never modifies your existing ones.
- A full **backup** is taken before any edit or delete.
- Restore recovers your **track contents**; note that a deleted/unfollowed playlist comes back as a *new* playlist (Spotify gives it a new ID) — the tool never promises to undo a delete perfectly.

## License

MIT
