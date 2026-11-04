import { describe, expect, it } from "vitest";
import { commandesDisponibles, libelleDemarrer, libelleSuivante, libelleTerminer, vueHote } from "../../../src/islands/animateur/logique";
import { etat, instantane, question, revelation } from "./aide";

const tout = (c: ReturnType<typeof commandesDisponibles>) => [c.demarrer, c.reveler, c.suivante, c.terminer];

describe("boutons de la télécommande selon la phase", () => {
  it("salle : seul le lancement et la fin sont possibles", () => {
    expect(tout(commandesDisponibles(etat([instantane()])))).toEqual([true, false, false, true]);
  });

  it("question : révéler et terminer", () => {
    expect(tout(commandesDisponibles(etat([instantane(), question()])))).toEqual([false, true, false, true]);
  });

  it("correction : passer à la suite et terminer", () => {
    expect(tout(commandesDisponibles(etat([instantane(), question(), revelation])))).toEqual([false, false, true, true]);
  });

  it("mode libre en cours : seule la fin est offerte", () => {
    const libre = etat([instantane({ phase: "running", mode: "own_pace", playerCount: 3, finishedCount: 1 })]);
    expect(tout(commandesDisponibles(libre))).toEqual([false, false, false, true]);
  });

  it("partie finie : plus aucune commande", () => {
    const fin = etat([instantane({ phase: "finished", ranking: [], total: 10 })]);
    expect(tout(commandesDisponibles(fin))).toEqual([false, false, false, false]);
  });

  it("hors connexion : rien n'est envoyé, la file de la socket rejouerait des commandes périmées", () => {
    for (const connexion of ["connecting", "reconnecting"] as const) {
      expect(tout(commandesDisponibles(etat([instantane()], connexion)))).toEqual([false, false, false, false]);
    }
  });

  it("avant le premier instantané : aucune commande", () => {
    expect(tout(commandesDisponibles(etat([])))).toEqual([false, false, false, false]);
  });
});

describe("enchaînement des commandes à partir d'instantanés simulés", () => {
  // Même table que le Durable Object (handleHostCommand) : une commande n'est acceptée que dans sa phase attendue.
  const phaseAttendue = { start: "lobby", reveal: "question", next: "revealed" } as const;
  const autorisee = (commande: keyof typeof phaseAttendue, phase: string | null) => phase === phaseAttendue[commande];

  it("les boutons actifs sont exactement les commandes que le serveur accepterait", () => {
    const etapes = [
      etat([instantane()]),
      etat([instantane(), question(0, 2)]),
      etat([instantane(), question(0, 2), revelation]),
      etat([instantane(), question(0, 2), revelation, question(1, 2)]),
      etat([instantane(), question(0, 2), revelation, question(1, 2), revelation]),
    ];
    for (const s of etapes) {
      const c = commandesDisponibles(s);
      expect(c.demarrer).toBe(autorisee("start", s.phase));
      expect(c.reveler).toBe(autorisee("reveal", s.phase));
      expect(c.suivante).toBe(autorisee("next", s.phase));
    }
  });

  it("déroule une partie de deux questions : salle, question, correction, question, correction, fin", () => {
    const parcours = [
      { messages: [instantane({ playerCount: 2 })], vue: "salle", actif: "demarrer" },
      { messages: [question(0, 2)], vue: "question", actif: "reveler" },
      { messages: [revelation], vue: "correction", actif: "suivante" },
      { messages: [question(1, 2)], vue: "question", actif: "reveler" },
      { messages: [{ ...revelation, questionId: "q2" } as const], vue: "correction", actif: "suivante" },
    ] as const;
    const recus: Parameters<typeof etat>[0] = [];
    for (const etape of parcours) {
      recus.push(...etape.messages);
      const s = etat(recus);
      expect(vueHote(s)).toBe(etape.vue);
      expect(commandesDisponibles(s)[etape.actif]).toBe(true);
    }
    recus.push({ type: "finished", ranking: [], total: 2 });
    const fin = etat(recus);
    expect(vueHote(fin)).toBe("fin");
    expect(tout(commandesDisponibles(fin))).toEqual([false, false, false, false]);
  });

  it("la fin de partie reste affichée quand la socket est fermée par le serveur", () => {
    const s = etat([instantane({ phase: "finished", ranking: [], total: 2 })], "ended");
    expect(vueHote(s)).toBe("fin");
  });

  it("une socket fermée avant la fin de la partie annonce une partie terminée", () => {
    expect(vueHote(etat([instantane()], "ended"))).toBe("termine");
  });

  it("un jeton refusé mène à l'écran d'échec", () => {
    expect(vueHote(etat([], "rejected"))).toBe("rejete");
  });
});

describe("libellés des commandes", () => {
  it("la dernière question propose les résultats", () => {
    expect(libelleSuivante(etat([instantane(), question(8, 10)]))).toBe("Question suivante");
    expect(libelleSuivante(etat([instantane(), question(9, 10)]))).toBe("Afficher les résultats");
  });

  it("le mode libre parle de partie, le mode ensemble de résultats", () => {
    const ensemble = etat([instantane()]);
    const libre = etat([instantane({ mode: "own_pace" })]);
    expect(libelleDemarrer(ensemble)).toBe("Lancer la première question");
    expect(libelleDemarrer(libre)).toBe("Lancer la partie");
    expect(libelleTerminer(ensemble)).toBe("Terminer et afficher les résultats");
    expect(libelleTerminer(libre)).toBe("Terminer la partie");
  });
});
