import { describe, expect, it } from "vitest";
import {
  cleHote,
  descriptionModele,
  erreurLancement,
  libelleJoueurs,
  libelleQuestions,
  memoriserHote,
  titreOnglet,
  urlBilan,
  urlPilotage,
} from "../../../src/islands/tableau-de-bord/logique";

describe("tableau de bord : logique", () => {
  it("transmet le jeton hôte à la page de pilotage par sessionStorage, jamais par l'URL", () => {
    const ecrit = new Map<string, string>();
    memoriserHote({ setItem: (k, v) => void ecrit.set(k, v) }, { sessionId: "s1", code: "K7Q2M9", hostToken: "jeton" });
    expect(cleHote("s1")).toBe("quizdeszeles:hote:s1");
    expect(JSON.parse(ecrit.get("quizdeszeles:hote:s1") ?? "")).toEqual({ code: "K7Q2M9", hostToken: "jeton" });
    expect(urlPilotage("s1")).toBe("/partie/s1");
  });

  it("ne lève pas si le stockage refuse l'écriture", () => {
    const refus = {
      setItem: () => {
        throw new Error("QuotaExceeded");
      },
    };
    expect(() => memoriserHote(refus, { sessionId: "s1", code: "K7Q2M9", hostToken: "j" })).not.toThrow();
    expect(() => memoriserHote(null, { sessionId: "s1", code: "K7Q2M9", hostToken: "j" })).not.toThrow();
  });

  it("une erreur BAD_REQUEST de lancement renvoie à l'éditeur, les autres non", () => {
    expect(erreurLancement("q1", "BAD_REQUEST", "Le quiz n'est pas prêt").incomplet).toBe(true);
    expect(erreurLancement("q1", "TOO_MANY_REQUESTS", "Trop de parties").incomplet).toBe(false);
  });

  it("accorde les libellés", () => {
    expect(libelleQuestions(0)).toBe("Aucune question");
    expect(libelleQuestions(1)).toBe("1 question");
    expect(libelleQuestions(10)).toBe("10 questions");
    expect(libelleJoueurs(0)).toBe("Aucun joueur");
    expect(libelleJoueurs(1)).toBe("1 joueur");
    expect(libelleJoueurs(24)).toBe("24 joueurs");
    expect(titreOnglet("quiz", 3)).toBe("Mes quiz (3)");
    expect(titreOnglet("quiz", null)).toBe("Mes quiz");
    expect(descriptionModele({ id: "m", title: "t", category: "Bible", questionCount: 8 })).toBe("8 questions, Bible");
    expect(descriptionModele({ id: "m", title: "t", category: null, questionCount: 8 })).toBe("8 questions");
  });

  it("construit les liens vers le bilan et le pilotage", () => {
    expect(urlBilan("abc")).toBe("/partie/abc/bilan");
  });
});
