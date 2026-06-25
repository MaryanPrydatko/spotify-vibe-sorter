/**
 * Headless runner — does exactly what the web buttons do, but straight from the terminal:
 *   npm run vibe        # sort + profile
 *   npm run sort        # create the vibe playlists
 *   npm run profile     # reveal the music personality
 *
 * Runs entirely on this machine (your tokens, your Spotify/OpenAI calls). It cannot bypass
 * Spotify's account-level rate-limit — that lives on Spotify's servers, not here — so if
 * playlists are cooled down it degrades to Liked Songs (profile) or reports the limit (sort).
 */
import { loadEnvFile } from "./config/paths.js";
import { buildEngine } from "./engine/factory.js";
import { isRateLimited } from "./spotify/client.js";

loadEnvFile();

type Command = "sort" | "profile" | "both";

function parseCommand(arg: string | undefined): Command {
  if (arg === "sort" || arg === "profile" || arg === "both") return arg;
  if (arg === undefined) return "both";
  console.error(`Unknown command "${arg}". Use: sort | profile | both`);
  process.exit(2);
}

async function main(): Promise<void> {
  const cmd = parseCommand(process.argv[2]);
  const engine = buildEngine();

  if (!(await engine.status())) {
    console.error("Not connected to Spotify. Run `npm run dev`, open the app, and Sign in first.");
    process.exit(1);
  }

  if (cmd === "sort" || cmd === "both") {
    console.log("\n▶ Sorting your library into vibe playlists…\n");
    const res = await engine.sort();
    console.log(
      `\n✓ Created ${res.created.length} playlist(s): ${res.created.map((c) => c.bucket).join(", ") || "(none)"}`,
    );
    if (res.removedPrior) console.log(`  (replaced ${res.removedPrior} previous vibe-sorter playlist[s])`);
  }

  if (cmd === "profile" || cmd === "both") {
    console.log("\n▶ Revealing your music personality…\n");
    const { profile, aggregate, complete } = await engine.profile();
    console.log(`\n  ★ ${profile.archetype}`);
    console.log(`  ${profile.summary}\n`);
    console.log("  Top vibes:");
    for (const b of aggregate.bucketDistribution.slice(0, 5)) {
      const bar = "█".repeat(Math.round(b.pct / 4));
      console.log(`   ${b.bucket.padEnd(14)} ${bar} ${b.pct}%`);
    }
    if (profile.correlations.length) {
      console.log("\n  Patterns:");
      for (const c of profile.correlations) console.log(`   • ${c}`);
    }
    console.log(`\n  (${aggregate.sortedTracks} tracks sorted${complete ? "" : " — partial run"})`);
  }
}

main().catch((err) => {
  if (isRateLimited(err)) {
    console.error(
      "\n⚠ Spotify has temporarily rate-limited playlist access (server-side, on your account). " +
        "It resets automatically — try again later.",
    );
  } else {
    console.error(`\n✗ ${err instanceof Error ? err.message : String(err)}`);
  }
  process.exit(1);
});
