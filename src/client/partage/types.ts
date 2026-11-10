// Entrées des images de partage : uniquement ce que le joueur a déjà reçu dans le message de fin de partie.
// Aucun champ de bonne réponse, d'explication ou de statistique par question n'a sa place ici.

export type ShareFormat = "portrait" | "paysage";

export interface ShareRankingEntry {
  pseudo: string;
  score: number;
  // Rang attribué par le serveur : l'image ne le recalcule pas.
  rank: number;
  isYou?: boolean;
}

export interface ResultShareData {
  quizTitle: string;
  pseudo: string;
  score: number;
  total: number;
  rank: number;
  playerCount: number;
  /** Les 5 premiers du classement, dans l'ordre. Les entrées au-delà de 5 sont ignorées. */
  top: ShareRankingEntry[];
}

export interface LeaderboardShareData {
  quizTitle: string;
  total: number;
  playerCount: number;
  top: ShareRankingEntry[];
}

export type ShareResult =
  | { status: "shared" }
  | { status: "downloaded" }
  | { status: "cancelled" }
  | { status: "error"; message: string };

export interface ShareOptions {
  filename: string;
  title?: string;
  text?: string;
}
