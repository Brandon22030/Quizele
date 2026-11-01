import type { QuestionClock } from "../../shared/clock";

export type ChronoLevel = "calme" | "attention" | "critique";

export const ATTENTION_MS = 10_000;
export const CRITICAL_MS = 5_000;
export const TICK_MS = 200;

export function chronoLevel(remainingMs: number): ChronoLevel {
  if (remainingMs <= CRITICAL_MS) return "critique";
  if (remainingMs <= ATTENTION_MS) return "attention";
  return "calme";
}

export const secondsLeft = (remainingMs: number): number => Math.max(0, Math.ceil(remainingMs / 1000));

export interface Announcement {
  // Change uniquement quand une annonce doit être faite.
  key: number;
  text: string;
}

// Un lecteur d'écran ne doit pas parler chaque seconde : annonce à la réception, puis à 10 s, 5 s et 0.
export function announcementFor(remainingMs: number): Announcement {
  const s = secondsLeft(remainingMs);
  if (s === 0) return { key: 0, text: "Temps écoulé" };
  const text = s === 1 ? "1 seconde restante" : `${s} secondes restantes`;
  if (remainingMs <= CRITICAL_MS) return { key: 1, text };
  if (remainingMs <= ATTENTION_MS) return { key: 2, text };
  return { key: 3, text };
}

export interface TickerHandlers {
  onTick: (remainingMs: number, announcement: Announcement | null) => void;
  onExpire?: () => void;
}

// Boucle du chrono hors React pour la tester avec une horloge simulée. L'horloge appartient à l'état de session :
// un remontage du composant la reprend telle quelle, et `checkExpired` (une seule fois par horloge) garantit
// un seul onExpire quel que soit le nombre de boucles successives.
export function startChronoTicker(clock: QuestionClock, handlers: TickerHandlers): () => void {
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
