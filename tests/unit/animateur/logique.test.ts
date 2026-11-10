import { describe, expect, it } from "vitest";
import {
  annoncePhase,
  bonnesReponses,
  lireJetonHote,
  echecDepuisCode,
  libelleFinis,
  libelleParticipants,
  messageEchec,
  messageErreurServeur,
  oublierJetonHote,
  urlJoueur,
  vueHote,
} from "../../../src/islands/animateur/logique";
import { cleHote } from "../../../src/islands/tableau-de-bord/logique";
import { etat, instantane, question, revelation } from "./aide";

function stockage(initial: Record<string, string> = {}) {
  const donnees = new Map(Object.entries(initial));
  return {
    donnees,
    getItem: (cle: string) => donnees.get(cle) ?? null,
    removeItem: (cle: string) => void donnees.delete(cle),
  };
}

describe("jeton hôte transmis par sessionStorage", () => {
  it("est lu sans être effacé : un rechargement du même onglet reprend sans appel serveur", () => {
    const s = stockage({ [cleHote("s1")]: JSON.stringify({ code: "ABC234", hostToken: "jeton" }) });
    expect(lireJetonHote(s, "s1")).toEqual({ code: "ABC234", token: "jeton" });
    expect(lireJetonHote(s, "s1")).toEqual({ code: "ABC234", token: "jeton" });
  });

  it("s'oublie quand il est refusé : la reprise passe alors par l'action jetonHote", () => {
    const s = stockage({ [cleHote("s1")]: JSON.stringify({ code: "ABC234", hostToken: "jeton" }) });
    oublierJetonHote(s, "s1");
    expect(s.donnees.size).toBe(0);
    expect(lireJetonHote(s, "s1")).toBeNull();
    expect(() => oublierJetonHote(null, "s1")).not.toThrow();
  });

  it("ignore une valeur illisible ou incomplète", () => {
    expect(lireJetonHote(stockage({ [cleHote("s1")]: "pas du json" }), "s1")).toBeNull();
    expect(lireJetonHote(stockage({ [cleHote("s1")]: JSON.stringify({ code: "ABC234" }) }), "s1")).toBeNull();
    expect(lireJetonHote(stockage({ [cleHote("s1")]: JSON.stringify(null) }), "s1")).toBeNull();
  });

  it("sans stockage, ou pour une autre partie : null", () => {
    expect(lireJetonHote(null, "s1")).toBeNull();
    const s = stockage({ [cleHote("s2")]: JSON.stringify({ code: "ABC234", hostToken: "jeton" }) });
    expect(lireJetonHote(s, "s1")).toBeNull();
  });
});

describe("liens et libellés", () => {
  it("l'adresse du joueur se construit depuis l'origine fournie", () => {
    expect(urlJoueur("https://quiz.exemple.workers.dev", "K7Q2MB")).toBe("https://quiz.exemple.workers.dev/j/K7Q2MB");
    expect(urlJoueur("http://localhost:4760", "K7Q2MB")).toBe("http://localhost:4760/j/K7Q2MB");
  });

  it("pluriels des participants et des joueurs ayant fini", () => {
    expect([0, 1, 12].map(libelleParticipants)).toEqual(["Aucun participant", "1 participant", "12 participants"]);
    expect(libelleFinis(0, 3)).toBe("0 joueur sur 3 a fini");
    expect(libelleFinis(1, 3)).toBe("1 joueur sur 3 a fini");
    expect(libelleFinis(2, 3)).toBe("2 joueurs sur 3 ont fini");
  });

  it("bonne réponse affichée sous la forme « B. Noé », seulement après la révélation", () => {
    expect(bonnesReponses(etat([instantane(), question()]))).toEqual([]);
    expect(bonnesReponses(etat([instantane(), question(), revelation]))).toEqual(["B. Noé"]);
  });
});

describe("annonces et erreurs", () => {
  it("la région persistante dit la phase", () => {
    const salle = etat([instantane({ playerCount: 3 })]);
    expect(annoncePhase(salle, vueHote(salle))).toBe("En attente des joueurs. 3 participants");
    const q = etat([instantane(), question()]);
    expect(annoncePhase(q, vueHote(q))).toBe("Question 3 sur 10");
    const c = etat([instantane(), question(), revelation]);
    expect(annoncePhase(c, vueHote(c))).toBe("Correction affichée");
    const libre = etat([instantane({ phase: "running", mode: "own_pace", playerCount: 3, finishedCount: 2 })]);
    expect(annoncePhase(libre, vueHote(libre))).toBe("Partie en cours. 2 joueurs sur 3 ont fini");
  });

  it("les erreurs d'accès sont en français et la partie introuvable ne confirme rien d'autre", () => {
    expect(echecDepuisCode("NOT_FOUND")).toBe("introuvable");
    expect(echecDepuisCode("UNAUTHORIZED")).toBe("connexion");
    expect(echecDepuisCode("INTERNAL_SERVER_ERROR")).toBe("reseau");
    expect(messageEchec("introuvable").texte).toMatch(/autre animateur/);
    expect(messageEchec("introuvable").reessayer).toBe(false);
    expect(messageEchec("reseau").reessayer).toBe(true);
    expect(messageErreurServeur("save_failed")).toMatch(/enregistrée/);
    expect(messageErreurServeur("inconnue")).toBe("Une erreur est survenue. Réessaie.");
  });
});
