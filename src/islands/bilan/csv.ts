import type { JoueurBilan } from "./logique";

const BOM = "﻿";
// Séparateur point-virgule et saut de ligne CRLF : ce qu'Excel attend dans une installation française.
const SEPARATEUR = ";";
const FIN_DE_LIGNE = "\r\n";

// Une cellule qui commence par l'un de ces caractères serait lue comme une formule par un tableur (injection CSV).
const DECLENCHEURS_FORMULE = /^[=+\-@\t\r]/;

export function neutraliserFormule(valeur: string): string {
  return DECLENCHEURS_FORMULE.test(valeur) ? `'${valeur}` : valeur;
}

export function echapperCellule(valeur: string): string {
  const sure = neutraliserFormule(valeur);
  return /[";\r\n]/.test(sure) ? `"${sure.replace(/"/g, '""')}"` : sure;
}

const secondes = (ms: number): string => (ms / 1000).toFixed(1).replace(".", ",");

export function construireCsv(joueurs: JoueurBilan[], total: number): string {
  const lignes: string[][] = [
    ["Rang", "Pseudo", "Score", "Questions", "Temps total (s)"],
    ...[...joueurs]
      .sort((a, b) => a.rank - b.rank)
      .map((j) => [String(j.rank), j.pseudo, String(j.score), String(total), secondes(j.totalTimeMs)]),
  ];
  return BOM + lignes.map((ligne) => ligne.map(echapperCellule).join(SEPARATEUR)).join(FIN_DE_LIGNE) + FIN_DE_LIGNE;
}

// Nom de fichier ASCII : les accents du titre sont retirés, le reste devient un tiret.
export function nomFichier(quizTitle: string, jouee: Date): string {
  const slug = quizTitle
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
  return `bilan-${slug || "partie"}-${jouee.toISOString().slice(0, 10)}.csv`;
}
