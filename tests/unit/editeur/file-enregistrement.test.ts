import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DELAI_ENREGISTREMENT_MS, DELAI_REPRISE_MS, ErreurApi, FileEnregistrement, type EditeurApi } from "../../../src/islands/editeur/file-enregistrement";
import { aDesMarques, ajouterQuestion, basculerJuste, brouillonVierge, changerLibelle, changerTitre, dupliquerQuestion, majQuestion, nouvelleQuestion, ordonner, supprimerQuestion, type Brouillon } from "../../../src/islands/editeur/modele";
import { cleStockage, lireBrouillon, type Stockage } from "../../../src/islands/editeur/stockage";

function faussStockage(): Stockage & { donnees: Map<string, string> } {
  const donnees = new Map<string, string>();
  return {
    donnees,
    getItem: (c) => donnees.get(c) ?? null,
    setItem: (c, v) => void donnees.set(c, v),
    removeItem: (c) => void donnees.delete(c),
  };
}

function fausseApi() {
  let n = 0;
  const appels: string[] = [];
  const etat = { reseau: true };
  const garde = () => {
    if (!etat.reseau) throw new ErreurApi("Connexion perdue. Vérifie ton réseau puis réessaie.", { reseau: true });
  };
  const api: EditeurApi = {
    async creer(title) {
      garde();
      appels.push(`creer:${title}`);
      return { quizId: "quiz1" };
    },
    async majTitre(_q, title) {
      garde();
      appels.push(`titre:${title}`);
    },
    async ajouterQuestion(_q, question) {
      garde();
      n += 1;
      appels.push(`ajouter:${question.prompt}`);
      return { questionId: `srv${n}` };
    },
    async majQuestion(id, question) {
      garde();
      appels.push(`maj:${id}:${question.prompt}`);
    },
    async supprimerQuestion(id) {
      garde();
      appels.push(`suppr:${id}`);
    },
    async reordonner(_q, ids) {
      garde();
      appels.push(`ordre:${ids.join(",")}`);
    },
  };
  return { api, appels, etat };
}

const existant = (): Brouillon => ({
  quizId: "quiz1",
  title: "Les héros",
  questions: [{ key: "a", id: "a", type: "single", prompt: "Un", durationSec: 20, reference: "", explanation: "", options: [{ label: "x", isCorrect: true }, { label: "y", isCorrect: false }] }],
  sale: { titre: false, ordre: false, questions: [], supprimees: [] },
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("enregistrement automatique", () => {
  it("regroupe les frappes et n'envoie qu'après 800 ms de calme", async () => {
    const { api, appels } = fausseApi();
    const file = new FileEnregistrement({ api, stockage: null, brouillon: existant() });
    file.modifier((b) => majQuestion(b, "a", { prompt: "D" }));
    file.modifier((b) => majQuestion(b, "a", { prompt: "De" }));
    await vi.advanceTimersByTimeAsync(DELAI_ENREGISTREMENT_MS - 1);
    expect(appels).toEqual([]);
    expect(file.instantane().statut).toBe("en_cours");
    await vi.advanceTimersByTimeAsync(1);
    expect(appels).toEqual(["maj:a:De"]);
    expect(file.instantane().statut).toBe("enregistre");
  });

  it("garde la modification dans localStorage dès la frappe puis l'efface à la confirmation", async () => {
    const { api } = fausseApi();
    const stockage = faussStockage();
    const file = new FileEnregistrement({ api, stockage, brouillon: existant() });
    file.modifier((b) => majQuestion(b, "a", { prompt: "Brouillon" }));
    expect(lireBrouillon(stockage, "quiz1")?.questions[0].prompt).toBe("Brouillon");
    await vi.advanceTimersByTimeAsync(DELAI_ENREGISTREMENT_MS);
    expect(stockage.donnees.has(cleStockage("quiz1"))).toBe(false);
  });
});

describe("hors ligne puis reprise", () => {
  it("garde tout après un échec réseau, puis envoie au retour du réseau sans rien perdre", async () => {
    const { api, appels, etat } = fausseApi();
    const stockage = faussStockage();
    const file = new FileEnregistrement({ api, stockage, brouillon: existant() });
    etat.reseau = false;
    file.modifier((b) => majQuestion(b, "a", { prompt: "Écrit hors ligne" }));
    await vi.advanceTimersByTimeAsync(DELAI_ENREGISTREMENT_MS);
    expect(file.instantane().statut).toBe("echec");
    expect(file.instantane().horsLigne).toBe(true);
    expect(stockage.donnees.has(cleStockage("quiz1"))).toBe(true);

    // Deuxième modification pendant la panne : elle s'ajoute, la file reste cohérente.
    file.modifier((b) => changerLibelle(b, "a", 0, "Réponse hors ligne"));
    await vi.advanceTimersByTimeAsync(DELAI_ENREGISTREMENT_MS);
    expect(appels).toEqual([]);

    etat.reseau = true;
    await vi.advanceTimersByTimeAsync(DELAI_REPRISE_MS);
    expect(appels).toEqual(["maj:a:Écrit hors ligne"]);
    expect(file.instantane().statut).toBe("enregistre");
    expect(stockage.donnees.has(cleStockage("quiz1"))).toBe(false);
  });

  it("« Réessayer maintenant » relance sans attendre la reprise automatique", async () => {
    const { api, appels, etat } = fausseApi();
    const file = new FileEnregistrement({ api, stockage: null, brouillon: existant() });
    etat.reseau = false;
    file.modifier((b) => majQuestion(b, "a", { prompt: "X" }));
    await vi.advanceTimersByTimeAsync(DELAI_ENREGISTREMENT_MS);
    etat.reseau = true;
    expect(await file.relancer()).toBe(true);
    expect(appels).toEqual(["maj:a:X"]);
  });

  it("reprend au rechargement : un nouveau brouillon lu depuis localStorage repart tout seul", async () => {
    const { api, appels, etat } = fausseApi();
    const stockage = faussStockage();
    const avant = new FileEnregistrement({ api, stockage, brouillon: existant() });
    etat.reseau = false;
    avant.modifier((b) => majQuestion(b, "a", { prompt: "Avant la coupure" }));
    await vi.advanceTimersByTimeAsync(DELAI_ENREGISTREMENT_MS);
    avant.arreter();

    etat.reseau = true;
    const repris = lireBrouillon(stockage, "quiz1");
    expect(repris && aDesMarques(repris)).toBe(true);
    const apres = new FileEnregistrement({ api, stockage, brouillon: repris as Brouillon });
    apres.demarrer();
    await vi.advanceTimersByTimeAsync(0);
    expect(appels).toEqual(["maj:a:Avant la coupure"]);
    expect(apres.instantane().statut).toBe("enregistre");
    expect(stockage.donnees.size).toBe(0);
  });

  it("une erreur du serveur (pas le réseau) n'est pas relancée en boucle et garde le message en français", async () => {
    const { api, appels } = fausseApi();
    api.majQuestion = async () => {
      appels.push("maj");
      throw new ErreurApi("Cette question est introuvable.", { code: "NOT_FOUND" });
    };
    const file = new FileEnregistrement({ api, stockage: null, brouillon: existant() });
    file.modifier((b) => majQuestion(b, "a", { prompt: "X" }));
    await vi.advanceTimersByTimeAsync(DELAI_ENREGISTREMENT_MS + DELAI_REPRISE_MS * 3);
    expect(appels).toEqual(["maj"]);
    expect(file.instantane()).toMatchObject({ statut: "echec", message: "Cette question est introuvable.", horsLigne: false, code: "NOT_FOUND" });
  });
});

describe("création du quiz", () => {
  it("attend un titre, puis crée le quiz et la question 1 ensemble", async () => {
    const { api, appels } = fausseApi();
    const stockage = faussStockage();
    const surCreation = vi.fn();
    const file = new FileEnregistrement({ api, stockage, brouillon: brouillonVierge(), surCreation });
    const cle = file.instantane().brouillon.questions[0].key;

    file.modifier((b) => majQuestion(b, cle, { prompt: "Qui ?" }));
    await vi.advanceTimersByTimeAsync(DELAI_ENREGISTREMENT_MS);
    expect(appels).toEqual([]);
    expect(file.instantane()).toMatchObject({ statut: "attente", message: "Ajoute un titre pour enregistrer ton quiz." });
    expect(stockage.donnees.has(cleStockage(null))).toBe(true);

    file.modifier((b) => changerTitre(b, "  Les héros  "));
    await vi.advanceTimersByTimeAsync(DELAI_ENREGISTREMENT_MS);
    expect(appels).toEqual(["creer:Les héros", "ajouter:Qui ?"]);
    expect(surCreation).toHaveBeenCalledWith("quiz1");
    expect(file.instantane().brouillon.quizId).toBe("quiz1");
    expect(file.instantane().statut).toBe("enregistre");
    expect(stockage.donnees.size).toBe(0);
  });

  it("un titre vidé sur un quiz existant n'est pas envoyé et le dit", async () => {
    const { api, appels } = fausseApi();
    const file = new FileEnregistrement({ api, stockage: null, brouillon: existant() });
    file.modifier((b) => changerTitre(b, "   "));
    await vi.advanceTimersByTimeAsync(DELAI_ENREGISTREMENT_MS);
    expect(appels).toEqual([]);
    expect(file.instantane()).toMatchObject({ statut: "attente", message: "Le titre ne peut pas être vide." });
  });
});

describe("questions et ordre", () => {
  it("crée, met à jour et supprime dans le bon ordre, puis envoie l'ordre complet", async () => {
    const { api, appels } = fausseApi();
    const file = new FileEnregistrement({ api, stockage: null, brouillon: existant() });
    const nouvelle = nouvelleQuestion();
    file.modifier((b) => supprimerQuestion(ajouterQuestion(b, { ...nouvelle, prompt: "Deux" }), "a"));
    file.modifier((b) => ajouterQuestion(b, { ...nouvelleQuestion(), key: "n-3", prompt: "Trois" }));
    await vi.advanceTimersByTimeAsync(DELAI_ENREGISTREMENT_MS);
    expect(appels).toEqual(["suppr:a", "ajouter:Deux", "ajouter:Trois"]);
    expect(file.instantane().brouillon.questions.map((q) => q.id)).toEqual(["srv1", "srv2"]);

    file.modifier((b) => ordonner(b, ["n-3", nouvelle.key]));
    await vi.advanceTimersByTimeAsync(DELAI_ENREGISTREMENT_MS);
    expect(appels.at(-1)).toBe("ordre:srv2,srv1");
  });

  it("une copie insérée au milieu déclenche l'ordre une fois ses identifiants connus", async () => {
    const { api, appels } = fausseApi();
    const base = existant();
    const deux = { ...base.questions[0], key: "b", id: "b", prompt: "Deux" };
    const file = new FileEnregistrement({ api, stockage: null, brouillon: { ...base, questions: [base.questions[0], deux] } });
    file.modifier((b) => dupliquerQuestion(b, "a"));
    await vi.advanceTimersByTimeAsync(DELAI_ENREGISTREMENT_MS);
    expect(appels).toEqual(["ajouter:Un", "ordre:a,srv1,b"]);
  });

  it("une question dont la bonne réponse change pendant l'envoi est renvoyée avec la version récente", async () => {
    const { api, appels } = fausseApi();
    let liberer: () => void = () => {};
    const porte = new Promise<void>((r) => (liberer = r));
    const origine = api.majQuestion;
    api.majQuestion = async (id, q) => {
      appels.push(`debut:${q.options[0].isCorrect}`);
      await porte;
      return origine(id, q);
    };
    const file = new FileEnregistrement({ api, stockage: null, brouillon: existant() });
    file.modifier((b) => majQuestion(b, "a", { prompt: "V1" }));
    await vi.advanceTimersByTimeAsync(DELAI_ENREGISTREMENT_MS);
    file.modifier((b) => basculerJuste(b, "a", 0));
    liberer();
    await vi.advanceTimersByTimeAsync(DELAI_ENREGISTREMENT_MS);
    expect(appels.filter((a) => a.startsWith("debut"))).toEqual(["debut:true", "debut:false"]);
    expect(file.instantane().statut).toBe("enregistre");
  });
});
