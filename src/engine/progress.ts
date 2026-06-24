/**
 * A tiny in-memory progress store for the single long-running operation at a time
 * (sort or profile). The HTTP handler runs the whole job in one request, so the browser
 * can't see intermediate state from the response alone — it polls `GET /api/progress`
 * while the request is in flight. One global slot is enough: the app is local and
 * single-user, and only one heavy job runs at once.
 */
export interface Progress {
  /** True while a job is running. */
  active: boolean;
  /** Coarse stage: "reading" | "classifying" | "finishing" | "". */
  phase: string;
  /** Human-readable line shown under the spinner. */
  message: string;
  /** Completed units (e.g. classified batches); 0 when not applicable. */
  done: number;
  /** Total units; 0 when unknown/not applicable. */
  total: number;
}

let current: Progress = { active: false, phase: "", message: "", done: 0, total: 0 };

export function getProgress(): Progress {
  return current;
}

/** Begin a job: marks active and resets counters. */
export function startProgress(phase: string, message: string): void {
  current = { active: true, phase, message, done: 0, total: 0 };
}

/** Patch any subset of the current progress (merges with existing). */
export function updateProgress(patch: Partial<Progress>): void {
  current = { ...current, ...patch };
}

/** Mark the job finished (keeps the last message so a final poll reads cleanly). */
export function endProgress(): void {
  current = { ...current, active: false, phase: "", done: 0, total: 0 };
}
