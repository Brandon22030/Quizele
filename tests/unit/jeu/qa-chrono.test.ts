import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startChronoTicker } from "../../../src/components/jeu/chrono-state";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

describe("QA chrono : dérive d'horloge", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const lancer = (localDebut: number, serverNow: number) => {
    let local = localDebut;
    const restants: number[] = [];
    const onExpire = vi.fn();
    const stop = startChronoTicker({ startedAt: 1_000_000, serverNow, durationMs: 10_000 }, () => local, {
      onTick: (l) => restants.push(l),
      onExpire,
    });
    return { restants, onExpire, stop, avancer: (ms: number) => { local += ms; vi.advanceTimersByTime(ms); } };
  };

  it.each([
    ["client en avance de 1 h", 1_000_000 + 3_600_000],
    ["client en retard de 1 h", 1_000_000 - 3_600_000],
    ["client synchrone", 1_000_000],
  ])("%s : même reste et même instant d'expiration", (_nom, localDebut) => {
    const c = lancer(localDebut, 1_002_000);
    expect(c.restants[0]).toBe(8_000);
    c.avancer(7_800);
    expect(c.onExpire).not.toHaveBeenCalled();
    c.avancer(400);
    expect(c.onExpire).toHaveBeenCalledTimes(1);
    expect(c.restants.at(-1)).toBe(0);
    c.avancer(5_000);
    expect(c.onExpire).toHaveBeenCalledTimes(1);
    c.stop();
  });

  it("question déjà terminée à la réception : expire immédiatement, une seule fois", () => {
    const c = lancer(0, 1_050_000);
    expect(c.restants[0]).toBe(0);
    expect(c.onExpire).toHaveBeenCalledTimes(1);
    c.avancer(2_000);
    expect(c.onExpire).toHaveBeenCalledTimes(1);
    c.stop();
  });
});

describe("QA chrono : jamais Date.now() seul", () => {
  const fichiers = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? fichiers(join(dir, e.name)) : [join(dir, e.name)]));

  it("aucune lecture directe de l'heure locale dans src/components/jeu", () => {
    for (const f of fichiers("src/components/jeu")) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/Date\.now\s*\(|performance\.now\s*\(|new Date\s*\(\s*\)/);
    }
  });
});
