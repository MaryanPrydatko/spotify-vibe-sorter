import { describe, expect, it } from "vitest";
import type { LibraryAggregate } from "../src/profile/aggregate.js";
import type { PersonalityProfile } from "../src/profile/analyze.js";
import { buildCardSvg } from "../src/web/card.js";

const aggregate: LibraryAggregate = {
  totalTracks: 100,
  sortedTracks: 90,
  bucketDistribution: [
    { bucket: "techno", count: 50, pct: 55.6 },
    { bucket: "sad songs", count: 40, pct: 44.4 },
  ],
  topGenres: [{ label: "techno", count: 50 }],
  topArtists: [{ label: "Boris Brejcha", count: 12 }],
  playlistBucketMatrix: [],
  avgPopularity: 48,
  eraDistribution: [{ label: "2020s", count: 60 }],
};

const profile: PersonalityProfile = {
  archetype: "Midnight Techno Romantic",
  summary: "Four-on-the-floor by night, heartbreak by 2am.",
  correlations: ["Your sad songs cluster in your gym playlists."],
};

describe("U8 card", () => {
  it("renders a valid SVG with the archetype, buckets, and song count", () => {
    const svg = buildCardSvg({ profile, aggregate });
    expect(svg.startsWith("<svg")).toBe(true);
    // The archetype wraps across lines on the card; check the pieces are present.
    expect(svg).toContain("Midnight Techno");
    expect(svg).toContain("Romantic");
    expect(svg).toContain("techno");
    expect(svg).toContain("90 songs sorted");
  });

  it("escapes XML-special characters in text", () => {
    const svg = buildCardSvg({
      profile: { ...profile, archetype: "Rock & Roll <Legend>" },
      aggregate,
    });
    expect(svg).toContain("Rock &amp; Roll &lt;Legend&gt;");
  });

  it("ends an over-long summary with an ellipsis instead of a mid-word cut", () => {
    const longSummary =
      "Your library looks like a four-room emotional apartment: crying in one, " +
      "singing in another, guitars in the third, and a strobe light in the fourth bedroom.";
    const svg = buildCardSvg({ profile: { ...profile, summary: longSummary }, aggregate });
    expect(svg).toContain("…");
    // The dropped tail ("bedroom.") must not appear verbatim.
    expect(svg).not.toContain("fourth bedroom");
  });
});
