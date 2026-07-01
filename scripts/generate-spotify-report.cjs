const fs = require("fs");
const path = require("path");

const root = process.cwd();
const dataDir = path.join(root, "spotify-audit-data");
const outFile = path.join(root, "spotify-library-report.html");

const docs = fs
  .readdirSync(dataDir)
  .filter((file) => file.endsWith(".json"))
  .sort()
  .map((file) => JSON.parse(fs.readFileSync(path.join(dataDir, file), "utf8")));

const playlists = docs.filter((doc) => doc.name !== "Liked Songs");
const liked = docs.find((doc) => doc.name === "Liked Songs");

const entries = [];
for (const source of docs) {
  for (const track of source.tracks) {
    entries.push({ ...track, source: source.name });
  }
}

const uniqueMap = new Map();
for (const track of entries) {
  const key = normalize(`${track.title}|||${track.artist}`);
  if (!uniqueMap.has(key)) {
    uniqueMap.set(key, {
      title: track.title,
      artist: track.artist,
      album: track.album,
      sources: new Set(),
      count: 0,
    });
  }
  const item = uniqueMap.get(key);
  item.sources.add(track.source);
  item.count += 1;
}

const uniqueTracks = [...uniqueMap.values()].map((track) => ({
  ...track,
  sources: [...track.sources],
}));

const patterns = [
  {
    id: "hard-tekno",
    title: "Hard tekno, tribe, freeparty pressure",
    why: "This is not just electronic. It is fast, physical, repetitive, distorted, and built around warehouse/freeparty energy.",
    seed: ["Tekk", "Jawoll junge"],
    rules: ["vortek", "tekno", "gehlektek", "neurotribe", "shmirlap", "teksa", "93sovage", "acidpach", "billx", "zone-33", "protokseed", "mandragora"],
  },
  {
    id: "idm-braindance",
    title: "IDM, braindance, clean-machine weirdness",
    why: "Precise, synthetic, sometimes pretty, sometimes alien. This is where Aleksi Perala / Aphex / Boards of Canada sit.",
    seed: ["GoDayumn", "Lowercase", "ABT"],
    rules: ["aphex twin", "boards of canada", "aleksi perälä", "aleksi perala", "autechre", "squarepusher", "floating points", "oneohtrix", "four tet", "burial", "dorian concept", "kidnap"],
  },
  {
    id: "ambient-liminal",
    title: "Ambient, liminal, sleepwalking electronic",
    why: "Less dancefloor, more drifting. Good for walking, late night, reading, dissociation, or background focus.",
    seed: ["Chillout", "Na ja..", "GoDayumn"],
    rules: ["flawed mangoes", "øneheart", "oneheart", "c418", "ambient", "harold budd", "tim hecker", "william basinski", "brian eno", "lowercase", "liminal"],
  },
  {
    id: "jazz-house",
    title: "Jazz-house, soft groove, warm rooms",
    why: "Berlioz, jazz-house, afro-house, loungey percussion. More tasteful and social than pure chill.",
    seed: ["!BERLIOZ!", "jazzombinator", "Afro house dump", "Holy house", "Abend chillen"],
    rules: ["berlioz", "jazz", "afro house", "rüfüs du sol", "rufus du sol", "hugel", "moodymann", "st germain", "bonobo", "kaytranada"],
  },
  {
    id: "frank-montell",
    title: "Frank / Montell / wounded R&B",
    why: "Sparse, romantic, emotionally underwater. This deserves its own bucket because it repeats across many playlists.",
    seed: ["frank and chill", "Frank Montell", "Montell", "Frank Ocean - Endless", "Frank Ocean - nostalgia, ULTRA"],
    rules: ["frank ocean", "montell fish", "seigfried", "white ferrari", "self control", "ivy", "godspeed", "novacane", "nights", "moon river"],
  },
  {
    id: "sad-art-rock",
    title: "Sad art-rock and beautiful collapse",
    why: "Radiohead, Smiths, Jeff Buckley, Cocteau Twins, Slowdive. Melodic but heavy emotionally.",
    seed: ["radioh", "%^*+", "Bbbnnnllö", "YO", "fuck..", "Na ja.."],
    rules: ["radiohead", "the smiths", "jeff buckley", "cocteau twins", "slowdive", "the cure", "pixies", "true love waits", "nude", "no surprises", "let down"],
  },
  {
    id: "midwest-slacker",
    title: "Midwest, slacker, bedroom guitar sadness",
    why: "Pinegrove / Duster / Alex G / Car Seat Headrest type sadness. More dusty and young than Radiohead.",
    seed: ["Midwest", "Calm Midwest", "Г", "fuck..", "…"],
    rules: ["pinegrove", "duster", "alex g", "car seat headrest", "current joys", "salvia palth", "teen suicide", "panchiko", "black country", "neutral milk hotel", "mac demarco"],
  },
  {
    id: "classic-riff",
    title: "Classic riff rock and guitar mythology",
    why: "AC/DC, Zeppelin, Floyd, Sabbath, Hendrix, Dylan. Less sad, more guitar identity.",
    seed: ["Rockin n rollin", "AC FUCKING DC", "Mmmmmm"],
    rules: ["ac/dc", "led zeppelin", "pink floyd", "black sabbath", "jimi hendrix", "bob dylan", "the doors", "rolling stones", "fleetwood mac", "oasis"],
  },
  {
    id: "rap-canon",
    title: "Rap canon and main-character hip-hop",
    why: "Kanye, Drake, Kendrick, Tyler, Travis, A$AP. Big songs, strong identity, often replayable.",
    seed: ["Kanye ye", "K¥_00", "Fashion killa", "m's top tracks", "Tunes"],
    rules: ["kanye west", "ye", "drake", "kendrick lamar", "tyler", "the creator", "a$ap rocky", "travis scott", "kid cudi", "metro boomin", "jay-z", "jaÿ-z", "mf doom"],
  },
  {
    id: "rage-gym",
    title: "Rage, opium, gym, turn-up",
    why: "Carti/Ken/2hollis/Opium/trap energy. More aggressive and synthetic than rap canon.",
    seed: ["Gym", "Turn it up", "Opium", "less goo"],
    rules: ["playboi carti", "ken carson", "destroy lonely", "2hollis", "osamason", "fakemink", "homixide", "opium", "yeat", "lil uzi vert", "future", "juice wrld"],
  },
  {
    id: "shower-warm",
    title: "Shower songs, warm singing, obvious replay",
    why: "The stuff you can actually sing, clean, or move around to. Not too niche, not too dark.",
    seed: ["No enemies", "Tunes", "12", "CL", "springspringspring"],
    rules: ["steve miller band", "the beatles", "fleetwood mac", "oasis", "the strokes", "peter bjorn", "earth", "wind & fire", "david bowie", "everywhere", "dreams", "starman", "young folks"],
  },
  {
    id: "post-soviet-melancholy",
    title: "Post-Soviet / Ukrainian / Russian melancholy rock",
    why: "A real separate thread from Qs: Cyrillic artists, cold guitar, breakup/post-punk energy.",
    seed: ["Qs"],
    rules: ["ssshhhiiittt", "какая разница", "скрябін", "конец солнечных дней", "автоспорт", "где фантом", "кино", "молчат дома", "face"],
  },
  {
    id: "personal-archive",
    title: "Personal archive, gifts, places, time capsules",
    why: "These may be emotionally important but not necessarily daily listening buckets. Keep or archive before deleting anything.",
    seed: ["for talia", "for talia ordered by decreasing valence", "марян × talia", "day in roma", "Here, There, and Everywhere... With You"],
    rules: [],
    forceSources: ["for talia", "for talia ordered by decreasing valence", "марян × talia", "day in roma", "Here, There, and Everywhere... With You"],
  },
];

const enriched = patterns.map((pattern) => {
  const matches = uniqueTracks
    .filter((track) => matchesPattern(track, pattern))
    .sort((a, b) => priority(pattern, b) - priority(pattern, a) || b.count - a.count || a.title.localeCompare(b.title));

  const sourceCounts = new Map();
  const artistCounts = new Map();
  for (const track of matches) {
    for (const source of track.sources) sourceCounts.set(source, (sourceCounts.get(source) || 0) + 1);
    for (const artist of splitArtists(track.artist)) artistCounts.set(artist, (artistCounts.get(artist) || 0) + 1);
  }

  return {
    ...pattern,
    matches,
    topSources: [...sourceCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8),
    topArtists: [...artistCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10),
  };
});

const duplicateTracks = uniqueTracks
  .filter((track) => track.count >= 5)
  .sort((a, b) => b.count - a.count)
  .slice(0, 36);

const playlistRows = playlists
  .map((playlist) => {
    const best = enriched
      .map((pattern) => ({
        title: pattern.title,
        count: playlist.tracks.filter((track) => matchesPattern({ ...track, sources: [playlist.name], count: 1 }, pattern)).length,
      }))
      .filter((item) => item.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);
    return { name: playlist.name, count: playlist.extracted_count, best };
  })
  .sort((a, b) => b.count - a.count);

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Spotify Library Pattern Audit</title>
  <style>
    :root {
      --bg: #101112;
      --panel: #181a1d;
      --panel-2: #202328;
      --text: #f4f1ea;
      --muted: #aaa7a0;
      --line: #343840;
      --accent: #8ecae6;
      --accent-2: #e9c46a;
      --bad: #e76f51;
      --good: #98c379;
      --radius: 8px;
      color-scheme: dark;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font: 15px/1.45 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    header {
      position: sticky;
      top: 0;
      z-index: 5;
      background: rgba(16,17,18,.92);
      border-bottom: 1px solid var(--line);
      backdrop-filter: blur(16px);
    }
    .top {
      max-width: 1440px;
      margin: 0 auto;
      padding: 18px 24px;
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 20px;
      align-items: end;
    }
    h1 {
      margin: 0;
      font-size: 26px;
      line-height: 1.1;
      letter-spacing: 0;
    }
    .sub { color: var(--muted); margin-top: 6px; }
    .stats {
      display: grid;
      grid-auto-flow: column;
      gap: 8px;
    }
    .stat {
      min-width: 120px;
      padding: 10px 12px;
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background: var(--panel);
    }
    .stat strong { display: block; font-size: 18px; }
    .stat span { color: var(--muted); font-size: 12px; }
    main {
      max-width: 1440px;
      margin: 0 auto;
      padding: 24px;
      display: grid;
      grid-template-columns: 280px minmax(0, 1fr);
      gap: 20px;
    }
    nav {
      position: sticky;
      top: 98px;
      align-self: start;
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background: var(--panel);
      overflow: hidden;
    }
    nav a {
      display: block;
      padding: 10px 12px;
      color: var(--muted);
      text-decoration: none;
      border-bottom: 1px solid rgba(255,255,255,.04);
      font-size: 13px;
    }
    nav a:hover { color: var(--text); background: var(--panel-2); }
    section { margin-bottom: 20px; }
    .grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 14px;
    }
    .card {
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background: var(--panel);
      padding: 16px;
      min-width: 0;
    }
    .card h2, .card h3 {
      margin: 0 0 8px;
      letter-spacing: 0;
    }
    .card h2 { font-size: 20px; }
    .card h3 { font-size: 17px; }
    .muted { color: var(--muted); }
    .pillrow { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0; }
    .pill {
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 3px 8px;
      font-size: 12px;
      color: var(--muted);
      background: #141518;
    }
    .pill strong { color: var(--text); }
    .pattern {
      display: grid;
      grid-template-columns: minmax(0, 1.1fr) minmax(260px, .9fr);
      gap: 14px;
      margin-bottom: 14px;
    }
    .tracklist {
      display: grid;
      gap: 6px;
      margin-top: 12px;
    }
    .track {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 12px;
      align-items: baseline;
      padding: 8px 0;
      border-top: 1px solid rgba(255,255,255,.06);
    }
    .track b { font-weight: 620; }
    .track small { color: var(--muted); }
    .count {
      color: var(--accent-2);
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      overflow: hidden;
      display: table;
    }
    th, td {
      padding: 9px 10px;
      border-bottom: 1px solid rgba(255,255,255,.06);
      text-align: left;
      vertical-align: top;
    }
    th {
      color: var(--muted);
      font-size: 12px;
      font-weight: 600;
      background: var(--panel-2);
    }
    td:nth-child(2), th:nth-child(2) { text-align: right; font-variant-numeric: tabular-nums; }
    .notice {
      border-left: 3px solid var(--accent);
      padding: 12px 14px;
      background: #15191d;
      border-radius: 0 var(--radius) var(--radius) 0;
      margin-bottom: 18px;
    }
    .search {
      width: 100%;
      padding: 11px 12px;
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background: var(--panel);
      color: var(--text);
      margin-bottom: 14px;
    }
    @media (max-width: 980px) {
      .top, main, .pattern { grid-template-columns: 1fr; }
      nav { position: static; }
      .grid { grid-template-columns: 1fr; }
      .stats { grid-auto-flow: row; grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
  </style>
</head>
<body>
  <header>
    <div class="top">
      <div>
        <h1>Spotify Library Pattern Audit</h1>
        <div class="sub">A readable map of the real subpatterns in your playlists and Liked Songs. No emoji bucket names, no deletion proposals.</div>
      </div>
      <div class="stats">
        <div class="stat"><strong>${playlists.length}</strong><span>owned playlists</span></div>
        <div class="stat"><strong>${formatNumber(playlists.reduce((sum, playlist) => sum + playlist.extracted_count, 0))}</strong><span>playlist entries</span></div>
        <div class="stat"><strong>${formatNumber(liked.extracted_count)}</strong><span>liked songs</span></div>
      </div>
    </div>
  </header>
  <main>
    <nav>
      <a href="#read">How to read this</a>
      ${enriched.map((pattern) => `<a href="#${pattern.id}">${escapeHtml(pattern.title)}</a>`).join("")}
      <a href="#duplicates">Repeated songs</a>
      <a href="#playlists">Playlist map</a>
    </nav>
    <div>
      <section id="read" class="notice">
        <b>What changed from the earlier proposal:</b> these are specific listening patterns, not generic vibe buckets. A song can belong to more than one pattern. The point is to design fewer daily playlists without losing the weird niche stuff.
      </section>

      <section class="grid">
        <div class="card">
          <h2>Most important correction</h2>
          <p class="muted">The electronic side is not one bucket. It splits into hard tekno, IDM/braindance, ambient-liminal, and jazz-house. Your screenshot track, <b>FI3AC2265060</b> by Aleksi Perala, belongs with the IDM/braindance pattern.</p>
        </div>
        <div class="card">
          <h2>Likely playlist strategy</h2>
          <p class="muted">Keep personal/archive playlists separate. Build daily playlists from specific functional patterns: hard tekno, gym/rage, sad art-rock, Frank/Montell R&B, shower/warm songs, and chill/ambient.</p>
        </div>
      </section>

      ${enriched.map(renderPattern).join("")}

      <section id="duplicates" class="card">
        <h2>Repeated songs that probably define your taste</h2>
        <p class="muted">These appear across many owned playlists, so they are stronger taste signals than one-off saves.</p>
        <div class="tracklist">
          ${duplicateTracks.map((track) => renderTrack(track, true)).join("")}
        </div>
      </section>

      <section id="playlists" class="card">
        <h2>Owned playlist map</h2>
        <input class="search" id="playlistSearch" placeholder="Filter playlists..." />
        <table id="playlistTable">
          <thead><tr><th>Playlist</th><th>Tracks</th><th>Best matching patterns</th></tr></thead>
          <tbody>
            ${playlistRows.map((row) => `
              <tr>
                <td>${escapeHtml(row.name)}</td>
                <td>${row.count}</td>
                <td>${row.best.length ? row.best.map((item) => `${escapeHtml(item.title)} <span class="muted">(${item.count})</span>`).join("<br>") : '<span class="muted">archive / unclear from rules</span>'}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </section>
    </div>
  </main>
  <script>
    const input = document.getElementById("playlistSearch");
    const rows = [...document.querySelectorAll("#playlistTable tbody tr")];
    input.addEventListener("input", () => {
      const q = input.value.toLowerCase();
      for (const row of rows) row.style.display = row.innerText.toLowerCase().includes(q) ? "" : "none";
    });
  </script>
</body>
</html>`;

fs.writeFileSync(outFile, html);
console.log(outFile);

function renderPattern(pattern) {
  const examples = pattern.matches.slice(0, 10);
  return `<section id="${pattern.id}" class="pattern">
    <div class="card">
      <h2>${escapeHtml(pattern.title)}</h2>
      <p class="muted">${escapeHtml(pattern.why)}</p>
      <div class="pillrow">
        <span class="pill"><strong>${pattern.matches.length}</strong> matched unique tracks</span>
        ${pattern.seed.map((source) => `<span class="pill">${escapeHtml(source)}</span>`).join("")}
      </div>
      <div class="tracklist">
        ${examples.map((track) => renderTrack(track, false)).join("") || '<div class="muted">No direct rule matches yet.</div>'}
      </div>
    </div>
    <div class="card">
      <h3>Signals</h3>
      <p class="muted">Top artists</p>
      <div class="pillrow">${pattern.topArtists.map(([artist, count]) => `<span class="pill">${escapeHtml(artist)} <strong>${count}</strong></span>`).join("")}</div>
      <p class="muted">Source playlists</p>
      <div class="pillrow">${pattern.topSources.map(([source, count]) => `<span class="pill">${escapeHtml(source)} <strong>${count}</strong></span>`).join("")}</div>
    </div>
  </section>`;
}

function renderTrack(track, includeSources) {
  const sources = includeSources ? `<small>${track.sources.slice(0, 5).map(escapeHtml).join(", ")}${track.sources.length > 5 ? ` +${track.sources.length - 5}` : ""}</small>` : `<small>${track.album ? escapeHtml(track.album) : ""}</small>`;
  return `<div class="track">
    <div><b>${escapeHtml(track.title)}</b><br><span class="muted">${escapeHtml(track.artist)}</span><br>${sources}</div>
    <div class="count">${track.count}x</div>
  </div>`;
}

function matchesPattern(track, pattern) {
  if (pattern.forceSources && track.sources.some((source) => pattern.forceSources.includes(source))) return true;
  const haystack = normalize(`${track.title} ${track.artist} ${track.album}`);
  return pattern.rules.some((rule) => haystack.includes(normalize(rule)));
}

function priority(pattern, track) {
  const haystack = normalize(`${track.title} ${track.artist} ${track.album}`);
  if (pattern.id === "idm-braindance" && (haystack.includes("aleksi perala") || haystack.includes("fi3ac2265060"))) return 10;
  if (pattern.id === "hard-tekno" && haystack.includes("vortek")) return 6;
  if (pattern.id === "frank-montell" && haystack.includes("frank ocean")) return 5;
  if (pattern.id === "sad-art-rock" && haystack.includes("radiohead")) return 5;
  return 0;
}

function splitArtists(value) {
  return String(value)
    .split(/,\s*/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalize(value) {
  return String(value).toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(value);
}
