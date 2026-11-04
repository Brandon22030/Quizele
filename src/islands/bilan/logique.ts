// Logique pure du bilan : aucune dépendance au serveur, pour servir la page, l'îlot et l'export.

export interface JoueurBilan {
  id: string;
  pseudo: string;
  score: number;
  totalTimeMs: number;
  /** Rang attribué par le serveur à la fin de la partie : jamais recalculé ici. */
  rank: number;
}

export interface StatQuestion {
  position: number;
  prompt: string;
  correctLabels: string[];
  reference?: string | null;
  answerCount: number;
  correctCount: number;
}

export interface QuestionARevoir {
  position: number;
  prompt: string;
  /** Pourcentage entier de bonnes réponses. */
  taux: number;
  bonneReponse: string;
  reference: string | null;
}

export interface DonneesBilan {
  sessionId: string;
  quizTitle: string;
  /** Date ISO de fin de partie (ou de création à défaut). */
  jouee: string;
  total: number;
  joueurs: JoueurBilan[];
  moyenne: number | null;
  aRevoir: QuestionARevoir[];
}

export type EtatBilan =
  | { etat: "chargement" }
  | { etat: "erreur"; message: string; reessayable: boolean }
  | { etat: "pret"; donnees: DonneesBilan };

export const MESSAGE_INTROUVABLE = "Ce bilan est introuvable. Il a peut-être été supprimé, car les bilans sont gardés 90 jours.";
export const MESSAGE_INDISPONIBLE = "Impossible de charger ce bilan pour le moment.";
export const MENTION_PURGE = "Ce bilan sera supprimé automatiquement 90 jours après la partie.";

export const urlRetour = "/tableau-de-bord?onglet=parties";
export const urlExport = (sessionId: string): string => `/partie/${encodeURIComponent(sessionId)}/export.csv`;

export function tauxReussite(stat: Pick<StatQuestion, "answerCount" | "correctCount">): number | null {
  if (stat.answerCount <= 0) return null;
  return Math.round((stat.correctCount / stat.answerCount) * 100);
}

// Une question sans réponse n'a pas de taux, une question réussie par tous n'a rien à revoir : les deux sont écartées.
export function questionsARevoir(stats: StatQuestion[]): QuestionARevoir[] {
  const lignes: QuestionARevoir[] = [];
  for (const stat of stats) {
    const taux = tauxReussite(stat);
    if (taux === null || taux >= 100) continue;
    lignes.push({
      position: stat.position,
      prompt: stat.prompt,
      taux,
      bonneReponse: stat.correctLabels.join(", "),
      reference: stat.reference?.trim() ? stat.reference : null,
    });
  }
  return lignes.sort((a, b) => a.taux - b.taux || a.position - b.position);
}

export function moyenneScores(joueurs: Pick<JoueurBilan, "score">[]): number | null {
  if (joueurs.length === 0) return null;
  return joueurs.reduce((somme, j) => somme + j.score, 0) / joueurs.length;
}

const formatNombre = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });
export const formaterMoyenne = (moyenne: number, total: number): string => `Moyenne ${formatNombre.format(moyenne)} / ${total}`;

export function libelleJoueurs(n: number): string {
  return `${n} ${n > 1 ? "joueurs" : "joueur"}`;
}

export function construireDonnees(
  session: { id: string; quizTitle: string; createdAt: Date; endedAt: Date | null },
  joueurs: JoueurBilan[],
  stats: StatQuestion[],
): DonneesBilan {
  const meilleurScore = joueurs.reduce((max, j) => Math.max(max, j.score), 0);
  return {
    sessionId: session.id,
    quizTitle: session.quizTitle,
    jouee: new Date(session.endedAt ?? session.createdAt).toISOString(),
    total: stats.length > 0 ? stats.length : meilleurScore,
    joueurs: [...joueurs].sort((a, b) => a.rank - b.rank),
    moyenne: moyenneScores(joueurs),
    aRevoir: questionsARevoir(stats),
  };
}

// Même principe que le tableau de bord : le fuseau est celui du navigateur, la date n'est formatée qu'après le montage.
export const dateJouee = (date: Date): string => new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long" }).format(date);

export const NOMBRE_PARTAGE = 5;
export const NOMBRE_LIGNES_VISIBLES = 10;
