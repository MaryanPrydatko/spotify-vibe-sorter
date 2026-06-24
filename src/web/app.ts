/**
 * Client shell. U8 grows this into the full connect → buckets → sort → personality flow;
 * for now it confirms the local API is reachable so the scaffold is verifiable end to end.
 */

type Health = { ok: boolean; name: string };

async function main(): Promise<void> {
  const el = document.getElementById("app");
  if (!el) return;
  try {
    const res = await fetch("/api/health");
    const health = (await res.json()) as Health;
    el.innerHTML = health.ok
      ? `<span class="ok">●</span> Connected to local engine (<code>${health.name}</code>).`
      : "Engine reachable but not healthy.";
  } catch {
    el.textContent = "Could not reach the local engine.";
  }
}

void main();
