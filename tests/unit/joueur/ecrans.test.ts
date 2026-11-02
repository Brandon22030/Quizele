import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { initialSessionState, sessionReducer, type SessionState } from "../../../src/client/realtime/session-state";
import { createQuestionClock } from "../../../src/shared/clock";
import type { ServerMessage } from "../../../src/shared/protocol";
import { VueJoueur, type ChoixLocal } from "../../../src/islands/joueur/EcranJoueur";

const CODE = "K7Q2M9";

const options = [
  { id: "o1", label: "Abraham" },
  { id: "o2", label: "Noé" },
  { id: "o3", label: "Moïse" },
];

const question = (extra: Partial<Extract<ServerMessage, { type: "question" }>> = {}): ServerMessage => ({
  type: "question",
  index: 2,
  total: 10,
  questionId: "q3",
  kind: "single",
  prompt: "Qui a construit l'arche ?",
  options,
  startedAt: 1_000,
  durationMs: 20_000,
  serverNow: 1_000,
  ...extra,
});

const snapshot = (extra: Partial<Extract<ServerMessage, { type: "snapshot" }>> = {}): ServerMessage => ({
  type: "snapshot",
  role: "player",
  phase: "lobby",
  serverNow: 1_000,
  title: "Les héros de la foi",
  playerCount: 1,
  mode: "together",
  me: { playerId: "p1", pseudo: "Grâce_22", answered: false },
  ...extra,
});

// Rejoue des messages de protocole simulés dans le vrai réducteur : l'écran reçoit exactement l'état de production.
function etat(messages: ServerMessage[], connection: SessionState["connection"] = "open"): SessionState {
  const base = sessionReducer(initialSessionState, { type: "connection", status: connection });
  return messages.reduce<SessionState>((s, message) => {
    const horloge =
      message.type === "question"
        ? createQuestionClock(message, () => 6_000)
        : message.type === "snapshot" && message.question
          ? createQuestionClock({ ...message.question, serverNow: message.serverNow }, () => 6_000)
          : null;
    return sessionReducer(s, { type: "message", message, clock: horloge });
  }, base);
}

function rendre(state: SessionState, opts: { choix?: ChoixLocal | null; total?: number } = {}): string {
  return renderToStaticMarkup(
    createElement(VueJoueur, { code: CODE, state, total: opts.total ?? 10, choixLocal: opts.choix ?? null, onAnswer: () => undefined, onNext: () => undefined }),
  );
}

const indices = [/JUSTE/, /PAS CETTE FOIS/i, /Pas cette fois/, /\bFaux\b/i, /Bonne réponse/, /Ta réponse</, /Explication/];

describe("chargement", () => {
  it("affiche un squelette occupé et la connexion en cours avant le premier instantané", () => {
    const html = rendre(etat([], "connecting"));
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Connexion…");
  });
});

describe("salle d'attente (c)", () => {
  it("vide : seul dans la partie", () => {
    const html = rendre(etat([snapshot()]));
    expect(html).toContain("EN ATTENTE");
    expect(html).toContain("Tu es le premier arrivé");
    expect(html).toContain("Grâce_22");
    expect(html).not.toContain("+ 1 autre");
  });

  it("avec d'autres joueurs : compteur et puce de reste", () => {
    const html = rendre(etat([snapshot({ playerCount: 4 })]));
    expect(html).not.toContain("premier arrivé");
    expect(html).toContain("+ 3 autres");
  });
});

describe("question (d)", () => {
  it("chrono, énoncé et tuiles avec lettres, sans aucun indice de correction", () => {
    const html = rendre(etat([snapshot({ phase: "question" }), question()]));
    expect(html).toContain('role="timer"');
    expect(html).toContain("Question 3 sur 10");
    expect(html).toContain("Qui a construit l&#x27;arche ?");
    expect(html).toContain("Abraham");
    expect(html).not.toContain("Réponse enregistrée");
    for (const indice of indices) expect(html).not.toMatch(indice);
  });

  it("choix multiple : validation explicite", () => {
    const html = rendre(etat([snapshot({ phase: "question" }), question({ kind: "multiple" })]));
    expect(html).toContain("Valider la sélection");
    expect(html).toContain("Plusieurs réponses sont justes");
  });

  it("réponse envoyée : « Réponse enregistrée » sans verdict ni score", () => {
    const messages: ServerMessage[] = [snapshot({ phase: "question" }), question(), { type: "answer_ack", questionId: "q3", duplicate: false, late: false }];
    const html = rendre(etat(messages), { choix: { questionId: "q3", optionIds: ["o2"] } });
    expect(html).toContain("Réponse enregistrée");
    expect(html).toContain("Noé");
    expect(html).not.toContain('role="timer"');
    expect(html).not.toMatch(/\d+ justes?/);
    for (const indice of [/JUSTE/, /PAS CETTE FOIS/i, /\bFaux\b/i, /Bonne réponse/, /Explication/]) expect(html).not.toMatch(indice);
  });

  it("reprise après coupure : l'instantané ramène la réponse déjà donnée", () => {
    const { type: _type, ...payload } = question() as Extract<ServerMessage, { type: "question" }>;
    const s = etat([
      snapshot({ phase: "question", question: payload, me: { playerId: "p1", pseudo: "Grâce_22", answered: true, answeredOptionIds: ["o3"] } }),
    ]);
    const html = rendre(s);
    expect(html).toContain("Réponse enregistrée");
    expect(html).toContain("Moïse");
  });
});

describe("correction (e1, e2)", () => {
  const base = [snapshot({ phase: "question" }), question()];

  it("e1 : JUSTE avec la bonne réponse, l'explication et la référence", () => {
    const s = etat([
      ...base,
      {
        type: "reveal",
        questionId: "q3",
        correctOptionIds: ["o2"],
        explanation: "Dieu demande à Noé de construire une arche.",
        reference: "Genèse 6:14-22",
        you: { wasCorrect: true, score: 3 },
      },
    ]);
    const html = rendre(s, { choix: { questionId: "q3", optionIds: ["o2"] } });
    expect(html).toContain("JUSTE !");
    expect(html).toContain("Bonne réponse");
    expect(html).toContain("Genèse 6:14-22");
    expect(html).toContain("Dieu demande à Noé");
    expect(html).not.toMatch(/\bFaux\b/i);
  });

  it("e2 : « Pas cette fois ! », sa réponse et la bonne, jamais « Faux »", () => {
    const s = etat([...base, { type: "reveal", questionId: "q3", correctOptionIds: ["o2"], you: { wasCorrect: false, score: 2 } }]);
    const html = rendre(s, { choix: { questionId: "q3", optionIds: ["o3"] } });
    expect(html).toMatch(/PAS CETTE FOIS/);
    expect(html).toContain("Ta réponse");
    expect(html).toContain("Bonne réponse");
    expect(html).not.toMatch(/\bFaux\b/i);
  });

  it("correction masquée : message reveal sans correction, aucun verdict ni score", () => {
    const s = etat([...base, { type: "reveal", questionId: "q3" }]);
    const html = rendre(s, { choix: { questionId: "q3", optionIds: ["o3"] } });
    expect(html).toContain("Réponse enregistrée");
    expect(html).toContain("La correction arrive à la fin de la partie");
    for (const indice of [/JUSTE/, /PAS CETTE FOIS/i, /Pas cette fois/, /\bFaux\b/i, /Bonne réponse/, /Explication/, /\d+ justes?/]) {
      expect(html).not.toMatch(indice);
    }
  });

  it("mode libre : bouton pour passer à la question suivante, « Voir mon résultat » sur la dernière", () => {
    const libre = (index: number) =>
      etat([
        snapshot({ phase: "question", mode: "own_pace" }),
        question({ index }),
        { type: "reveal", questionId: "q3", correctOptionIds: ["o1"], you: { wasCorrect: false, score: 0 } },
      ]);
    expect(rendre(libre(2))).toContain("Question suivante");
    expect(rendre(libre(9))).toContain("Voir mon résultat");
    expect(rendre(etat([...base, { type: "reveal", questionId: "q3", correctOptionIds: ["o1"], you: { wasCorrect: true, score: 1 } }]))).toContain("En attente de la question suivante");
  });
});

describe("aucune correction sans message reveal", () => {
  it("la phase question n'affiche rien de correctif, quel que soit le choix", () => {
    for (const ids of [["o1"], ["o2"], ["o3"]]) {
      const s = etat([snapshot({ phase: "question" }), question(), { type: "answer_ack", questionId: "q3", duplicate: false, late: false }]);
      const html = rendre(s, { choix: { questionId: "q3", optionIds: ids } });
      for (const indice of [/JUSTE/, /PAS CETTE FOIS/i, /\bFaux\b/i, /Bonne réponse/, /Explication/]) expect(html).not.toMatch(indice);
    }
  });
});

describe("résultat (f)", () => {
  it("rang, score, temps, podium et bouton de partage", () => {
    const s = etat([
      snapshot({ phase: "question" }),
      question(),
      {
        type: "finished",
        ranking: [
          { playerId: "p2", pseudo: "Esther.B", score: 9, totalMs: 100_000 },
          { playerId: "p3", pseudo: "David", score: 8, totalMs: 100_000 },
          { playerId: "p1", pseudo: "Grâce_22", score: 7, totalMs: 252_000 },
          { playerId: "p4", pseudo: "Ruth", score: 6, totalMs: 90_000 },
        ],
        you: { rank: 3, score: 7, totalMs: 252_000 },
      },
    ]);
    const html = rendre(s);
    expect(html).toContain("Résultat final");
    expect(html).toContain("Rang : 3 / 4");
    expect(html).toContain("4 min 12 s");
    expect(html).toContain("Grâce_22 (toi)");
    expect(html).toContain("Ruth");
    expect(html).toContain("Partager mon score");
  });
});

describe("connexion et fins de partie", () => {
  const enCours = [snapshot({ phase: "question" }), question()];

  it("coupure : bandeau de reconnexion visible, l'écran en cours reste affiché", () => {
    const s = sessionReducer(etat(enCours), { type: "connection", status: "reconnecting" });
    const html = rendre(s);
    expect(html).toContain("Connexion perdue, reprise en cours…");
    expect(html).toContain("Abraham");
  });

  it("connexion ouverte : aucun bandeau", () => {
    expect(rendre(etat(enCours))).not.toContain("Connexion perdue");
  });

  it.each([
    ["kicked", "Tu as été retiré de la partie", "/"],
    ["ended", "Partie terminée", "/"],
    ["rejected", "Lien invalide", `/j/${CODE}`],
  ] as const)("terminal %s", (status, titre, lien) => {
    const html = rendre(sessionReducer(etat(enCours), { type: "connection", status }));
    expect(html).toContain(titre);
    expect(html).toContain(`href="${lien}"`);
    expect(html).not.toContain("Abraham");
  });

  it("partie terminée après réception du résultat : le résultat reste affiché", () => {
    const fin = etat([
      ...enCours,
      { type: "finished", ranking: [{ playerId: "p1", pseudo: "Grâce_22", score: 1, totalMs: 1000 }], you: { rank: 1, score: 1, totalMs: 1000 } },
    ]);
    const html = rendre(sessionReducer(fin, { type: "connection", status: "ended" }));
    expect(html).toContain("Résultat final");
  });
});
