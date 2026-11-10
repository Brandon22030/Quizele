import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { VueProjection } from "../../../src/islands/animateur/VueProjection";
import { VuePilotage } from "../../../src/islands/animateur/VuePilotage";
import {
  bonnesReponses,
  commandesDisponibles,
  echecDepuisCode,
  libelleSuivante,
  lireJetonHote,
  oublierJetonHote,
  vueHote,
} from "../../../src/islands/animateur/logique";
import { cleHote } from "../../../src/islands/tableau-de-bord/logique";
import { CODE, etat, instantane, options, question } from "./aide";

const rien = () => undefined;
const stockage = (valeur: string | null) => ({ getItem: () => valeur });

describe("jeton hôte en stockage", () => {
  it("rejette un contenu absent, corrompu, incomplet ou mal typé", () => {
    for (const brut of [null, "", "pas du json", "null", "42", "[]", '{"code":"ABC"}', '{"hostToken":"t"}', '{"code":"","hostToken":"t"}', '{"code":"A","hostToken":""}', '{"code":1,"hostToken":"t"}']) {
      expect(lireJetonHote(stockage(brut), "s1"), String(brut)).toBeNull();
    }
    expect(lireJetonHote(null, "s1")).toBeNull();
  });

  it("lit un jeton valide et utilise la clé de la partie", () => {
    const lu: string[] = [];
    const s = { getItem: (cle: string) => (lu.push(cle), '{"code":"K7Q2M9","hostToken":"abc"}') };
    expect(lireJetonHote(s, "s1")).toEqual({ code: "K7Q2M9", token: "abc" });
    expect(lu).toEqual([cleHote("s1")]);
  });

  it("un stockage qui lève (mode privé, quota) ne casse ni la lecture ni l'effacement", () => {
    const casse = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      removeItem: () => {
        throw new Error("SecurityError");
      },
    };
    expect(lireJetonHote(casse, "s1")).toBeNull();
    expect(() => oublierJetonHote(casse, "s1")).not.toThrow();
    expect(() => oublierJetonHote(null, "s1")).not.toThrow();
  });
});

describe("dernière question et cas limites des commandes", () => {
  it("à la dernière question, « Suivante » devient « Afficher les résultats »", () => {
    expect(libelleSuivante(etat([instantane(), question(6, 7)]))).toBe("Afficher les résultats");
    expect(libelleSuivante(etat([instantane(), question(5, 7)]))).toBe("Question suivante");
    expect(libelleSuivante(etat([instantane()]))).toBe("Question suivante");
  });

  it("jeton rejeté ou joueur retiré : vue d'échec et aucune commande", () => {
    for (const connexion of ["rejected", "kicked"] as const) {
      const s = etat([instantane()], connexion);
      expect(vueHote(s)).toBe("rejete");
      expect(commandesDisponibles(s).terminer).toBe(false);
    }
  });

  it("socket fermée après la fin : le classement prime sur « terminé »", () => {
    expect(vueHote(etat([instantane({ phase: "finished", ranking: [], total: 3 })], "ended"))).toBe("fin");
    expect(vueHote(etat([instantane()], "ended"))).toBe("termine");
  });

  it("bonnes réponses : identifiants inconnus ignorés, plusieurs réponses listées", () => {
    const base = [instantane(), question()];
    expect(bonnesReponses(etat([...base, { type: "reveal", questionId: "q3", correctOptionIds: ["inconnu"] }]))).toEqual([]);
    expect(bonnesReponses(etat([...base, { type: "reveal", questionId: "q3", correctOptionIds: ["o1", "o3"] }]))).toEqual(["A. Abraham", "C. Moïse"]);
    expect(bonnesReponses(etat([...base, { type: "reveal", questionId: "q3" }]))).toEqual([]);
  });

  it("codes d'erreur d'Action : inconnu devient réseau", () => {
    expect(echecDepuisCode("NOT_FOUND")).toBe("introuvable");
    expect(echecDepuisCode("UNAUTHORIZED")).toBe("connexion");
    expect(echecDepuisCode("INTERNAL_SERVER_ERROR")).toBe("reseau");
    expect(echecDepuisCode("")).toBe("reseau");
  });
});

describe("rendu : l'écran projeté ne trahit pas la bonne réponse", () => {
  const projeter = (messages: Parameters<typeof etat>[0]) =>
    renderToStaticMarkup(createElement(VueProjection, { state: etat(messages), code: CODE, origine: "http://localhost:4760", onFermer: rien }));
  const sansCorrection = [instantane({ role: "screen" }), question(), { type: "reveal" as const, questionId: "q3" }];

  it("aucune tuile marquée juste, ni badge, ni explication, ni classement", () => {
    const html = projeter(sansCorrection);
    expect(html).not.toContain("Bonne réponse<");
    expect(html).not.toContain("Genèse");
    expect(html).not.toContain('aria-label="Classement"');
    for (const o of options) expect(html).toContain(o.label);
  });

  it("la même vue avec correction affiche bien le badge (contrôle positif)", () => {
    const html = projeter([instantane(), question(), { type: "reveal", questionId: "q3", correctOptionIds: ["o2"], explanation: "Genèse 6." }]);
    expect(html).toContain("Bonne réponse");
    expect(html).toContain("Genèse 6.");
  });

  it("la projection n'expose jamais de bouton de pilotage, quelle que soit la phase ou le mode", () => {
    const phases = [
      [instantane()],
      [instantane(), question()],
      [instantane(), question(), { type: "reveal" as const, questionId: "q3", correctOptionIds: ["o2"] }],
      [instantane({ phase: "running", mode: "own_pace", playerCount: 3, finishedCount: 1 })],
      [instantane({ phase: "finished", total: 3, ranking: [] })],
    ];
    for (const messages of phases) {
      const boutons = [...projeter(messages).matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)].map(([, c]) => c.replace(/<[^>]*>/g, "").trim());
      expect(boutons.filter((b) => /Lancer|Révéler|suivante|Terminer|résultats/i.test(b))).toEqual([]);
    }
  });
});

describe("rendu : états du pilotage", () => {
  const pilotage = (messages: Parameters<typeof etat>[0], connexion: Parameters<typeof etat>[1] = "open") =>
    renderToStaticMarkup(
      createElement(VuePilotage, { sessionId: "s1", code: CODE, state: etat(messages, connexion), onDemarrer: rien, onReveler: rien, onSuivante: rien, onTerminer: rien, onRetirer: rien, onProjeter: rien }),
    );

  it("joueur au pseudo hostile : échappé dans le HTML", () => {
    const html = pilotage([instantane({ playerCount: 1, players: [{ id: "p1", pseudo: "<img src=x onerror=alert(1)>" }] })]);
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
  });

  it("« Terminer la partie » reste présent en mode libre à toutes les phases non finales", () => {
    for (const phase of ["lobby", "running", "waiting"] as const) {
      const html = pilotage([instantane({ phase, mode: "own_pace", playerCount: 2, finishedCount: 0 })]);
      expect(html, phase).toContain("Terminer la partie");
    }
    // La boîte de confirmation reste dans le HTML : c'est la barre de commandes collée en bas qui doit disparaître.
    expect(pilotage([instantane({ phase: "finished", mode: "own_pace", total: 3, ranking: [] })])).not.toContain("sticky bottom-0");
  });

  it("jeton rejeté : état d'erreur plutôt qu'une télécommande", () => {
    const html = pilotage([instantane()], "rejected");
    expect(html).not.toContain("Lancer la première question");
  });
});
