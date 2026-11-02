import { useEffect, useState } from "react";
import { apiEditeur, chargerQuiz } from "./api";
import { AVIS_AUTRE_ONGLET, ErreurApi, FileEnregistrement } from "./file-enregistrement";
import { aDesMarques, brouillonDepuisServeur, brouillonVierge, type Brouillon } from "./modele";
import { canalNavigateur, detenirSession, ecouterEcritures, nouvelIdentifiant, sessionLibre, signalerEcriture, type Canal } from "./onglets";
import { brouillonsNouveaux, lireBrouillon, stockageNavigateur } from "./stockage";

export type Phase =
  | { nom: "chargement" }
  | { nom: "erreur"; message: string; code: string | null; reessayable: boolean }
  | { nom: "pret"; file: FileEnregistrement };

interface Ouverture {
  brouillon: Brouillon;
  repris: boolean;
  session: string | null;
}

// Nouveau quiz : reprend le brouillon le plus récent qu'aucun autre onglet ouvert ne détient. Un brouillon détenu ailleurs
// reste à son onglet ; celui-ci repart d'une page vierge, sous sa propre session.
async function ouvrirNouveau(canal: Canal | null, onglet: string): Promise<Ouverture> {
  for (const entree of brouillonsNouveaux(stockageNavigateur())) {
    if (!aDesMarques(entree.brouillon)) continue;
    if (await sessionLibre(canal, entree.session, onglet)) return { brouillon: entree.brouillon, repris: true, session: entree.session };
  }
  return { brouillon: brouillonVierge(), repris: false, session: nouvelIdentifiant() };
}

// Quiz à ouvrir : le serveur est la référence, sauf si des modifications attendent encore leur confirmation dans localStorage.
// Sans réseau, ces modifications suffisent à rouvrir l'éditeur.
async function ouvrir(quizId: string | null, canal: Canal | null, onglet: string): Promise<Ouverture> {
  if (quizId === null) return ouvrirNouveau(canal, onglet);
  const local = lireBrouillon(stockageNavigateur(), quizId);
  const aReprendre = local && aDesMarques(local) && local.quizId === quizId ? local : null;
  try {
    const quiz = await chargerQuiz(quizId);
    return aReprendre ? { brouillon: aReprendre, repris: true, session: null } : { brouillon: brouillonDepuisServeur(quiz), repris: false, session: null };
  } catch (erreur) {
    if (aReprendre && erreur instanceof ErreurApi && erreur.reseau) return { brouillon: aReprendre, repris: true, session: null };
    throw erreur;
  }
}

export function useEditeur(quizId: string | null): { phase: Phase; recharger: () => void } {
  const [phase, setPhase] = useState<Phase>({ nom: "chargement" });
  const [essai, setEssai] = useState(0);

  useEffect(() => {
    let annule = false;
    let file: FileEnregistrement | null = null;
    let liberer = () => {};
    let ignorer = () => {};
    const canal = canalNavigateur();
    const onglet = nouvelIdentifiant();
    setPhase({ nom: "chargement" });
    ouvrir(quizId, canal, onglet).then(
      ({ brouillon, repris, session }) => {
        if (annule) return;
        // Dès la décision prise : un onglet qui s'ouvre maintenant doit apprendre que ce brouillon est déjà repris.
        if (session) liberer = detenirSession(canal, session);
        file = new FileEnregistrement({
          api: apiEditeur,
          stockage: stockageNavigateur(),
          brouillon,
          session,
          // /quiz/nouveau devient /quiz/<id> sans rechargement : un rechargement rouvre le quiz créé, pas un second brouillon.
          surCreation: (id) => window.history.replaceState(null, "", `/quiz/${id}`),
          surEcriture: () => {
            const id = file?.instantane().brouillon.quizId;
            if (id) signalerEcriture(canal, id, onglet);
          },
        });
        const courante = file;
        ignorer = ecouterEcritures(canal, onglet, () => courante.instantane().brouillon.quizId, () =>
          courante.signaler({ message: AVIS_AUTRE_ONGLET, recharger: true }),
        );
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
      liberer();
      ignorer();
      canal?.fermer();
    };
  }, [quizId, essai]);

  return { phase, recharger: () => setEssai((n) => n + 1) };
}
