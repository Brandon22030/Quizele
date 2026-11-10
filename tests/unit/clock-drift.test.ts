import { describe, expect, it } from "vitest";
import { computeDrift, createQuestionClock, elapsedMs, remainingMs } from "../../src/shared/clock";

const DURATION = 20_000;

// Le serveur envoie startedAt et serverNow dans l'heure serveur ; le client lit son horloge locale décalée de `skew`.
function scenario(skewMs: number, elapsedAtReceipt = 0) {
  const startedAt = 1_000_000;
  const serverNow = startedAt + elapsedAtReceipt;
  let local = serverNow + skewMs;
  const clock = createQuestionClock({ startedAt, serverNow, durationMs: DURATION }, () => local);
  return { clock, advance: (ms: number) => (local += ms), setLocal: (v: number) => (local = v), startedAt, serverNow };
}

describe("clock : horloge client très décalée", () => {
  it.each([
    ["en avance de 5 s", 5_000],
    ["en avance de 1 h", 3_600_000],
    ["en retard de 7 s", -7_000],
    ["en retard de 1 jour", -86_400_000],
  ])("horloge locale %s : le chrono part de la durée pleine et décroît d'une seconde par seconde", (_nom, skew) => {
    const { clock, advance } = scenario(skew);
    expect(clock.remaining()).toBe(DURATION);
    advance(4_000);
    expect(clock.remaining()).toBe(16_000);
    expect(clock.elapsed()).toBe(4_000);
    advance(16_000);
    expect(clock.remaining()).toBe(0);
  });

  it.each([5_000, -5_000, 3_600_000])("reprise en cours de question avec une horloge décalée de %i ms", (skew) => {
    const { clock, advance } = scenario(skew, 8_000);
    expect(clock.remaining()).toBe(12_000);
    advance(12_000);
    expect(clock.checkExpired()).toBe(true);
    expect(clock.checkExpired()).toBe(false);
  });

  it("l'expiration n'est jamais signalée trop tôt, même avec 30 s d'avance sur le serveur", () => {
    const { clock, advance } = scenario(30_000);
    advance(DURATION - 1);
    expect(clock.checkExpired()).toBe(false);
    advance(1);
    expect(clock.checkExpired()).toBe(true);
  });

  it("un saut de l'horloge locale après réception ne rouvre pas le délai expiré", () => {
    const { clock, advance, setLocal, serverNow } = scenario(-4_000);
    advance(DURATION + 100);
    expect(clock.checkExpired()).toBe(true);
    setLocal(serverNow - 3_600_000);
    expect(clock.checkExpired()).toBe(false);
    expect(clock.remaining()).toBe(DURATION);
  });

  it("un saut avant la réception ne fausse pas la dérive : elle est figée à la création", () => {
    const { clock, setLocal, serverNow } = scenario(10_000);
    setLocal(serverNow + 10_000 + 5_000);
    expect(clock.remaining()).toBe(15_000);
  });

  it("serverNow antérieur à startedAt (message reçu avant le départ) : durée pleine, jamais au-delà", () => {
    const clock = createQuestionClock({ startedAt: 5_000, serverNow: 4_000, durationMs: DURATION }, () => 100_000);
    expect(clock.remaining()).toBe(DURATION);
    expect(clock.elapsed()).toBe(0);
  });

  it("fonctions pures : bornes avec dérive extrême", () => {
    const drift = computeDrift(10_000_000, 0);
    expect(elapsedMs(0, 0, drift, DURATION)).toBe(0);
    expect(remainingMs(10_000_000 + 1e9, 0, drift, DURATION)).toBe(0);
    expect(computeDrift(0, 10_000_000)).toBe(-10_000_000);
  });
});
