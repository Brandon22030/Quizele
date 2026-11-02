import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ATTENTE_REPONSE_MS, detenirSession, ecouterEcritures, sessionLibre, signalerEcriture, type Canal, type MessageOnglet } from "../../../src/islands/editeur/onglets";

// Bus façon BroadcastChannel : un message part vers tous les autres canaux, jamais vers son émetteur, de façon asynchrone.
function bus() {
  const canaux = new Set<{ ecouteurs: Set<(m: MessageOnglet) => void> }>();
  return function ouvrir(): Canal {
    const moi = { ecouteurs: new Set<(m: MessageOnglet) => void>() };
    canaux.add(moi);
    return {
      envoyer(m) {
        for (const c of canaux) if (c !== moi) for (const fn of [...c.ecouteurs]) queueMicrotask(() => fn(m));
      },
      ecouter(fn) {
        moi.ecouteurs.add(fn);
        return () => moi.ecouteurs.delete(fn);
      },
      fermer: () => canaux.delete(moi),
    };
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("brouillon de nouveau quiz détenu par un seul onglet", () => {
  it("sans autre onglet, la session est libre après le délai d'attente", async () => {
    const ouvrir = bus();
    const libre = sessionLibre(ouvrir(), "s1", "onglet-b");
    await vi.advanceTimersByTimeAsync(ATTENTE_REPONSE_MS);
    await expect(libre).resolves.toBe(true);
  });

  it("un onglet qui détient la session répond : le nouvel onglet ne reprend pas le brouillon", async () => {
    const ouvrir = bus();
    detenirSession(ouvrir(), "s1");
    const libre = sessionLibre(ouvrir(), "s1", "onglet-b");
    await vi.advanceTimersByTimeAsync(ATTENTE_REPONSE_MS);
    await expect(libre).resolves.toBe(false);
  });

  it("une autre session détenue ne gêne pas", async () => {
    const ouvrir = bus();
    detenirSession(ouvrir(), "s2");
    const libre = sessionLibre(ouvrir(), "s1", "onglet-b");
    await vi.advanceTimersByTimeAsync(ATTENTE_REPONSE_MS);
    await expect(libre).resolves.toBe(true);
  });

  it("deux onglets qui demandent en même temps : un seul reprend le brouillon, jamais les deux", async () => {
    for (const [x, y] of [
      ["onglet-a", "onglet-b"],
      ["onglet-b", "onglet-a"],
    ]) {
      const ouvrir = bus();
      const premier = sessionLibre(ouvrir(), "s1", x);
      const second = sessionLibre(ouvrir(), "s1", y);
      await vi.advanceTimersByTimeAsync(ATTENTE_REPONSE_MS);
      const verdicts = await Promise.all([premier, second]);
      expect(verdicts.filter(Boolean)).toHaveLength(1);
      // Le plus petit identifiant gagne, quel que soit l'ordre d'arrivée.
      expect(verdicts[x < y ? 0 : 1]).toBe(true);
    }
  });

  it("un onglet arrivé après la question s'efface aussi devant le premier", async () => {
    const ouvrir = bus();
    const premier = sessionLibre(ouvrir(), "s1", "onglet-a");
    await vi.advanceTimersByTimeAsync(ATTENTE_REPONSE_MS / 2);
    const tardif = sessionLibre(ouvrir(), "s1", "onglet-z");
    await vi.advanceTimersByTimeAsync(ATTENTE_REPONSE_MS);
    expect(await Promise.all([premier, tardif])).toEqual([true, false]);
  });

  it("sans canal (navigateur sans BroadcastChannel ni stockage), la session est libre", async () => {
    await expect(sessionLibre(null, "s1", "onglet-a")).resolves.toBe(true);
  });
});

describe("écritures d'un autre onglet sur le même quiz", () => {
  it("prévient seulement pour le quiz affiché et jamais pour ses propres écritures", async () => {
    const ouvrir = bus();
    const a = ouvrir();
    const b = ouvrir();
    const prevenu = vi.fn();
    ecouterEcritures(a, "onglet-a", () => "quiz1", prevenu);
    signalerEcriture(b, "quiz2", "onglet-b");
    signalerEcriture(b, "quiz1", "onglet-a");
    await vi.advanceTimersByTimeAsync(0);
    expect(prevenu).not.toHaveBeenCalled();
    signalerEcriture(b, "quiz1", "onglet-b");
    await vi.advanceTimersByTimeAsync(0);
    expect(prevenu).toHaveBeenCalledTimes(1);
  });

  it("un quiz pas encore créé n'est concerné par aucune écriture, puis l'est dès sa création", async () => {
    const ouvrir = bus();
    const a = ouvrir();
    const b = ouvrir();
    let quizId: string | null = null;
    const prevenu = vi.fn();
    const arreter = ecouterEcritures(a, "onglet-a", () => quizId, prevenu);
    signalerEcriture(b, "quiz1", "onglet-b");
    await vi.advanceTimersByTimeAsync(0);
    expect(prevenu).not.toHaveBeenCalled();
    quizId = "quiz1";
    signalerEcriture(b, "quiz1", "onglet-b");
    await vi.advanceTimersByTimeAsync(0);
    expect(prevenu).toHaveBeenCalledTimes(1);
    arreter();
    signalerEcriture(b, "quiz1", "onglet-b");
    await vi.advanceTimersByTimeAsync(0);
    expect(prevenu).toHaveBeenCalledTimes(1);
  });

  it("les messages d'écriture ne faussent pas la détention d'une session", async () => {
    const ouvrir = bus();
    const autre = ouvrir();
    const libre = sessionLibre(ouvrir(), "s1", "onglet-b");
    signalerEcriture(autre, "quiz1", "onglet-a");
    await vi.advanceTimersByTimeAsync(ATTENTE_REPONSE_MS);
    await expect(libre).resolves.toBe(true);
  });
});
