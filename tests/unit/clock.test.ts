import { describe, expect, it } from "vitest";
import { computeDrift, createQuestionClock, elapsedMs, remainingMs } from "../../src/shared/clock";

describe("clock : dérive", () => {
  it("dérive positive : horloge locale en avance sur le serveur", () => {
    const drift = computeDrift(10_500, 10_000);
    expect(drift).toBe(500);
    // Le serveur a démarré la question à 10 000 : à l'heure locale 11 500, 1 000 ms se sont écoulées.
    expect(elapsedMs(11_500, 10_000, drift, 20_000)).toBe(1000);
  });

  it("dérive négative : horloge locale en retard", () => {
    const drift = computeDrift(9_000, 10_000);
    expect(drift).toBe(-1000);
    expect(elapsedMs(10_500, 10_000, drift, 20_000)).toBe(1500);
  });

  it("borne à 0 avant le démarrage et à la durée après", () => {
    expect(elapsedMs(5_000, 10_000, 0, 20_000)).toBe(0);
    expect(elapsedMs(99_000, 10_000, 0, 20_000)).toBe(20_000);
    expect(remainingMs(99_000, 10_000, 0, 20_000)).toBe(0);
    expect(remainingMs(10_000, 10_000, 0, 20_000)).toBe(20_000);
  });
});

describe("clock : chrono de question", () => {
  it("fige la dérive à la création et n'expire qu'une fois", () => {
    let local = 1_000_000;
    const clock = createQuestionClock({ startedAt: 50_000, serverNow: 50_000, durationMs: 10_000 }, () => local);
    // dérive = 950 000 : le serveur est 950 s derrière l'heure locale
    local += 4_000;
    expect(clock.elapsed()).toBe(4_000);
    expect(clock.remaining()).toBe(6_000);
    expect(clock.checkExpired()).toBe(false);
    local += 6_000;
    expect(clock.checkExpired()).toBe(true);
    expect(clock.checkExpired()).toBe(false);
    local += 60_000;
    expect(clock.remaining()).toBe(0);
    expect(clock.checkExpired()).toBe(false);
  });

  it("tient compte du temps déjà écoulé à la reprise (serverNow après startedAt)", () => {
    let local = 500;
    const clock = createQuestionClock({ startedAt: 1_000, serverNow: 7_000, durationMs: 20_000 }, () => local);
    expect(clock.elapsed()).toBe(6_000);
    local += 1_000;
    expect(clock.remaining()).toBe(13_000);
  });
});

describe("clock : localNow", () => {
  it("lit l'heure locale et sert d'horloge par défaut du chrono", async () => {
    const { localNow, createQuestionClock } = await import("../../src/shared/clock");
    expect(Math.abs(localNow() - Date.now())).toBeLessThan(50);
    const clock = createQuestionClock({ startedAt: Date.now(), serverNow: Date.now(), durationMs: 10_000 });
    expect(clock.remaining()).toBeGreaterThan(9_000);
  });
});
