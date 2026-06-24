import type { LibraryAggregate } from "../profile/aggregate.js";
import type { PersonalityProfile } from "../profile/analyze.js";
import { buildCardSvg, exportCardPng, type CardData } from "./card.js";

const app = document.getElementById("app") as HTMLElement;

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message ?? `${path} failed (${res.status})`);
  }
  return (await res.json()) as T;
}

function el(html: string): HTMLElement {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
}

function note(target: HTMLElement, message: string, ok = false): void {
  target.innerHTML = `<span style="color:${ok ? "#1db954" : "#9aa0aa"}">${message}</span>`;
}

async function renderConnect(): Promise<void> {
  app.innerHTML = "";
  const btn = el(`<button style="background:#1db954;border:0;color:#06210f;font-weight:700;padding:12px 20px;border-radius:999px;cursor:pointer">Connect Spotify</button>`);
  const msg = el(`<p class="status"></p>`);
  btn.addEventListener("click", async () => {
    try {
      const { authorizeUrl } = await api<{ authorizeUrl: string }>("/api/connect");
      window.location.href = authorizeUrl;
    } catch (err) {
      note(msg, (err as Error).message);
    }
  });
  app.append(btn, msg);
}

async function renderDashboard(): Promise<void> {
  app.innerHTML = "";
  const cfg = await api<{ buckets: { name: string }[] }>("/api/buckets");

  const bucketsBox = el(
    `<textarea rows="6" style="width:100%;background:#0f1014;color:#e8e9ed;border:1px solid #262932;border-radius:8px;padding:10px;font:14px monospace">${cfg.buckets.map((b) => b.name).join("\n")}</textarea>`,
  ) as HTMLTextAreaElement;
  const saveBtn = el(`<button class="btn">Save buckets</button>`);
  const sortBtn = el(`<button class="btn">Sort my library</button>`);
  const profileBtn = el(`<button class="btn">Reveal my music personality</button>`);
  const status = el(`<p class="status"></p>`);
  const output = el(`<div></div>`);

  for (const b of [saveBtn, sortBtn, profileBtn]) {
    b.setAttribute(
      "style",
      "background:#23262f;border:1px solid #262932;color:#e8e9ed;padding:10px 16px;border-radius:8px;cursor:pointer;margin:8px 8px 0 0",
    );
  }

  saveBtn.addEventListener("click", async () => {
    const buckets = bucketsBox.value
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((name) => ({ name }));
    try {
      await api("/api/buckets", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ buckets }),
      });
      note(status, "Buckets saved.", true);
    } catch (err) {
      note(status, (err as Error).message);
    }
  });

  sortBtn.addEventListener("click", async () => {
    note(status, "Sorting… reading your library and classifying — this can take a few minutes.");
    try {
      const result = await api<{ created: { bucket: string }[]; removedPrior: number }>(
        "/api/sort",
        { method: "POST" },
      );
      note(
        status,
        `Created ${result.created.length} playlist(s): ${result.created.map((c) => c.bucket).join(", ")}.`,
        true,
      );
    } catch (err) {
      note(status, (err as Error).message);
    }
  });

  profileBtn.addEventListener("click", async () => {
    note(status, "Analyzing your whole library…");
    try {
      const { aggregate, profile } = await api<{
        aggregate: LibraryAggregate;
        profile: PersonalityProfile;
      }>("/api/profile");
      note(status, "");
      renderCard(output, { aggregate, profile });
    } catch (err) {
      note(status, (err as Error).message);
    }
  });

  app.append(
    el(`<label class="status">Your vibe buckets (one per line)</label>`),
    bucketsBox,
    el(`<div></div>`),
    saveBtn,
    sortBtn,
    profileBtn,
    status,
    output,
  );
}

function renderCard(target: HTMLElement, data: CardData): void {
  target.innerHTML = "";
  const preview = el(`<div style="max-width:360px;margin-top:20px"></div>`);
  preview.innerHTML = buildCardSvg(data).replace("<svg", '<svg style="width:100%;height:auto;border-radius:12px"');
  const download = el(
    `<button style="margin-top:12px;background:#1db954;border:0;color:#06210f;font-weight:700;padding:10px 18px;border-radius:999px;cursor:pointer">Download card (PNG)</button>`,
  );
  download.addEventListener("click", () => void exportCardPng(data));
  target.append(preview, download);
}

async function main(): Promise<void> {
  try {
    const { connected } = await api<{ connected: boolean }>("/api/status");
    if (connected) await renderDashboard();
    else await renderConnect();
  } catch (err) {
    note(app, (err as Error).message);
  }
}

void main();
