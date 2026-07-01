const fs = require("fs");
const path = require("path");

const root = process.cwd();
const dataDir = path.join(root, "spotify-audit-data");
const outDir = path.join(root, "spotify-build-manifest");
fs.mkdirSync(outDir, { recursive: true });

const docs = fs
  .readdirSync(dataDir)
  .filter((file) => file.endsWith(".json"))
  .sort()
  .map((file) => JSON.parse(fs.readFileSync(path.join(dataDir, file), "utf8")));

const entries = [];
for (const source of docs) {
  for (const track of source.tracks) entries.push({ ...track, source: source.name });
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

const playlists = [
  {
    file: "01-hard-tekno-tribe-freeparty",
    spotifyName: "Hard tekno / tribe / freeparty (pattern)",
    rules: ["vortek", "tekno", "gehlektek", "neurotribe", "shmirlap", "teksa", "93sovage", "acidpach", "billx", "zone-33", "protokseed", "mandragora", "jacidorex", "sara landry"],
  },
  {
    file: "02-idm-braindance-clean-machine",
    spotifyName: "IDM / braindance / clean-machine (pattern)",
    rules: ["aphex twin", "boards of canada", "aleksi perälä", "aleksi perala", "autechre", "squarepusher", "floating points", "oneohtrix", "four tet", "burial", "dorian concept", "kidnap", "vegyn", "terekke", "susumu yokota"],
  },
  {
    file: "03-ambient-liminal-sleepwalking",
    spotifyName: "Ambient / liminal / sleepwalking (pattern)",
    rules: ["flawed mangoes", "øneheart", "oneheart", "c418", "ambient", "harold budd", "tim hecker", "william basinski", "brian eno", "liminal", "tomcbumpz"],
  },
  {
    file: "04-jazz-house-soft-groove",
    spotifyName: "Jazz-house / soft groove (pattern)",
    rules: ["berlioz", "afro house", "rüfüs du sol", "rufus du sol", "hugel", "moodymann", "st germain", "bonobo", "kaytranada", "fred again", "keinemusik", "moojo", "ahmed spins", "zakes bantwini"],
  },
  {
    file: "05-frank-montell-wounded-rnb",
    spotifyName: "Frank / Montell / wounded R&B (pattern)",
    rules: ["frank ocean", "montell fish", "seigfried", "white ferrari", "self control", "ivy", "godspeed", "novacane", "nights", "moon river"],
  },
  {
    file: "06-sad-art-rock-beautiful-collapse",
    spotifyName: "Sad art-rock / beautiful collapse (pattern)",
    rules: ["radiohead", "the smiths", "jeff buckley", "cocteau twins", "slowdive", "the cure", "pixies", "true love waits", "nude", "no surprises", "let down"],
  },
  {
    file: "07-midwest-slacker-bedroom-guitar",
    spotifyName: "Midwest / slacker / bedroom guitar (pattern)",
    rules: ["pinegrove", "duster", "alex g", "car seat headrest", "current joys", "salvia palth", "teen suicide", "panchiko", "black country", "neutral milk hotel", "mac demarco"],
  },
  {
    file: "08-classic-riff-rock-guitar",
    spotifyName: "Classic riff rock / guitar mythology (pattern)",
    rules: ["ac/dc", "led zeppelin", "pink floyd", "black sabbath", "jimi hendrix", "bob dylan", "the doors", "rolling stones", "fleetwood mac", "oasis"],
  },
  {
    file: "09-rap-canon-main-character",
    spotifyName: "Rap canon / main-character hip-hop (pattern)",
    rules: ["kanye west", "ye", "drake", "kendrick lamar", "tyler", "the creator", "a$ap rocky", "travis scott", "kid cudi", "metro boomin", "jay-z", "jaÿ-z", "mf doom"],
  },
  {
    file: "10-rage-opium-gym-turn-up",
    spotifyName: "Rage / opium / gym / turn-up (pattern)",
    rules: ["playboi carti", "ken carson", "destroy lonely", "2hollis", "osamason", "fakemink", "homixide", "opium", "yeat", "lil uzi vert", "future", "juice wrld"],
  },
  {
    file: "11-shower-warm-obvious-replay",
    spotifyName: "Shower / warm / obvious replay (pattern)",
    rules: ["steve miller band", "the beatles", "fleetwood mac", "oasis", "the strokes", "peter bjorn", "earth", "wind & fire", "david bowie", "everywhere", "dreams", "starman", "young folks"],
  },
  {
    file: "12-post-soviet-melancholy-rock",
    spotifyName: "Post-Soviet melancholy rock (pattern)",
    rules: ["ssshhhiiittt", "какая разница", "скрябін", "конец солнечных дней", "автоспорт", "где фантом", "кино", "молчат дома", "face"],
  },
];

const summary = [];
for (const playlist of playlists) {
  const tracks = uniqueTracks
    .filter((track) => playlist.rules.some((rule) => normalize(`${track.title} ${track.artist} ${track.album}`).includes(normalize(rule))))
    .sort((a, b) => b.count - a.count || a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title));

  const payload = { spotifyName: playlist.spotifyName, rules: playlist.rules, count: tracks.length, tracks };
  fs.writeFileSync(path.join(outDir, `${playlist.file}.json`), JSON.stringify(payload, null, 2));
  fs.writeFileSync(path.join(outDir, `${playlist.file}.csv`), toCsv(tracks));
  summary.push({ spotifyName: playlist.spotifyName, file: playlist.file, count: tracks.length, examples: tracks.slice(0, 8).map((t) => `${t.title} — ${t.artist}`) });
}

fs.writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));

function toCsv(tracks) {
  const rows = [["title", "artist", "album", "source_count", "sources"]];
  for (const track of tracks) rows.push([track.title, track.artist, track.album, track.count, track.sources.join("; ")]);
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

function csvCell(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function normalize(value) {
  return String(value).toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
}
