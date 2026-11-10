import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Chrono } from "../../../src/components/jeu/Chrono";
import { announcementFor, chronoLevel, chronoSnapshot, secondsLeft, startChronoTicker } from "../../../src/components/jeu/chrono-state";
import { createQuestionClock, type ClockSample } from "../../../src/shared/clock";

describe("niveaux du chrono", () => {
  it("calme au dessus de 10 s, attention jusqu'à 5 s exclu, critique ensuite", () => {
    expect(chronoLevel(20_000)).toBe("calme");
    expect(chronoLevel(10_001)).toBe("calme");
    expect(chronoLevel(10_000)).toBe("attention");
    expect(chronoLevel(5_001)).toBe("attention");
    expect(chronoLevel(5_000)).toBe("critique");
    expect(chronoLevel(0)).toBe("critique");
  });

  it("arrondit les secondes à l'entier supérieur et ne descend pas sous zéro", () => {
    expect(secondsLeft(12_001)).toBe(13);
    expect(secondsLeft(999)).toBe(1);
    expect(secondsLeft(-50)).toBe(0);
  });
});

describe("changement d'horloge", () => {
  it("recalcule reste et annonce d'un bloc pour la nouvelle horloge, sans reprendre l'ancienne", () => {
    const ancienne = createQuestionClock({ startedAt: 0, serverNow: 19_000, durationMs: 20_000 }, () => 19_000);
    const nouvelle = createQuestionClock({ startedAt: 0, serverNow: 0, durationMs: 20_000 }, () => 0);
    expect(chronoSnapshot(ancienne)).toMatchObject({ remaining: 1_000, announcement: { text: "1 seconde restante" } });
    const apres = chronoSnapshot(nouvelle);
    expect(apres.clock).toBe(nouvelle);
    expect(apres.remaining).toBe(20_000);
    expect(apres.announcement.text).toBe("20 secondes restantes");
  });
});

describe("annonces aria-live", () => {
  it("ne change de clé qu'aux paliers 10 s, 5 s et 0, jamais chaque seconde", () => {
    const cles: number[] = [];
    for (let ms = 20_000; ms >= 0; ms -= 100) {
      const { key } = announcementFor(ms);
      if (cles.at(-1) !== key) cles.push(key);
    }
    // Réception, 10 s, 5 s, écoulé : quatre annonces sur vingt secondes.
    expect(cles).toEqual([3, 2, 1, 0]);
  });

  it("annonce « Temps écoulé » à zéro et le singulier à une seconde", () => {
    expect(announcementFor(0)).toEqual({ key: 0, text: "Temps écoulé" });
    expect(announcementFor(1000).text).toBe("1 seconde restante");
    expect(announcementFor(15_000).text).toBe("15 secondes restantes");
  });
});

describe("boucle du chrono (horloge simulée)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("suit la dérive entre l'heure locale et l'heure serveur", () => {
    // Le serveur est 5 s en avance sur le navigateur : la question a démarré il y a 3 s côté serveur.
    let local = 100_000;
    const restants: number[] = [];
    const stop = startChronoTicker(createQuestionClock({ startedAt: 1_000_000, serverNow: 1_003_000, durationMs: 20_000 }, () => local), {
      onTick: (left) => restants.push(left),
    });
    expect(restants[0]).toBe(17_000);
    local += 2_000;
    vi.advanceTimersByTime(200);
    expect(restants.at(-1)).toBe(15_000);
    stop();
  });

  it("ignore un saut de l'horloge locale vers le passé (reste borné à la durée)", () => {
    let local = 50_000;
    const restants: number[] = [];
    const stop = startChronoTicker(createQuestionClock({ startedAt: 10, serverNow: 10, durationMs: 10_000 }, () => local), {
      onTick: (left) => restants.push(left),
    });
    local -= 30_000;
    vi.advanceTimersByTime(200);
    expect(restants.at(-1)).toBe(10_000);
    stop();
  });

  it("appelle onExpire une seule fois puis reste à zéro", () => {
    let local = 0;
    const onExpire = vi.fn();
    const restants: number[] = [];
    const stop = startChronoTicker(createQuestionClock({ startedAt: 0, serverNow: 0, durationMs: 1_000 }, () => local), {
      onTick: (left) => restants.push(left),
      onExpire,
    });
    for (let i = 0; i < 20; i++) {
      local += 200;
      vi.advanceTimersByTime(200);
    }
    expect(onExpire).toHaveBeenCalledTimes(1);
    expect(restants.at(-1)).toBe(0);
    stop();
  });

  it("n'émet une annonce que quand le palier change", () => {
    let local = 0;
    const annonces: string[] = [];
    const stop = startChronoTicker(createQuestionClock({ startedAt: 0, serverNow: 0, durationMs: 11_000 }, () => local), {
      onTick: (_left, next) => {
        if (next) annonces.push(next.text);
      },
    });
    for (let i = 0; i < 60; i++) {
      local += 200;
      vi.advanceTimersByTime(200);
    }
    expect(annonces).toEqual(["11 secondes restantes", "10 secondes restantes", "5 secondes restantes", "Temps écoulé"]);
    stop();
  });

  it("remonter le chrono sur la même horloge ne relance pas le compte et ne rappelle pas onExpire", () => {
    let local = 0;
    const clock = createQuestionClock({ startedAt: 0, serverNow: 0, durationMs: 3_000 }, () => local);
    const onExpire = vi.fn();
    const restants: number[] = [];
    const premier = startChronoTicker(clock, { onTick: (l) => restants.push(l), onExpire });
    local += 1_000;
    vi.advanceTimersByTime(1_000);
    premier();

    // Démontage puis remontage : la nouvelle boucle reprend où l'horloge en est, pas à la durée pleine.
    const second = startChronoTicker(clock, { onTick: (l) => restants.push(l), onExpire });
    expect(restants.at(-1)).toBe(2_000);
    local += 2_500;
    vi.advanceTimersByTime(2_500);
    expect(onExpire).toHaveBeenCalledTimes(1);
    second();

    // Remontage après expiration : reste à zéro, aucun nouvel appel.
    const troisieme = startChronoTicker(clock, { onTick: (l) => restants.push(l), onExpire });
    expect(restants.at(-1)).toBe(0);
    local += 5_000;
    vi.advanceTimersByTime(5_000);
    expect(onExpire).toHaveBeenCalledTimes(1);
    troisieme();
  });

  it("n'utilise plus l'intervalle après l'arrêt", () => {
    const onTick = vi.fn();
    const stop = startChronoTicker(createQuestionClock({ startedAt: 0, serverNow: 0, durationMs: 5_000 }, () => 0), { onTick });
    stop();
    onTick.mockClear();
    vi.advanceTimersByTime(1_000);
    expect(onTick).not.toHaveBeenCalled();
  });
});

describe("rendu du Chrono", () => {
  const rendre = (restantMs: number, durationMs = 20_000) => {
    const sample: ClockSample = { startedAt: 0, serverNow: durationMs - restantMs, durationMs };
    return renderToStaticMarkup(createElement(Chrono, { clock: createQuestionClock(sample, () => sample.serverNow) }));
  };

  it("affiche les secondes restantes et un minuteur étiqueté", () => {
    const html = rendre(12_000);
    expect(html).toContain('role="timer"');
    expect(html).toContain("12 secondes restantes");
    expect(html).toContain("bg-creme");
  });

  it("passe en mangue sous 10 s puis en piment et tremblement sous 5 s", () => {
    expect(rendre(9_000)).toContain("bg-mangue");
    const critique = rendre(3_000);
    expect(critique).toContain("bg-piment");
    expect(critique).toContain("animate-tremble");
    expect(critique).toContain('data-niveau="critique"');
  });

  it("transmet seulement la progression en style inline, sans couleur ni taille", () => {
    const html = rendre(10_000);
    expect(html).toContain("--progression:50");
    expect(html).not.toMatch(/style="[^"]*(color|background|width|height)/);
  });

  it("affiche « Temps écoulé » à zéro, sans tremblement", () => {
    const html = rendre(0);
    expect(html).toContain("Temps écoulé");
    expect(html).not.toContain("animate-tremble");
  });
});
