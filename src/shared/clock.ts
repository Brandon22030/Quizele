// Seul fichier autorisé à lire l'heure locale côté navigateur (lint:jetons).
// Le chrono se déduit de startedAt et serverNow reçus du Durable Object, jamais de l'heure locale seule.

export interface ClockSample {
  startedAt: number;
  serverNow: number;
  durationMs: number;
}

export function computeDrift(localNow: number, serverNow: number): number {
  return localNow - serverNow;
}

export function elapsedMs(nowMs: number, startedAt: number, driftMs: number, durationMs: number): number {
  return Math.min(durationMs, Math.max(0, nowMs - startedAt - driftMs));
}

export function remainingMs(nowMs: number, startedAt: number, driftMs: number, durationMs: number): number {
  return durationMs - elapsedMs(nowMs, startedAt, driftMs, durationMs);
}

export interface QuestionClock {
  remaining(): number;
  elapsed(): number;
  // Renvoie true une seule fois, au premier appel où le délai est écoulé.
  checkExpired(): boolean;
}

export function createQuestionClock(sample: ClockSample, localNow: () => number = Date.now): QuestionClock {
  // Dérive figée à la réception du message : une horloge locale qui saute ensuite ne décale pas le chrono.
  const drift = computeDrift(localNow(), sample.serverNow);
  let expired = false;
  return {
    remaining: () => remainingMs(localNow(), sample.startedAt, drift, sample.durationMs),
    elapsed: () => elapsedMs(localNow(), sample.startedAt, drift, sample.durationMs),
    checkExpired() {
      if (expired || elapsedMs(localNow(), sample.startedAt, drift, sample.durationMs) < sample.durationMs) return false;
      expired = true;
      return true;
    },
  };
}
