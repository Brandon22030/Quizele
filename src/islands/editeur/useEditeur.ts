import { useEffect, useState } from "react";
import { apiEditeur, chargerQuiz } from "./api";
import { ErreurApi, FileEnregistrement } from "./file-enregistrement";
import { aDesMarques, brouillonDepuisServeur, brouillonVierge, type Brouillon } from "./modele";
import { lireBrouillon, stockageNavigateur } from "./stockage";

export type Phase =
  | { nom: "chargement" }
  | { nom: "erreur"; message: string; code: string | null; reessayable: boolean }
  | { nom: "pret"; file: FileEnregistrement };

// Quiz à ouvrir : le serveur est la référence, sauf si des modifications attendent encore leur confirmation dans localStorage.
// Sans réseau, ces modifications suffisent à rouvrir l'éditeur.
async function ouvrir(quizId: string | null): Promise<{ brouillon: Brouillon; repris: boolean }> {
  const local = lireBrouillon(stockageNavigateur(), quizId);
  const aReprendre = local && aDesMarques(local) && local.quizId === quizId ? local : null;
  if (quizId === null) return aReprendre ? { brouillon: aReprendre, repris: true } : { brouillon: brouillonVierge(), repris: false };
  try {
    const quiz = await chargerQuiz(quizId);
    return aReprendre ? { brouillon: aReprendre, repris: true } : { brouillon: brouillonDepuisServeur(quiz), repris: false };
  } catch (erreur) {
    if (aReprendre && erreur instanceof ErreurApi && erreur.reseau) return { brouillon: aReprendre, repris: true };
    throw erreur;
  }
}

export function useEditeur(quizId: string | null): { phase: Phase; recharger: () => void } {
  const [phase, setPhase] = useState<Phase>({ nom: "chargement" });
  const [essai, setEssai] = useState(0);

  useEffect(() => {
    let annule = false;
    let file: FileEnregistrement | null = null;
    setPhase({ nom: "chargement" });
    ouvrir(quizId).then(
      ({ brouillon, repris }) => {
        if (annule) return;
        file = new FileEnregistrement({
          api: apiEditeur,
          stockage: stockageNavigateur(),
          brouillon,
          // /quiz/nouveau devient /quiz/<id> sans rechargement : un rechargement rouvre le quiz créé, pas un second brouillon.
          surCreation: (id) => window.history.replaceState(null, "", `/quiz/${id}`),
        });
        setPhase({ nom: "pret", file });
        // Le brouillon vierge est marqué à envoyer mais n'a rien à dire tant que l'animateur n'a pas écrit : seule une reprise démarre seule.
        if (repris) file.demarrer();
      },
      (erreur: unknown) => {
        if (annule) return;
        const e = erreur instanceof ErreurApi ? erreur : null;
        setPhase({
          nom: "erreur",
          message: e?.message ?? "Le quiz n'a pas pu s'ouvrir. Réessaie dans un instant.",
          code: e?.code ?? null,
          reessayable: e === null || e.reseau || e.code === "INTERNAL_SERVER_ERROR",
        });
      },
    );
    return () => {
      annule = true;
      file?.arreter();
    };
  }, [quizId, essai]);

  return { phase, recharger: () => setEssai((n) => n + 1) };
}
