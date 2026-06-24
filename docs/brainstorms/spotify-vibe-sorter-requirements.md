---
date: 2026-06-24
topic: spotify-vibe-sorter
---

# Spotify Vibe Sorter + Music Personality

## Summary

A local-first tool that pulls your entire scattered Spotify library, sorts every track into your own custom vibe buckets (artist genre tags for the obvious stuff, an LLM for fuzzy vibes like "shower songs"), creates real playlists for them, and generates a shareable "music personality" card — backing up everything before it ever edits or deletes. Built to double as a recruiter / Twitter-X portfolio piece.

---

## Problem Frame

The owner has an unmanageably large number of Spotify playlists but only plays a few. Songs they love are scattered across many playlists, so the good stuff is invisible most of the time — they forget a song exists because it lives in a playlist they never open, and they have no single place that collects "the songs I actually like." The cost is daily: missed listens, mental overhead of remembering where things are, and a library that grows more chaotic over time rather than more useful.

A second, equally real driver: the owner wants the result to be **impressive** — a project that lands with recruiters and is shareable on Twitter/X. So the work is judged on two axes at once: does it fix the personal library problem, and does it read as a strong portfolio artifact.

This collides with a hard external constraint discovered during research: Spotify **deprecated its audio-analysis API for new apps** (Nov 2024, tightened Feb 2026). The "analyze my music's energy/valence/danceability" data that older tools relied on is unavailable to any app registered today — so the analysis approach has to be rebuilt from the signals that still exist.

---

## Actors

- A1. **Owner (you)** — runs the tool, defines the vibe buckets, tags a few examples for fuzzy buckets, approves/triggers edits and deletes, shares the personality card.
- A2. **Spotify Web API** — source of the library (playlists, liked songs, track + artist metadata, genre tags) and the target for playlist create/edit/delete.
- A3. **LLM API** — classifies tracks into the owner's custom buckets, especially subjective vibes that no structured signal can define. Owner brings their own key.
- A4. **ReccoBeats API (optional)** — supplies energy/BPM-style features to sub-split within a bucket; only used if it proves reliable.

---

## Key Flows

- F1. **Sort my library into vibe playlists**
  - **Trigger:** Owner runs the sort command after defining their buckets.
  - **Actors:** A1, A2, A3, (A4 optional)
  - **Steps:** Pull full library → take a backup snapshot → first-pass classify by artist genre tags → LLM classifies the rest into the owner's buckets → (optional) ReccoBeats sub-splits within a bucket → create one new playlist per bucket.
  - **Outcome:** New vibe playlists exist in the owner's Spotify; nothing existing was modified; a restorable backup exists.
  - **Covered by:** R1, R2, R5, R6, R7, R8, R10

- F2. **Generate + share my music personality card**
  - **Trigger:** Owner runs the profile command (standalone or after a sort).
  - **Actors:** A1, A2, A3
  - **Steps:** Aggregate the classified library → derive an archetype + breakdown → render a visual card on a local web page → owner exports/screenshots and posts it.
  - **Outcome:** A shareable image capturing the owner's "music personality."
  - **Covered by:** R13, R14

- F3. **Backup / restore safety net**
  - **Trigger:** Any operation that creates, edits, or deletes; or an explicit restore request.
  - **Actors:** A1, A2
  - **Steps:** Export every playlist's full contents to a local file before mutating → on restore, rebuild playlist contents from that file.
  - **Outcome:** No song is ever unrecoverable.
  - **Covered by:** R2, R3

- F4. **Edit / delete a playlist safely**
  - **Trigger:** Owner explicitly triggers a rename, reorder, track-removal, or playlist delete.
  - **Actors:** A1, A2
  - **Steps:** Confirm a current backup exists → perform the requested edit/delete → report what changed.
  - **Outcome:** The requested change is applied; track contents are recoverable from backup. (A deleted/unfollowed playlist is restorable only as a *new* playlist with the original tracks — its original identity, ID, and followers are not.)
  - **Covered by:** R2, R11, R12

---

## Requirements

**Library ingestion & backup**
- R1. Read the owner's entire library: all owned playlists, liked/saved songs, and track + artist metadata (including artist genre tags and popularity).
- R2. Before any create, edit, or delete, export a full snapshot of every playlist's contents to a local file.
- R3. Provide a restore path that rebuilds playlist contents from a backup snapshot.

**Classification engine**
- R4. The owner defines their own bucket list (e.g. techno, rock, sad songs, shower songs); buckets are not a fixed built-in taxonomy.
- R5. First pass: classify tracks by artist genre tags where the mapping is confident.
- R6. Second pass: an LLM classifies the remaining or ambiguous tracks into the owner's buckets, using track name, artist, genres, and popularity as context.
- R7. Fuzzy-vibe handling: for subjective buckets, the tool learns from a small number of owner-tagged example songs and/or asks the owner, rather than guessing blindly.
- R8. Optional sub-splitting: when available, use ReccoBeats energy/BPM features to split within a bucket (e.g. "chill techno" vs "peak-time techno").

**Playlist operations**
- R10. Sorting only ever creates new playlists — it never modifies or overwrites the owner's existing playlists.
- R11. Support explicit, owner-triggered edits to playlists: rename, reorder, and remove tracks.
- R12. Support explicit, owner-triggered deletion (unfollow) of playlists, guarded by an existing backup.

**Music personality**
- R13. Generate a "music personality" profile: an archetype label plus a breakdown of the owner's genre/vibe mix and notable patterns.
- R14. Render the profile as a shareable visual card (exportable image) via a local web page.

**Portfolio quality (cross-cutting)**
- R15. The codebase, README, and a runnable demo are built to read as recruiter-grade: clean structure, clear documentation, easy to run, and a visible "wow" output.

---

## Acceptance Examples

- AE1. **Covers R5, R6.** Given a track whose artist has no useful genre tags, when sorting runs, then the LLM (not the genre pass) decides the track's bucket.
- AE2. **Covers R7.** Given a subjective bucket like "shower songs," when sorting runs, then the tool uses the owner's tagged examples and/or asks the owner rather than assigning silently from genre alone.
- AE3. **Covers R2, R12.** Given the owner triggers a playlist delete, when no current backup exists, then a backup is taken before the delete proceeds.
- AE4. **Covers R10.** Given sorting produces a "techno" bucket that overlaps an existing "Techno" playlist, when playlists are created, then a new playlist is made and the existing one is left untouched.

---

## Success Criteria

- **Human outcome:** The owner actually uses the result — plays the new vibe playlists, stops forgetting songs they like, and the library feels navigable instead of chaotic.
- **Shareability:** The personality card is good enough that the owner posts it, and it reads as a "try this" moment to viewers.
- **Portfolio signal:** A recruiter skimming the repo/demo comes away thinking "this person builds real, safe systems" (backup/restore, an LLM pipeline, careful handling of a deprecated API).
- **Handoff quality:** ce-plan can design implementation without re-deciding product behavior, scope, or which Spotify signals to build on.

---

## Scope Boundaries

### Deferred for later

- Hosted, multi-user web app where strangers connect their own Spotify (requires Spotify's extended-quota app review; revisit only if the project gains traction).
- ReccoBeats sub-splitting (R8) if it complicates v1 or coverage proves thin.
- A full preview-then-confirm UI before writes (sorting is already made safe by new-playlists-only + backup; an interactive preview is a later polish).

### Outside this product's identity

- A recommendation / discovery engine for *new* music. This tool organizes and resurfaces what the owner already has; Spotify also removed the recommendations API for new apps.
- A mobile app or always-on / real-time background syncing — this is a run-on-demand local tool.
- Editing other people's playlists (Spotify now returns other users' playlists as metadata-only).
- Any workaround to revive the deprecated audio-features endpoint (scraping, grandfathered-app tricks).

---

## Key Decisions

- **Genre tags + LLM instead of audio-features:** Spotify killed audio-features for new apps; the LLM path is the viable replacement and is *better* for the owner's subjective buckets ("shower songs") that audio-features could never have defined.
- **Local-first, single-user v1:** Sidesteps Spotify's 5-user dev-mode cap and app-review gate. The owner runs it themselves and shares the *output*; opening it to others is a later, traction-gated decision.
- **Backup before any mutation; sorting creates new playlists only:** This is what makes full edit/delete safe and is also a strong engineering signal for the portfolio goal.
- **Shape C (engine + shareable card):** Serves both audiences at once — the engine is the substance recruiters respect, the card is the artifact Twitter/X shares.
- **LLM is the core classifier, not a bolt-on:** Per the owner's explicit direction; it is what makes custom, fuzzy bucketing possible.
- **LLM provider = OpenAI GPT-5.5 for v1 (owner's pick):** Pipeline stays provider-swappable so the model can change later on cost/quality without a rewrite.

---

## Dependencies / Assumptions

- Owner has a **Spotify Premium** account (required to register a dev-mode app as of Feb 2026).
- Owner provides their own **OpenAI API key** (GPT-5.5 for v1); classification cost is expected to be low for a few thousand tracks, but confirm GPT-5.5 pricing during planning since it is pricier than the mini-tier models the research benchmarked.
- The artist `genres` field still returns usable data for new apps in 2026 (reported working but flagged deprecated in Spotify's docs) — verify during planning.
- Spotify rate limits: bulk multi-get endpoints were removed (Feb 2026), so per-track/per-artist fetches dominate; classifying a few thousand tracks runs in the order of minutes, not seconds.
- ReccoBeats input format and library coverage are unconfirmed — test before committing to R8.

---

## Outstanding Questions

### Resolve Before Planning

- None. (LLM provider resolved: OpenAI GPT-5.5. Spotify Premium + dev-app registration is a setup-readiness item, tracked under Dependencies — needed before the first run, not before planning.)

### Deferred to Planning

- [Affects R5][Needs research] Confirm the artist `genres` field still returns reliable data for a newly registered app in 2026.
- [Affects R8][Needs research] Validate ReccoBeats: how it's queried (Spotify ID vs name/artist lookup) and how much of a typical library it covers.
- [Affects R6][Technical] LLM prompt + genre-to-bucket mapping design, and batching strategy to stay within cost and rate limits.
- [Affects R14][Technical] How the shareable card image is generated and exported from the local web page.
- [Affects R7][Technical] Mechanism for tagging example songs per fuzzy bucket and how examples feed the LLM.
