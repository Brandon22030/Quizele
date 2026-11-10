import {
  MAX_OPTIONS,
  MAX_QUESTIONS,
  MIN_OPTIONS,
  isQuestionComplete,
  questionSchema,
  quizStatus,
  type QuestionDuration,
  type QuestionType,
  type QuizStatus,
} from "../../shared/quiz-schema";

// Modèle local de l'éditeur : un brouillon immuable et des fonctions pures. Chaque fonction qui change le contenu marque ce
// qu'il faut envoyer au serveur dans `sale`, la file d'enregistrement n'a ensuite qu'à lire ces marques.

export const DUREE_PAR_DEFAUT: QuestionDuration = 20;
export const LIBELLE_VRAI = "Vrai";
export const LIBELLE_FAUX = "Faux";

export interface ReponseBrouillon {
  label: string;
  isCorrect: boolean;
}

export interface QuestionBrouillon {
  // Clé locale stable (l'identifiant serveur n'existe qu'après la première sauvegarde).
  key: string;
  id: string | null;
  type: QuestionType;
  prompt: string;
  durationSec: QuestionDuration;
  reference: string;
  explanation: string;
  options: ReponseBrouillon[];
}

export interface MarquesAEnvoyer {
  titre: boolean;
  ordre: boolean;
  // Clés des questions à créer ou à mettre à jour.
  questions: string[];
  // Identifiants serveur des questions à supprimer.
  supprimees: string[];
}

export interface Brouillon {
  quizId: string | null;
  title: string;
  questions: QuestionBrouillon[];
  sale: MarquesAEnvoyer;
}

export interface QuizServeur {
  id: string;
  title: string;
  questions: {
    id: string;
    position: number;
    type: QuestionType;
    prompt: string;
    durationSec: number;
    reference: string | null;
    explanation: string | null;
    options: { position: number; label: string; isCorrect: boolean }[];
  }[];
}

const aucuneMarque = (): MarquesAEnvoyer => ({ titre: false, ordre: false, questions: [], supprimees: [] });

let compteur = 0;
export function nouvelleCle(): string {
  compteur += 1;
  const hasard = globalThis.crypto?.randomUUID?.() ?? `${compteur}-${Math.random().toString(36).slice(2)}`;
  return `n-${hasard}`;
}

export function reponsesVides(nombre: number = MIN_OPTIONS): ReponseBrouillon[] {
  return Array.from({ length: nombre }, () => ({ label: "", isCorrect: false }));
}

export function nouvelleQuestion(): QuestionBrouillon {
  return {
    key: nouvelleCle(),
    id: null,
    type: "single",
    prompt: "",
    durationSec: DUREE_PAR_DEFAUT,
    reference: "",
    explanation: "",
    options: reponsesVides(),
  };
}

export function brouillonVierge(): Brouillon {
  const premiere = nouvelleQuestion();
  // La question 1 est marquée d'emblée : dès que le titre est saisi, le quiz et sa première question partent ensemble.
  return { quizId: null, title: "", questions: [premiere], sale: { ...aucuneMarque(), questions: [premiere.key] } };
}

export function brouillonDepuisServeur(quiz: QuizServeur): Brouillon {
  const questions = [...quiz.questions]
    .sort((a, b) => a.position - b.position)
    .map<QuestionBrouillon>((q) => ({
      key: q.id,
      id: q.id,
      type: q.type,
      prompt: q.prompt,
      durationSec: q.durationSec as QuestionDuration,
      reference: q.reference ?? "",
      explanation: q.explanation ?? "",
      options: [...q.options].sort((a, b) => a.position - b.position).map((o) => ({ label: o.label, isCorrect: o.isCorrect })),
    }));
  return { quizId: quiz.id, title: quiz.title, questions, sale: aucuneMarque() };
}

export function aDesMarques(b: Brouillon): boolean {
  const { sale } = b;
  return sale.titre || sale.ordre || sale.questions.length > 0 || sale.supprimees.length > 0;
}

function marquerQuestion(sale: MarquesAEnvoyer, key: string): MarquesAEnvoyer {
  return sale.questions.includes(key) ? sale : { ...sale, questions: [...sale.questions, key] };
}

function remplacer(b: Brouillon, key: string, fn: (q: QuestionBrouillon) => QuestionBrouillon): Brouillon {
  const courante = b.questions.find((q) => q.key === key);
  if (!courante) return b;
  const suivante = fn(courante);
  // Rien n'a changé (butée, type identique) : même brouillon, donc aucune marque ni enregistrement inutile.
  if (suivante === courante) return b;
  return { ...b, questions: b.questions.map((q) => (q === courante ? suivante : q)), sale: marquerQuestion(b.sale, key) };
}

export function changerTitre(b: Brouillon, title: string): Brouillon {
  return { ...b, title, sale: { ...b.sale, titre: true } };
}

export function majQuestion(b: Brouillon, key: string, patch: Partial<Pick<QuestionBrouillon, "prompt" | "durationSec" | "reference" | "explanation">>): Brouillon {
  return remplacer(b, key, (q) => ({ ...q, ...patch }));
}

export function changerLibelle(b: Brouillon, key: string, index: number, label: string): Brouillon {
  return remplacer(b, key, (q) => ({ ...q, options: q.options.map((o, i) => (i === index ? { ...o, label } : o)) }));
}

// Une seule bonne réponse possible pour « unique » et « vrai/faux » : cocher une réponse décoche les autres.
export function basculerJuste(b: Brouillon, key: string, index: number): Brouillon {
  return remplacer(b, key, (q) => {
    const cible = !q.options[index]?.isCorrect;
    const unique = q.type !== "multiple";
    return { ...q, options: q.options.map((o, i) => (i === index ? { ...o, isCorrect: cible } : unique && cible ? { ...o, isCorrect: false } : o)) };
  });
}

export function ajouterReponse(b: Brouillon, key: string): Brouillon {
  return remplacer(b, key, (q) => (q.type === "true_false" || q.options.length >= MAX_OPTIONS ? q : { ...q, options: [...q.options, { label: "", isCorrect: false }] }));
}

export function retirerReponse(b: Brouillon, key: string, index: number): Brouillon {
  return remplacer(b, key, (q) => (q.type === "true_false" || q.options.length <= MIN_OPTIONS ? q : { ...q, options: q.options.filter((_, i) => i !== index) }));
}

// La bascule ne produit jamais un état que le serveur refuserait : « unique » garde au plus une bonne réponse, « vrai/faux »
// est figé à deux réponses « Vrai » et « Faux ».
export function changerType(b: Brouillon, key: string, type: QuestionType): Brouillon {
  return remplacer(b, key, (q) => {
    if (q.type === type) return q;
    if (type === "true_false") {
      // Les anciens libellés n'ont plus de sens, la bonne réponse non plus : l'animateur la choisit.
      return { ...q, type, options: [{ label: LIBELLE_VRAI, isCorrect: false }, { label: LIBELLE_FAUX, isCorrect: false }] };
    }
    let options = q.options;
    if (q.type === "true_false") options = options.map((o) => ({ ...o, label: "" }));
    if (type === "single") {
      let trouvee = false;
      options = options.map((o) => {
        if (!o.isCorrect) return o;
        if (trouvee) return { ...o, isCorrect: false };
        trouvee = true;
        return o;
      });
    }
    return { ...q, type, options };
  });
}

export const AIDE_LIMITE_QUESTIONS = `Un quiz compte ${MAX_QUESTIONS} questions au plus.`;

export function peutAjouterQuestion(b: Brouillon): boolean {
  return b.questions.length < MAX_QUESTIONS;
}

export function ajouterQuestion(b: Brouillon, question: QuestionBrouillon = nouvelleQuestion()): Brouillon {
  if (!peutAjouterQuestion(b)) return b;
  return { ...b, questions: [...b.questions, question], sale: marquerQuestion(b.sale, question.key) };
}

export function dupliquerQuestion(b: Brouillon, key: string): Brouillon {
  const source = b.questions.find((q) => q.key === key);
  if (!source || !peutAjouterQuestion(b)) return b;
  const copie: QuestionBrouillon = { ...source, key: nouvelleCle(), id: null, options: source.options.map((o) => ({ ...o })) };
  // La copie se place juste après l'original ; le serveur ajoute en fin de liste, la file renverra l'ordre.
  const index = b.questions.findIndex((q) => q.key === key);
  const questions = [...b.questions.slice(0, index + 1), copie, ...b.questions.slice(index + 1)];
  return { ...b, questions, sale: { ...marquerQuestion(b.sale, copie.key), ordre: true } };
}

export function supprimerQuestion(b: Brouillon, key: string): Brouillon {
  const cible = b.questions.find((q) => q.key === key);
  if (!cible) return b;
  const sale: MarquesAEnvoyer = {
    ...b.sale,
    questions: b.sale.questions.filter((k) => k !== key),
    supprimees: cible.id ? [...b.sale.supprimees, cible.id] : b.sale.supprimees,
  };
  return { ...b, questions: b.questions.filter((q) => q.key !== key), sale };
}

export function ordonner(b: Brouillon, cles: readonly string[]): Brouillon {
  const parCle = new Map(b.questions.map((q) => [q.key, q]));
  const questions = cles.flatMap((k) => parCle.get(k) ?? []);
  if (questions.length !== b.questions.length) return b;
  if (questions.every((q, i) => q === b.questions[i])) return b;
  return { ...b, questions, sale: { ...b.sale, ordre: true } };
}

export interface ChargeQuestion {
  type: QuestionType;
  prompt: string;
  durationSec: QuestionDuration;
  reference?: string;
  explanation?: string;
  options: ReponseBrouillon[];
}

export function versCharge(q: QuestionBrouillon): ChargeQuestion {
  return {
    type: q.type,
    prompt: q.prompt,
    durationSec: q.durationSec,
    reference: q.reference,
    explanation: q.explanation,
    options: q.options.map((o) => ({ label: o.label, isCorrect: o.isCorrect })),
  };
}

export type Validation = { ok: true; question: ChargeQuestion } | { ok: false; message: string };

// Mêmes schémas que les Actions : une question refusée ici le serait aussi par le serveur, on évite l'aller-retour.
export function validerQuestion(q: QuestionBrouillon): Validation {
  const charge = versCharge(q);
  const resultat = questionSchema.safeParse(charge);
  if (resultat.success) return { ok: true, question: charge };
  return { ok: false, message: resultat.error.issues[0]?.message ?? "La question est invalide." };
}

export const LIBELLES_TYPE: Record<QuestionType, string> = {
  single: "Une bonne réponse",
  multiple: "Plusieurs bonnes",
  true_false: "Vrai ou faux",
};

export function estComplete(q: QuestionBrouillon): boolean {
  return isQuestionComplete(q);
}

// Ce qu'il reste à faire sur une question, dans l'ordre où l'animateur le fait naturellement.
export function problemeQuestion(q: QuestionBrouillon): string | null {
  if (isQuestionComplete(q)) return null;
  if (q.prompt.trim() === "") return "Écris la question";
  if (q.options.some((o) => o.label.trim() === "")) return "Remplis les réponses";
  return "Choisis la bonne réponse";
}

export function statutQuiz(b: Brouillon): QuizStatus {
  return quizStatus(b.questions.map((q) => ({ id: q.key, type: q.type, prompt: q.prompt, options: q.options })));
}

export function libelleQuestion(q: QuestionBrouillon): string {
  return `${LIBELLES_TYPE[q.type]} - ${q.durationSec} s`;
}
