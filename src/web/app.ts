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

interface Progress {
  active: boolean;
  phase: string;
  message: string;
  done: number;
  total: number;
}

/** Render the live progress line + a thin bar (only when batch counts are known). */
function renderProgress(target: HTMLElement, p: Progress): void {
  const pct = p.total > 0 ? Math.round((p.done / p.total) * 100) : null;
  const label =
    (p.message || "Working…") +
    (pct !== null ? `  ·  ${p.done}/${p.total} batches (${pct}%)` : "");
  const bar =
    pct === null
      ? ""
      : `<div style="margin-top:8px;height:6px;background:#23262f;border-radius:999px;overflow:hidden">` +
        `<div style="height:100%;width:${pct}%;background:#1db954;transition:width .3s"></div></div>`;
  target.innerHTML =
    `<div style="color:#9aa0aa;display:flex;align-items:center;gap:8px">` +
    `<span class="spinner"></span><span>${label}</span></div>${bar}`;
}

/**
 * Run a long job while polling /api/progress so the user sees live movement instead of
 * a frozen spinner. Returns the job's result; always stops polling and re-enables buttons.
 */
async function withProgress<T>(
  status: HTMLElement,
  buttons: HTMLElement[],
  run: () => Promise<T>,
): Promise<T> {
  let polling = true;
  buttons.forEach((b) => ((b as HTMLButtonElement).disabled = true));
  const poll = async (): Promise<void> => {
    while (polling) {
      try {
        const p = await api<Progress>("/api/progress");
        if (polling) renderProgress(status, p);
      } catch {
        /* ignore transient poll errors */
      }
      await new Promise((r) => setTimeout(r, 900));
    }
  };
  void poll();
  try {
    return await run();
  } finally {
    polling = false;
    buttons.forEach((b) => ((b as HTMLButtonElement).disabled = false));
  }
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
  const manageBtn = el(`<button class="btn">Manage my playlists</button>`);
  const status = el(`<p class="status"></p>`);
  const output = el(`<div></div>`);
  const manageArea = el(`<div></div>`);

  for (const b of [saveBtn, sortBtn, profileBtn, manageBtn]) {
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

  const allButtons = [saveBtn, sortBtn, profileBtn, manageBtn];

  let manageOpen = false;
  manageBtn.addEventListener("click", async () => {
    manageOpen = !manageOpen;
    if (!manageOpen) {
      manageArea.innerHTML = "";
      return;
    }
    await renderManage(manageArea);
  });

  sortBtn.addEventListener("click", async () => {
    output.innerHTML = "";
    try {
      const result = await withProgress(status, allButtons, () =>
        api<{ created: { bucket: string }[]; removedPrior: number }>("/api/sort", {
          method: "POST",
        }),
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
    output.innerHTML = "";
    try {
      const { aggregate, profile } = await withProgress(status, allButtons, () =>
        api<{ aggregate: LibraryAggregate; profile: PersonalityProfile }>("/api/profile"),
      );
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
    manageBtn,
    status,
    output,
    manageArea,
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

// --- Playlist management ---

interface PlaylistInfo {
  id: string;
  name: string;
  trackCount: number;
  isTool: boolean;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function smallBtn(label: string, variant: "default" | "danger" | "accent" = "default"): HTMLButtonElement {
  const bg = variant === "danger" ? "#3a1d22" : variant === "accent" ? "#1db954" : "#23262f";
  const bd = variant === "danger" ? "#5b2630" : "#262932";
  const fg = variant === "accent" ? "#06210f" : "#e8e9ed";
  const b = el(`<button>${label}</button>`) as HTMLButtonElement;
  b.setAttribute(
    "style",
    `background:${bg};border:1px solid ${bd};color:${fg};padding:6px 12px;border-radius:7px;cursor:pointer;font-size:13px;margin-left:6px`,
  );
  return b;
}

/** Render the user's playlists with backup-guarded delete / rename and a restore button. */
async function renderManage(area: HTMLElement): Promise<void> {
  area.innerHTML = `<p class="status" style="margin-top:18px">Loading your playlists…</p>`;
  let playlists: PlaylistInfo[];
  try {
    ({ playlists } = await api<{ playlists: PlaylistInfo[] }>("/api/playlists"));
  } catch (err) {
    area.innerHTML = `<p class="status" style="margin-top:18px;color:#e0a04a">${escapeAttr((err as Error).message)}</p>`;
    return;
  }

  area.innerHTML = "";
  const header = el(
    `<div style="margin-top:22px;display:flex;align-items:center;justify-content:space-between;gap:12px">` +
      `<span class="status">Your playlists (${playlists.length}) — deletes are backed up first</span></div>`,
  );
  const restore = smallBtn("Restore last backup");
  const headerMsg = el(`<p class="status" style="margin:6px 0 0"></p>`);
  header.append(restore);
  restore.addEventListener("click", async () => {
    restore.disabled = true;
    note(headerMsg, "Restoring from your last backup…");
    try {
      const r = await api<{ replaced: number; recreated: number }>("/api/restore", { method: "POST" });
      note(headerMsg, `Restored: ${r.replaced} updated, ${r.recreated} re-created.`, true);
      await renderManage(area);
    } catch (err) {
      note(headerMsg, (err as Error).message);
      restore.disabled = false;
    }
  });

  const list = el(`<div style="margin-top:10px"></div>`);
  for (const p of playlists) {
    list.append(playlistRow(p, area));
  }
  area.append(header, headerMsg, list);
}

function playlistRow(p: PlaylistInfo, area: HTMLElement): HTMLElement {
  const row = el(
    `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 0;border-top:1px solid #1c1f26"></div>`,
  );
  const tag = p.isTool
    ? ` <span style="color:#1db954;font-size:11px;border:1px solid #1db954;border-radius:999px;padding:1px 7px;margin-left:6px">vibe-sorter</span>`
    : "";
  const label = el(
    `<div style="min-width:0;flex:1"><span style="color:#e8e9ed">${escapeAttr(p.name)}</span>${tag}` +
      `<span class="status" style="margin-left:8px">${p.trackCount} tracks</span></div>`,
  );
  const actions = el(`<div style="flex:none;display:flex;align-items:center"></div>`);
  const renameBtn = smallBtn("Rename");
  const delBtn = smallBtn("Delete", "danger");
  actions.append(renameBtn, delBtn);

  // Inline rename — no blocking browser prompt.
  renameBtn.addEventListener("click", () => {
    const input = el(
      `<input value="${escapeAttr(p.name)}" style="background:#0f1014;color:#e8e9ed;border:1px solid #262932;border-radius:7px;padding:6px 8px;font-size:13px;width:200px">`,
    ) as HTMLInputElement;
    const save = smallBtn("Save", "accent");
    label.replaceWith(input);
    renameBtn.replaceWith(save);
    delBtn.remove();
    input.focus();
    save.addEventListener("click", async () => {
      save.disabled = true;
      try {
        await api("/api/playlists/rename", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: p.id, name: input.value }),
        });
        await renderManage(area);
      } catch (err) {
        save.disabled = false;
        input.insertAdjacentHTML(
          "afterend",
          `<span class="status" style="color:#e0a04a;margin-left:8px">${escapeAttr((err as Error).message)}</span>`,
        );
      }
    });
  });

  // Two-step delete confirm — avoids a blocking confirm() dialog.
  let armed = false;
  let armTimer: ReturnType<typeof setTimeout> | undefined;
  delBtn.addEventListener("click", async () => {
    if (!armed) {
      armed = true;
      delBtn.textContent = "Confirm delete?";
      armTimer = setTimeout(() => {
        armed = false;
        delBtn.textContent = "Delete";
      }, 3500);
      return;
    }
    if (armTimer) clearTimeout(armTimer);
    delBtn.disabled = true;
    delBtn.textContent = "Deleting…";
    try {
      await api("/api/playlists/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: p.id }),
      });
      row.replaceWith(
        el(`<div class="status" style="padding:10px 0;border-top:1px solid #1c1f26">Deleted “${escapeAttr(p.name)}” — recoverable via Restore.</div>`),
      );
    } catch (err) {
      delBtn.disabled = false;
      delBtn.textContent = "Delete";
      actions.insertAdjacentHTML(
        "beforebegin",
        `<span class="status" style="color:#e0a04a">${escapeAttr((err as Error).message)}</span>`,
      );
    }
  });

  row.append(label, actions);
  return row;
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
