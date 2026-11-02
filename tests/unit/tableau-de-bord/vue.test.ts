import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TableauDeBordVue, type VueProps } from "../../../src/islands/tableau-de-bord/Vue";
import type { PartieJouee, QuizCarte } from "../../../src/islands/tableau-de-bord/logique";

const noop = () => {};

const pret: QuizCarte = {
  id: "q1",
  title: "Les héros de la foi",
  updatedAt: new Date("2026-11-08T10:00:00Z"),
  questionCount: 10,
  status: { ready: true, label: "Prêt à jouer", incompleteCount: 0 },
};
const brouillon: QuizCarte = {
  id: "q2",
  title: "Les paraboles",
  updatedAt: new Date("2026-11-01T10:00:00Z"),
  questionCount: 6,
  status: { ready: false, label: "Brouillon - 1 question à compléter", incompleteCount: 1 },
};
const partie: PartieJouee = { id: "s1", quizTitle: "Camp de Pâques", jouee: "2026-10-25T10:00:00Z", playerCount: 31 };

const modeles = [
  { id: "a", title: "Grandes figures", category: "Bible", questionCount: 7 },
  { id: "b", title: "La vie de Jésus", category: "Bible", questionCount: 8 },
  { id: "c", title: "De la création à l'Exode", category: "Bible", questionCount: 10 },
];

function vue(extra: Partial<VueProps> = {}): string {
  const props: VueProps = {
    utilisateur: { nom: "Sarah", email: "sarah@exemple.fr" },
    quiz: { etat: "pret", elements: [pret, brouillon] },
    parties: [partie],
    modeles,
    onglet: "quiz",
    onOnglet: noop,
    onReessayerQuiz: noop,
    onReessayerParties: noop,
    lancement: { enCours: null, erreur: null },
    onLancer: noop,
    onDupliquer: noop,
    suppression: { quiz: null, enCours: false, erreur: null },
    onDemanderSuppression: noop,
    onConfirmerSuppression: noop,
    onAnnulerSuppression: noop,
    demarrage: { modeleEnCours: null, erreur: null },
    onChoisirModele: noop,
    toast: null,
    onFermerToast: noop,
    ...extra,
  };
  return renderToStaticMarkup(createElement(TableauDeBordVue, props));
}

describe("tableau de bord : états", () => {
  it("liste : statut calculé, Lancer, menu Modifier / Dupliquer / Supprimer, MenuCompte", () => {
    const html = vue();
    expect(html).toContain("Mes quiz (2)");
    expect(html).toContain("Prêt à jouer");
    expect(html).toContain("Brouillon - 1 question à compléter");
    // Prêt : Lancer principal ; brouillon : Continuer principal et Lancer dans le menu.
    expect(html.match(/>Lancer</g)).toHaveLength(2);
    expect(html).toContain("Continuer");
    expect(html).toContain("Essayer comme un joueur");
    expect(html).toContain('href="/quiz/q1/apercu"');
    expect(html).not.toContain("Parties jouées (");
    expect(html).toContain('href="/quiz/q1"');
    expect(html).toContain("Dupliquer");
    expect(html).toContain("Supprimer");
    expect(html).toContain("Plus d&#x27;actions pour Les héros de la foi");
    expect(html).toContain("Menu du compte de Sarah");
    // MenuCompte poste par défaut vers la route serveur /deconnexion : plus de contournement JSON vers Better Auth.
    expect(html).toContain('action="/deconnexion"');
    expect(html).not.toContain("/api/auth/sign-out");
  });

  it("panneau d'onglet focalisable sans masquer l'anneau de focus global", () => {
    const html = vue();
    const panneau = html.match(/<div[^>]*role="tabpanel"[^>]*>/)?.[0] ?? "";
    expect(panneau).toContain('tabindex="0"');
    expect(panneau).not.toContain("outline-none");
  });

  it("création depuis un modèle en cours : boutons aria-disabled (focus conservé), pas disabled", () => {
    const html = vue({ quiz: { etat: "pret", elements: [] }, parties: [], demarrage: { modeleEnCours: "a", erreur: null } });
    const boutons = html.match(/<button[^>]*data-papier[^>]*>/g) ?? [];
    expect(boutons).toHaveLength(3);
    for (const bouton of boutons) {
      expect(bouton).toContain('aria-disabled="true"');
      expect(bouton).not.toMatch(/\sdisabled=/);
    }
    expect(html).toContain("Création en cours...");
  });

  it("rendu serveur : aucune date formatée (fuseau du navigateur inconnu), seulement des <time> masqués", () => {
    const html = vue();
    expect(html).not.toMatch(/nov\./);
    expect(html).not.toContain("modifié le");
    expect(html).toContain('<time dateTime="2026-11-08T10:00:00.000Z"></time>');
    expect(html).toMatch(/<span hidden="">[^<]*<time dateTime="2026-11-01T10:00:00.000Z"><\/time><\/span>/);
    const parties = vue({ onglet: "parties" });
    expect(parties).not.toMatch(/octobre|oct\./);
    expect(parties).toContain('<time dateTime="2026-10-25T10:00:00.000Z"');
    expect(parties).toContain('aria-label="Voir le bilan de Camp de Pâques"');
  });

  it("menu « … » : chaque bouton porte l'id de son quiz, cible du focus après duplication ou suppression", () => {
    const html = vue();
    expect(html).toContain('data-menu-quiz="q1"');
    expect(html).toContain('data-menu-quiz="q2"');
  });

  it("chargement : squelettes annoncés, aucune carte", () => {
    const html = vue({ quiz: { etat: "chargement" } });
    expect(html).toContain("Chargement de tes quiz");
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain(">Lancer<");
  });

  it("erreur : message et bouton Réessayer", () => {
    const html = vue({ quiz: { etat: "erreur", message: "Connexion impossible." } });
    expect(html).toContain('role="alert"');
    expect(html).toContain("Connexion impossible.");
    expect(html).toContain("Réessayer");
  });

  it("vide (k2) : Partir de zéro et les trois modèles, sans onglets", () => {
    const html = vue({ quiz: { etat: "pret", elements: [] }, parties: [] });
    expect(html).toContain("TON 1ER");
    expect(html).toContain("Partir de zéro");
    expect(html).toContain('href="/quiz/nouveau"');
    for (const modele of modeles) expect(html).toContain(modele.title.replace("'", "&#x27;"));
    expect(html).not.toContain('role="tablist"');
  });

  it("parties jouées : lien vers le bilan, nombre de joueurs, durée de conservation", () => {
    const html = vue({ onglet: "parties" });
    expect(html).toContain('href="/partie/s1/bilan"');
    expect(html).toContain("31 joueurs");
    expect(html).toContain("Camp de Pâques");
    expect(html).toContain("90 jours");
  });

  it("parties jouées vides : « Aucune partie jouée »", () => {
    const html = vue({ onglet: "parties", parties: [] });
    expect(html).toContain("Aucune partie jouée");
  });

  it("parties jouées en erreur : Réessayer", () => {
    const html = vue({ onglet: "parties", parties: null });
    expect(html).toContain("Parties indisponibles");
    expect(html).toContain("Réessayer");
  });

  it("lancement d'un quiz incomplet : message serveur et lien vers l'éditeur", () => {
    const html = vue({
      lancement: {
        enCours: null,
        erreur: { quizId: "q2", message: "Le quiz n'est pas prêt : la question 4 est à compléter.", incomplet: true },
      },
    });
    expect(html).toContain("la question 4 est à compléter.");
    expect(html).toContain("Compléter le quiz");
    expect(html).toContain('href="/quiz/q2"');
  });

  it("lancement bloqué par le quota : message sans lien vers l'éditeur", () => {
    const html = vue({
      lancement: { enCours: null, erreur: { quizId: "q1", message: "Trop de parties lancées en peu de temps.", incomplet: false } },
    });
    expect(html).toContain("Trop de parties lancées");
    expect(html).not.toContain("Compléter le quiz");
  });

  it("confirmation de suppression : titre du quiz et erreur éventuelle", () => {
    const html = vue({ suppression: { quiz: pret, enCours: false, erreur: "Quiz introuvable" } });
    expect(html).toContain("Supprimer ce quiz ?");
    expect(html).toContain("Les héros de la foi");
    expect(html).toContain("Cette action est définitive.");
    expect(html).toContain("Annuler");
    expect(html).toContain("Quiz introuvable");
  });

  it("erreur de duplication : annoncée par la région d'alerte", () => {
    const html = vue({ toast: { variante: "erreur", texte: "Duplication impossible." } });
    expect(html).toMatch(/role="alert"[^>]*>.*Duplication impossible\./s);
  });
});
