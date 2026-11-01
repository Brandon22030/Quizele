import { createQuestionClock, type ClockSample } from "../../shared/clock";

export type ChronoLevel = "calme" | "attention" | "critique";

export const ATTENTION_MS = 10_000;
export const CRITICAL_MS = 5_000;
// Un lecteur d'écran ne doit pas parler chaque seconde : une annonce par palier de 5 s.
const ANNOUNCE_STEP_S = 5;

export function chronoLevel(remainingMs: number): ChronoLevel {
  if (remainingMs <= CRITICAL_MS) return "critique";
  if (remainingMs <= ATTENTION_MS) return "attention";
  return "calme";
}

export const secondsLeft = (remainingMs: number): number => Math.max(0, Math.ceil(remainingMs / 1000));

// Reste affiché à la réception du message, avant que l'horloge locale n'existe : même valeur côté serveur et navigateur.
export function initialRemainingMs(startedAt: number, serverNow: number, durationMs: number): number {
  return durationMs - Math.min(durationMs, Math.max(0, serverNow - startedAt));
}

export interface Announcement {
  // Change uniquement quand une annonce doit être faite.
  key: number;
  text: string;
}

export function announcementFor(remainingMs: number): Announcement {
  const s = secondsLeft(remainingMs);
  if (s === 0) return { key: 0, text: "Temps écoulé" };
  return { key: Math.ceil(s / ANNOUNCE_STEP_S), text: s === 1 ? "1 seconde restante" : `${s} secondes restantes` };
}

export interface TickerHandlers {
  onTick: (remainingMs: number, announcement: Announcement | null) => void;
  onExpire?: () => void;
}

export const TICK_MS = 200;

// Boucle du chrono hors React pour pouvoir la tester avec une horloge simulée. `announcement` n'est
// non nul que lorsque le palier d'annonce change.
export function startChronoTicker(
  sample: ClockSample,
  now: () => number,
  handlers: TickerHandlers,
): () => void {
  const clock = createQuestionClock(sample, now);
  let lastKey: number | null = null;
  const tick = () => {
    const left = clock.remaining();
    const next = announcementFor(left);
    const changed = next.key !== lastKey;
    lastKey = next.key;
    handlers.onTick(left, changed ? next : null);
    if (clock.checkExpired()) handlers.onExpire?.();
  };
  tick();
  const timer = setInterval(tick, TICK_MS);
  return () => clearInterval(timer);
}
