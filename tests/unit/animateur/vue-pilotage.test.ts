import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SessionState } from "../../../src/client/realtime/session-state";
import { ChargementPilotage, EchecPilotage, VuePilotage } from "../../../src/islands/animateur/VuePilotage";
import { VueProjection } from "../../../src/islands/animateur/VueProjection";
import { CODE, etat, instantane, question, revelation } from "./aide";

const rien = () => undefined;

function pilotage(state: SessionState): string {
  return renderToStaticMarkup(
    createElement(VuePilotage, { sessionId: "s1", code: CODE, state, onDemarrer: rien, onReveler: rien, onSuivante: rien, onTerminer: rien, onRetirer: rien, onProjeter: rien }),
  );
}

// Attribut disabled du bouton dont le libellé est donné (React rend `disabled=""`).
function desactive(html: string, libelle: string): boolean {
  const bouton = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].find(([, , contenu]) => contenu.replace(/<[^>]*>/g, "").trim() === libelle);
  if (!bouton) throw new Error(`bouton introuvable : ${libelle}`);
  return /\bdisabled=""/.test(bouton[1]!);
}

describe("chargement", () => {
  it("squelette occupé pendant la connexion au Durable Object", () => {
    const html = renderToStaticMarkup(createElement(ChargementPilotage));
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Connexion à la partie");
  });

  it("avant le premier instantané, la vue de pilotage affiche le chargement", () => {
    expect(pilotage(etat([], "connecting"))).toContain('aria-busy="true"');
  });
});

describe("salle (g)", () => {
  it("vide : « Personne n'est encore là », code en clair, lancement possible", () => {
    const html = pilotage(etat([instantane()]));
    expect(html).toContain("Personne n&#x27;est encore là");
    expect(html).toContain(CODE);
    expect(html).toContain("Participants (0)");
    expect(desactive(html, "Lancer la première question")).toBe(false);
  });

  it("liste les joueurs, chacun avec un retrait nommé", () => {
    const html = pilotage(etat([instantane({ playerCount: 2, players: [{ id: "p1", pseudo: "Esther.B" }, { id: "p2", pseudo: "Grâce_22" }] })]));
    expect(html).toContain("Participants (2)");
    expect(html).toContain('aria-label="Retirer Esther.B"');
    expect(html).toContain('aria-label="Retirer Grâce_22"');
  });

  it("garde le bouton Projeter et le jeton hôte hors du HTML", () => {
    const html = pilotage(etat([instantane()]));
    expect(html).toContain("Projeter");
    expect(html).not.toMatch(/hostToken|token/i);
  });
});

describe("télécommande (k8)", () => {
  it("question : révéler actif, suivante inactive, jauge des réponses reçues", () => {
    const html = pilotage(etat([instantane({ playerCount: 24 }), question(), { type: "answer_count", questionId: "q3", count: 18, total: 24 }]));
    expect(html).toContain("Question 3 sur 10");
    expect(html).toContain('aria-valuenow="18"');
    expect(html).toContain('aria-valuemax="24"');
    expect(desactive(html, "Révéler la réponse")).toBe(false);
    expect(desactive(html, "Question suivante")).toBe(true);
    expect(desactive(html, "Terminer et afficher les résultats")).toBe(false);
  });

  it("correction : bonne réponse visible par l'animateur, suivante active, révéler inactif", () => {
    const html = pilotage(etat([instantane(), question(), revelation]));
    expect(html).toContain("B. Noé");
    expect(desactive(html, "Révéler la réponse")).toBe(true);
    expect(desactive(html, "Question suivante")).toBe(false);
  });

  it("hors connexion, toutes les commandes sont inactives", () => {
    const html = pilotage(etat([instantane(), question()], "reconnecting"));
    expect(html).toContain("Connexion perdue, reprise en cours");
    expect(desactive(html, "Révéler la réponse")).toBe(true);
    expect(desactive(html, "Terminer et afficher les résultats")).toBe(true);
  });

  it("mode libre : « Terminer la partie » toujours visible avec le nombre de joueurs ayant fini", () => {
    const html = pilotage(etat([instantane({ phase: "running", mode: "own_pace", playerCount: 5, finishedCount: 2 })]));
    expect(html).toContain("2 joueurs sur 5 ont fini");
    expect(desactive(html, "Terminer la partie")).toBe(false);
    expect(html).not.toContain("Révéler la réponse");
    const salle = pilotage(etat([instantane({ mode: "own_pace" })]));
    expect(desactive(salle, "Terminer la partie")).toBe(false);
    expect(desactive(salle, "Lancer la partie")).toBe(false);
  });

  it("erreur du serveur : message en français", () => {
    const html = pilotage(etat([instantane(), { type: "error", code: "save_failed" }]));
    expect(html).toContain("La partie n&#x27;a pas pu être enregistrée");
  });
});

describe("fin de partie", () => {
  it("classement et lien vers le bilan", () => {
    const html = pilotage(
      etat([
        instantane({ phase: "finished", total: 10, ranking: [{ playerId: "p1", pseudo: "Esther.B", score: 7, totalMs: 9_000, rank: 1 }] }),
      ]),
    );
    expect(html).toContain("Partie terminée");
    expect(html).toContain('href="/partie/s1/bilan"');
    expect(html).not.toContain("Révéler la réponse");
  });
});

describe("erreurs d'accès", () => {
  it("partie introuvable : message sans nouvelle tentative", () => {
    const html = renderToStaticMarkup(createElement(EchecPilotage, { echec: "introuvable", onReessayer: rien }));
    expect(html).toContain("Partie introuvable");
    expect(html).toContain("autre animateur");
    expect(html).not.toContain("Réessayer");
  });

  it("connexion réseau perdue : reprise proposée", () => {
    const html = renderToStaticMarkup(createElement(EchecPilotage, { echec: "reseau", onReessayer: rien }));
    expect(html).toContain("Réessayer");
  });
});

describe("projection (i)", () => {
  const projeter = (state: SessionState) =>
    renderToStaticMarkup(createElement(VueProjection, { state, code: CODE, origine: "http://localhost:4760", onFermer: rien }));

  it("salle : fond forêt, code en très grand, aucun bouton de pilotage", () => {
    const html = projeter(etat([instantane({ playerCount: 1, players: [{ id: "p1", pseudo: "Esther.B" }] })], "open"));
    expect(html).toContain('data-theme="foret"');
    expect(html).toContain("lg:text-7xl");
    expect(html).toContain("Va sur localhost:4760 et tape");
    expect(html).toContain("Esther.B");
    expect(html).not.toContain("Révéler");
    expect(html).not.toContain("Lancer");
    expect(html).toContain("Quitter la projection");
  });

  it("question puis correction avec classement", () => {
    const q = projeter(etat([instantane({ playerCount: 3 }), question()]));
    expect(q).toContain("Qui a construit l&#x27;arche ?");
    expect(q).toContain('role="timer"');
    const c = projeter(etat([instantane(), question(), revelation]));
    expect(c).toContain("Bonne réponse");
    expect(c).toContain("Esther.B");
    expect(c).not.toContain("Révéler");
  });

  it("correction masquée pour le rôle écran : aucune bonne réponse affichée", () => {
    const c = projeter(etat([instantane({ role: "screen" }), question(), { type: "reveal", questionId: "q3" }]));
    expect(c).toContain("La bonne réponse n&#x27;est pas montrée");
    expect(c).not.toContain("Bonne réponse<");
  });

  it("chargement et jeton refusé", () => {
    expect(projeter(etat([], "connecting"))).toContain('aria-busy="true"');
    expect(projeter(etat([], "rejected"))).toContain("Projection impossible");
  });
});
