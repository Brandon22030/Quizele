import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { construireCsv, echapperCellule, neutraliserFormule, nomFichier } from "../../../src/islands/bilan/csv";
import {
  construireDonnees,
  formaterMoyenne,
  moyenneScores,
  questionsARevoir,
  tauxReussite,
  type JoueurBilan,
  type StatQuestion,
} from "../../../src/islands/bilan/logique";
import { CarteARevoir } from "../../../src/islands/bilan/CarteARevoir";
import { VueBilan, VueChargement, VueEnCours, VueErreur } from "../../../src/islands/bilan/Vue";

const stat = (position: number, answerCount: number, correctCount: number, extra: Partial<StatQuestion> = {}): StatQuestion => ({
  position,
  prompt: `Question ${position}`,
  correctLabels: ["Six"],
  answerCount,
  correctCount,
  ...extra,
});

const joueur = (rank: number, pseudo: string, score: number, totalTimeMs = 9000): JoueurBilan => ({ id: `j${rank}`, pseudo, score, totalTimeMs, rank });

describe("taux et tri des questions à revoir", () => {
  it("arrondit le taux et ignore une question sans réponse", () => {
    expect(tauxReussite({ answerCount: 7, correctCount: 2 })).toBe(29);
    expect(tauxReussite({ answerCount: 0, correctCount: 0 })).toBeNull();
  });

  it("trie par taux croissant, puis par position, et écarte les questions réussies par tous", () => {
    const liste = questionsARevoir([stat(1, 10, 10), stat(2, 10, 8), stat(3, 10, 2), stat(4, 10, 8), stat(5, 0, 0)]);
    expect(liste.map((q) => [q.position, q.taux])).toEqual([
      [3, 20],
      [2, 80],
      [4, 80],
    ]);
  });

  it("joint les bonnes réponses et ne garde la référence que si elle existe", () => {
    const [a, b] = questionsARevoir([
      stat(1, 4, 1, { correctLabels: ["Six", "Sept"], reference: "Genèse 1 - 2:3" }),
      stat(2, 4, 2, { reference: "  " }),
    ]);
    expect(a).toMatchObject({ bonneReponse: "Six, Sept", reference: "Genèse 1 - 2:3" });
    expect(b!.reference).toBeNull();
  });
});

describe("construction des données", () => {
  const session = { id: "s1", quizTitle: "Les héros", createdAt: new Date(1000), endedAt: new Date(5000) };

  it("garde le rang du serveur et calcule moyenne et total", () => {
    const d = construireDonnees(session, [joueur(2, "B", 4), joueur(1, "A", 9)], [stat(1, 2, 1), stat(2, 2, 2)]);
    expect(d.joueurs.map((j) => j.rank)).toEqual([1, 2]);
    expect(d.total).toBe(2);
    expect(d.moyenne).toBe(6.5);
    expect(d.jouee).toBe(new Date(5000).toISOString());
  });

  it("retombe sur la date de création sans fin, et sans moyenne sans joueur", () => {
    const d = construireDonnees({ ...session, endedAt: null }, [], []);
    expect(d.jouee).toBe(new Date(1000).toISOString());
    expect(d.moyenne).toBeNull();
    expect(moyenneScores([])).toBeNull();
  });

  it("formate la moyenne en français", () => {
    expect(formaterMoyenne(6.4, 10)).toBe("Moyenne 6,4 / 10");
  });
});

describe("CSV", () => {
  it("préfixe d'une apostrophe les débuts de formule", () => {
    for (const v of ["=1+1", "+33", "-2", "@SOMME(A1)", "\tx"]) expect(neutraliserFormule(v)).toBe(`'${v}`);
    expect(neutraliserFormule("Grâce")).toBe("Grâce");
  });

  it("entoure de guillemets ce qui contient point-virgule, guillemet ou retour à la ligne", () => {
    expect(echapperCellule('Il dit "oui"')).toBe('"Il dit ""oui"""');
    expect(echapperCellule("a;b")).toBe('"a;b"');
    expect(echapperCellule("a\nb")).toBe('"a\nb"');
    expect(echapperCellule("=a;b")).toBe("\"'=a;b\"");
  });

  it("produit BOM, séparateur point-virgule, CRLF et accents", () => {
    const csv = construireCsv([joueur(2, "Noé", 3, 12500), joueur(1, "Grâce", 5, 9000)], 5);
    expect(csv.startsWith("﻿Rang;Pseudo;Score;Questions;Temps total (s)\r\n")).toBe(true);
    expect(csv).toContain("1;Grâce;5;5;9,0\r\n2;Noé;3;5;12,5\r\n");
  });

  it("construit un nom de fichier ASCII", () => {
    expect(nomFichier("Les héros de la foi !", new Date("2026-11-08T10:00:00Z"))).toBe("bilan-les-heros-de-la-foi-2026-11-08.csv");
    expect(nomFichier("???", new Date("2026-11-08T10:00:00Z"))).toBe("bilan-partie-2026-11-08.csv");
  });
});

describe("états de la vue", () => {
  const donnees = construireDonnees(
    { id: "s1", quizTitle: "Camp", createdAt: new Date(0), endedAt: new Date(0) },
    [joueur(1, "Grâce", 5), joueur(2, "Noé", 3)],
    [stat(1, 2, 1, { reference: "Genèse 1" })],
  );
  const rendu = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

  it("rend le chargement", () => {
    const html = rendu(createElement(VueChargement));
    expect(html).toContain("Chargement du bilan");
    expect(html).toContain('aria-busy="true"');
  });

  it("rend l'erreur avec ou sans nouvel essai", () => {
    expect(rendu(createElement(VueErreur, { message: "Introuvable" }))).not.toContain("Réessayer");
    expect(rendu(createElement(VueErreur, { message: "Panne", onRetry: () => {} }))).toContain("Réessayer");
  });

  it("rend l'état vide pour une partie sans joueur ni statistique", () => {
    const vide = { ...donnees, total: 0, joueurs: [], moyenne: null, aRevoir: [] };
    const html = rendu(createElement(VueBilan, { donnees: vide, image: "preparation", annonce: "", onPartager() {}, onReessayerImage() {} }));
    expect(html).toContain("Personne n&#x27;a joué cette partie");
    expect(html).not.toContain("Exporter");
  });

  it("nuance l'état vide quand des statistiques existent sans joueur (clôture de secours)", () => {
    const vide = { ...donnees, joueurs: [], moyenne: null, aRevoir: [] };
    const html = rendu(createElement(VueBilan, { donnees: vide, image: "preparation", annonce: "", onPartager() {}, onReessayerImage() {} }));
    expect(html).toContain("Aucun résultat enregistré pour cette partie");
    expect(html).not.toContain("Personne n&#x27;a joué");
  });

  it("rend l'erreur avec un titre de niveau 1 et la partie en cours avec le lien du pilotage", () => {
    expect(rendu(createElement(VueErreur, { message: "Panne" }))).toContain("<h1");
    const html = rendu(createElement(VueEnCours, { sessionId: "s1", quizTitle: "Camp" }));
    expect(html).toContain("Partie en cours");
    expect(html).toContain('href="/partie/s1"');
  });

  it("annonce le taux d'une carte d'un seul tenant pour les lecteurs d'écran", () => {
    const html = rendu(createElement(CarteARevoir, { question: { position: 1, prompt: "Q", taux: 33, bonneReponse: "Six", reference: null } }));
    expect(html).toContain("pour cent");
    expect(html).toContain("de bonnes réponses");
  });

  it("rend le bilan avec la mention de purge, l'export et les cartes", () => {
    const html = rendu(createElement(VueBilan, { donnees, image: "prete", annonce: "", onPartager() {}, onReessayerImage() {} }));
    expect(html).toContain("90 jours");
    expect(html).toContain("À revoir ensemble");
    expect(html).toContain("/partie/s1/export.csv");
    expect(html).toContain("Genèse 1");
  });
});
