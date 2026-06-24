import type { LibraryAggregate } from "../profile/aggregate.js";
import type { PersonalityProfile } from "../profile/analyze.js";

export interface CardData {
  profile: PersonalityProfile;
  aggregate: LibraryAggregate;
}

const SIZE = 1080;

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function wrap(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if ((line + " " + w).trim().length > maxChars) {
      if (line) lines.push(line.trim());
      line = w;
      if (lines.length === maxLines - 1) break;
    } else {
      line = (line + " " + w).trim();
    }
  }
  if (line && lines.length < maxLines) lines.push(line.trim());
  return lines;
}

/**
 * Build the shareable personality card as a self-contained SVG. Pure (no DOM) so it can be
 * unit-tested; `exportCardPng` rasterizes it in the browser.
 */
export function buildCardSvg(data: CardData): string {
  const { profile, aggregate } = data;
  const buckets = aggregate.bucketDistribution.slice(0, 5);
  const maxPct = Math.max(1, ...buckets.map((b) => b.pct));

  const archetypeLines = wrap(profile.archetype, 22, 2);
  const summaryLines = wrap(profile.summary, 52, 3);
  const correlation = profile.correlations[0] ?? "";
  const correlationLines = wrap(correlation, 56, 2);

  const bars = buckets
    .map((b, i) => {
      const y = 560 + i * 74;
      const w = Math.round((b.pct / maxPct) * 620);
      return `
        <text x="90" y="${y - 10}" fill="#e8e9ed" font-size="30" font-family="sans-serif">${escapeXml(b.bucket)}</text>
        <text x="990" y="${y - 10}" fill="#9aa0aa" font-size="28" font-family="sans-serif" text-anchor="end">${b.pct}%</text>
        <rect x="90" y="${y}" width="900" height="18" rx="9" fill="#23262f"/>
        <rect x="90" y="${y}" width="${w}" height="18" rx="9" fill="#1db954"/>`;
    })
    .join("");

  const archetypeSvg = archetypeLines
    .map((l, i) => `<text x="90" y="${190 + i * 78}" fill="#1db954" font-size="72" font-weight="700" font-family="sans-serif">${escapeXml(l)}</text>`)
    .join("");
  const summarySvg = summaryLines
    .map((l, i) => `<text x="90" y="${380 + i * 44}" fill="#cfd3da" font-size="32" font-family="sans-serif">${escapeXml(l)}</text>`)
    .join("");
  const correlationSvg = correlationLines
    .map((l, i) => `<text x="90" y="${972 + i * 38}" fill="#9aa0aa" font-size="28" font-style="italic" font-family="sans-serif">${escapeXml(l)}</text>`)
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <rect width="${SIZE}" height="${SIZE}" fill="#0f1014"/>
  <text x="90" y="100" fill="#9aa0aa" font-size="30" letter-spacing="3" font-family="sans-serif">MY MUSIC PERSONALITY</text>
  ${archetypeSvg}
  ${summarySvg}
  <text x="90" y="525" fill="#9aa0aa" font-size="26" letter-spacing="2" font-family="sans-serif">TOP VIBES</text>
  ${bars}
  ${correlationSvg}
  <text x="90" y="1045" fill="#3f4350" font-size="24" font-family="sans-serif">spotify vibe sorter · ${aggregate.sortedTracks} songs sorted</text>
</svg>`;
}

/** Browser-only: rasterize the SVG to a PNG and trigger a download. */
export async function exportCardPng(
  data: CardData,
  filename = "music-personality.png",
): Promise<void> {
  const svg = buildCardSvg(data);
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Failed to render card"));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = SIZE;
    canvas.height = SIZE;
    canvas.getContext("2d")?.drawImage(img, 0, 0, SIZE, SIZE);
    const pngUrl = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = pngUrl;
    a.download = filename;
    a.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}
