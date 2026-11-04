import { describe, expect, it } from "vitest";
import { construireCsv, echapperCellule, nomFichier } from "../../../src/islands/bilan/csv";
import { questionsARevoir, type JoueurBilan } from "../../../src/islands/bilan/logique";

const j = (rank: number, pseudo: string): JoueurBilan => ({ id: `j${rank}`, pseudo, score: 1, totalTimeMs: 1500, rank });

describe("CSV : pseudos hostiles (QA)", () => {
  it("neutralise chaque déclencheur de formule, y compris tabulation et retour chariot en tête", () => {
    for (const p of ["=1+1", "+1", "-1", "@SUM(A1)", "\t=1", "\r=1"]) {
      const cellule = echapperCellule(p);
      expect(cellule.replace(/^"/, "").startsWith("'")).toBe(true);
    }
  });

  it("neutralise aussi une formule précédée d'espaces, en gardant la valeur d'origine après l'apostrophe", () => {
    for (const p of [" =1+1", " @x", "  -2", "\u00a0+1", "\u3000=1"]) {
      expect(echapperCellule(p)).toBe(`'${p}`);
    }
    expect(echapperCellule("  Grâce")).toBe("  Grâce");
  });

  it("garde une ligne par joueur même avec guillemet, point-virgule et retour à la ligne", () => {
    const csv = construireCsv([j(1, 'a"b'), j(2, "c;d"), j(3, "e\nf"), j(4, "g\r\nh")], 3);
    // Un parseur CSV minimal : les cellules citées peuvent contenir ; et sauts de ligne.
    const lignes: string[][] = [];
    let ligne: string[] = [];
    let cellule = "";
    let cite = false;
    const corps = csv.slice(1);
    for (let i = 0; i < corps.length; i++) {
      const c = corps[i]!;
      if (cite) {
        if (c === '"' && corps[i + 1] === '"') {
          cellule += '"';
          i++;
        } else if (c === '"') cite = false;
        else cellule += c;
      } else if (c === '"') cite = true;
      else if (c === ";") {
        ligne.push(cellule);
        cellule = "";
      } else if (c === "\r" && corps[i + 1] === "\n") {
        ligne.push(cellule);
        lignes.push(ligne);
        ligne = [];
        cellule = "";
        i++;
      } else cellule += c;
    }
    expect(lignes).toHaveLength(5);
    expect(lignes.every((l) => l.length === 5)).toBe(true);
    expect(lignes.slice(1).map((l) => l[1])).toEqual(['a"b', "c;d", "e\nf", "g\r\nh"]);
  });

  it("une partie sans joueur ne produit que l'en-tête", () => {
    expect(construireCsv([], 0)).toBe("﻿Rang;Pseudo;Score;Questions;Temps total (s)\r\n");
  });

  it("trie les joueurs par rang serveur et formate le temps avec une virgule", () => {
    const csv = construireCsv([j(2, "B"), j(1, "A")], 2);
    expect(csv.split("\r\n").slice(1, 3)).toEqual(["1;A;1;2;1,5", "2;B;1;2;1,5"]);
  });

  it("nom de fichier : titre vide, emoji ou très long restent ASCII et bornés", () => {
    const d = new Date("2026-11-04T10:00:00Z");
    expect(nomFichier("🎉🎉", d)).toBe("bilan-partie-2026-11-04.csv");
    expect(nomFichier("é".repeat(500) + '"; rm -rf', d)).toMatch(/^bilan-[a-z0-9-]{1,50}-2026-11-04\.csv$/);
    expect(nomFichier('a"\r\nSet-Cookie: x', d)).not.toMatch(/["\r\n]/);
  });
});

describe("À revoir : cas limites (QA)", () => {
  it("tri strictement croissant, ex aequo par position, question sans réponse écartée", () => {
    const stats = [
      { position: 3, prompt: "c", correctLabels: ["x"], answerCount: 10, correctCount: 5 },
      { position: 1, prompt: "a", correctLabels: ["x"], answerCount: 10, correctCount: 1 },
      { position: 2, prompt: "b", correctLabels: ["x"], answerCount: 10, correctCount: 5 },
      { position: 4, prompt: "d", correctLabels: ["x"], answerCount: 0, correctCount: 0 },
      { position: 5, prompt: "e", correctLabels: ["x"], answerCount: 10, correctCount: 10 },
    ];
    expect(questionsARevoir(stats).map((q) => q.position)).toEqual([1, 2, 3]);
  });

  it("la référence blanche est absente ; 199 sur 200 reste à revoir, sans jamais s'afficher à 100 %", () => {
    const [q] = questionsARevoir([{ position: 1, prompt: "a", correctLabels: ["x"], answerCount: 10, correctCount: 9, reference: "   " }]);
    expect(q?.reference).toBeNull();
    expect(questionsARevoir([{ position: 1, prompt: "a", correctLabels: ["x"], answerCount: 200, correctCount: 199 }]).map((x) => x.taux)).toEqual([99]);
    expect(questionsARevoir([{ position: 1, prompt: "a", correctLabels: ["x"], answerCount: 200, correctCount: 200 }])).toEqual([]);
  });
});
