import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Chrono } from "../../../src/components/jeu/Chrono";
import {
  announcementFor,
  chronoLevel,
  initialRemainingMs,
  secondsLeft,
  startChronoTicker,
} from "../../../src/components/jeu/chrono-state";

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

  it("calcule le reste initial depuis startedAt et serverNow, borné à la durée", () => {
    expect(initialRemainingMs(1000, 9000, 20_000)).toBe(12_000);
    expect(initialRemainingMs(1000, 500, 20_000)).toBe(20_000);
    expect(initialRemainingMs(1000, 99_000, 20_000)).toBe(0);
  });
});

describe("annonces aria-live", () => {
  it("ne change de clé qu'une fois par palier de 5 s", () => {
    const cles = new Set<number>();
    for (let ms = 20_000; ms >= 1; ms -= 100) cles.add(announcementFor(ms).key);
    // 20 s, 15 s, 10 s, 5 s : quatre annonces sur vingt secondes, jamais une par seconde.
    expect([...cles].sort((a, b) => b - a)).toEqual([4, 3, 2, 1]);
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
    const stop = startChronoTicker({ startedAt: 1_000_000, serverNow: 1_003_000, durationMs: 20_000 }, () => local, {
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
    const stop = startChronoTicker({ startedAt: 10, serverNow: 10, durationMs: 10_000 }, () => local, {
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
    const stop = startChronoTicker({ startedAt: 0, serverNow: 0, durationMs: 1_000 }, () => local, {
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
    const stop = startChronoTicker({ startedAt: 0, serverNow: 0, durationMs: 11_000 }, () => local, {
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

  it("n'utilise plus l'intervalle après l'arrêt", () => {
    const onTick = vi.fn();
    const stop = startChronoTicker({ startedAt: 0, serverNow: 0, durationMs: 5_000 }, () => 0, { onTick });
    stop();
    onTick.mockClear();
    vi.advanceTimersByTime(1_000);
    expect(onTick).not.toHaveBeenCalled();
  });
});

describe("rendu du Chrono", () => {
  const rendre = (restantMs: number, durationMs = 20_000) =>
    renderToStaticMarkup(createElement(Chrono, { startedAt: 0, serverNow: durationMs - restantMs, durationMs }));

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
  });

  it("affiche « Temps écoulé » à zéro, sans tremblement", () => {
    const html = rendre(0);
    expect(html).toContain("Temps écoulé");
    expect(html).not.toContain("animate-tremble");
  });
});
