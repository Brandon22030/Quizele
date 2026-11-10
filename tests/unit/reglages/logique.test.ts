import { describe, expect, it } from "vitest";
import { ANNONCE_INITIALE, annoncerStatut, creerFileEnregistrement, envoyerALaSortie, libelleStatut, type PatchReglages, type StatutEnregistrement } from "../../../src/islands/reglages/logique";

function banc(reponses: Array<string | null | "lance">) {
  const envois: PatchReglages[] = [];
  const statuts: StatutEnregistrement[] = [];
  const liberations: Array<() => void> = [];
  const file = creerFileEnregistrement(
    (patch) => {
      envois.push(patch);
      const suivante = reponses.shift() ?? null;
      if (suivante === "lance") return Promise.reject(new Error("réseau"));
      return new Promise((resolve) => liberations.push(() => resolve(suivante)));
    },
    (statut) => statuts.push(statut),
  );
  const terminer = async () => {
    liberations.shift()?.();
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  };
  return { file, envois, statuts, terminer };
}

describe("file d'enregistrement des réglages", () => {
  it("envoie un changement puis passe à Enregistré", async () => {
    const { file, envois, statuts, terminer } = banc([null]);
    file.pousser({ shuffle: true });
    expect(envois).toEqual([{ shuffle: true }]);
    expect(statuts.at(-1)).toEqual({ etat: "enregistrement" });
    await terminer();
    expect(statuts.at(-1)).toEqual({ etat: "enregistre" });
  });

  it("fusionne les changements faits pendant un envoi, le dernier gagnant, sans envois parallèles", async () => {
    const { file, envois, terminer } = banc([null, null]);
    file.pousser({ shuffle: true });
    file.pousser({ mode: "own_pace" });
    file.pousser({ shuffle: false });
    expect(envois).toHaveLength(1);
    await terminer();
    expect(envois).toEqual([{ shuffle: true }, { mode: "own_pace", shuffle: false }]);
  });

  it("échec : message conservé, nouvelle tentative avec la même valeur", async () => {
    const { file, envois, statuts, terminer } = banc(["Une erreur est survenue.", null]);
    file.pousser({ category: "Bible" });
    await terminer();
    expect(statuts.at(-1)).toEqual({ etat: "echec", message: "Une erreur est survenue." });
    expect(file.enEchec()).toBe(true);
    file.reessayer();
    expect(envois.at(-1)).toEqual({ category: "Bible" });
    await terminer();
    expect(statuts.at(-1)).toEqual({ etat: "enregistre" });
    expect(file.enEchec()).toBe(false);
  });

  it("une exception réseau devient un échec affichable", async () => {
    const { file, statuts } = banc(["lance"]);
    file.pousser({ shuffle: true });
    await new Promise((r) => setTimeout(r, 0));
    expect(statuts.at(-1)).toMatchObject({ etat: "echec", message: expect.stringContaining("Connexion impossible") });
  });

  it("une valeur plus récente prime sur celle qui a échoué", async () => {
    const { file, envois, terminer } = banc(["x", null]);
    file.pousser({ category: "ancienne" });
    file.pousser({ category: "récente", shuffle: true });
    await terminer();
    file.reessayer();
    expect(envois.at(-1)).toEqual({ category: "récente", shuffle: true });
  });

  it("attendre résout une fois la file vidée", async () => {
    const { file, terminer } = banc([null]);
    file.pousser({ shuffle: true });
    let fini = false;
    void file.attendre().then(() => (fini = true));
    await Promise.resolve();
    expect(fini).toBe(false);
    await terminer();
    expect(fini).toBe(true);
  });

  it("libellés de statut", () => {
    expect(libelleStatut({ etat: "repos" })).toBe("");
    expect(libelleStatut({ etat: "enregistre" })).toBe("Enregistré");
    expect(libelleStatut({ etat: "enregistrement" })).toBe("Enregistrement…");
    expect(libelleStatut({ etat: "echec", message: "m" })).toBe("Non enregistré");
  });
});

describe("annonces de statut", () => {
  it("n'annonce ni l'enregistrement en cours ni un succès ordinaire", () => {
    expect(annoncerStatut(ANNONCE_INITIALE, { etat: "enregistrement" })).toBe(ANNONCE_INITIALE);
    expect(annoncerStatut(ANNONCE_INITIALE, { etat: "enregistre" })).toBe(ANNONCE_INITIALE);
  });

  it("annonce un échec une fois, puis le retour à la normale", () => {
    const echec = annoncerStatut(ANNONCE_INITIALE, { etat: "echec", message: "m" });
    expect(echec.texte).toBe("Non enregistré");
    expect(annoncerStatut(echec, { etat: "echec", message: "m" })).toBe(echec);
    expect(annoncerStatut(echec, { etat: "enregistre" }).texte).toBe("Enregistré");
  });
});

describe("envoi à la fermeture de la page", () => {
  it("POST JSON keepalive sur l'endpoint de l'action, avec le quizId", () => {
    const appels: Array<[string, RequestInit]> = [];
    const faux = ((url: string, init: RequestInit) => {
      appels.push([url, init]);
      return Promise.resolve(new Response());
    }) as unknown as typeof fetch;
    envoyerALaSortie("q1", { category: "Bible" }, faux);
    expect(appels).toHaveLength(1);
    expect(appels[0]![0]).toBe("/_actions/quiz.majReglages");
    expect(appels[0]![1]).toMatchObject({ method: "POST", keepalive: true, headers: { "Content-Type": "application/json" } });
    expect(JSON.parse(appels[0]![1].body as string)).toEqual({ quizId: "q1", category: "Bible" });
  });

  it("n'envoie rien sans saisie en attente", () => {
    let appele = false;
    envoyerALaSortie("q1", {}, (() => ((appele = true), Promise.resolve(new Response()))) as unknown as typeof fetch);
    expect(appele).toBe(false);
  });
});
