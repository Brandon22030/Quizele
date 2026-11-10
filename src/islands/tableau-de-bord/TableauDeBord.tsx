import { useEffect, useRef, useState } from "react";
import { actions } from "astro:actions";
import {
  erreurLancement,
  memoriserHote,
  urlEditeur,
  urlPilotage,
  type EtatListe,
  type ErreurLancement,
  type ModeleCarte,
  type OngletId,
  type PartieJouee,
  type QuizCarte,
} from "./logique";
import { TableauDeBordVue, type MessageToast, type Utilisateur } from "./Vue";

interface TableauDeBordProps {
  utilisateur: Utilisateur;
  /** Lue par la page serveur : la liste s'affiche dès le premier rendu, sans squelette ni aller-retour. */
  quizInitial: EtatListe<QuizCarte>;
  parties: PartieJouee[] | null;
  modeles: ModeleCarte[];
}

const MESSAGE_RESEAU = "Connexion impossible. Vérifie ta connexion puis réessaie.";

const selecteurMenu = (quizId: string) => `[data-menu-quiz="${CSS.escape(quizId)}"]`;

export default function TableauDeBord({ utilisateur, quizInitial, parties, modeles }: TableauDeBordProps) {
  const [quiz, setQuiz] = useState<EtatListe<QuizCarte>>(quizInitial);
  const [onglet, setOnglet] = useState<OngletId>("quiz");
  const [lancementEnCours, setLancementEnCours] = useState<string | null>(null);
  const [erreurLance, setErreurLance] = useState<ErreurLancement | null>(null);
  const [aSupprimer, setASupprimer] = useState<QuizCarte | null>(null);
  const [suppressionEnCours, setSuppressionEnCours] = useState(false);
  const [erreurSuppression, setErreurSuppression] = useState<string | null>(null);
  const [modeleEnCours, setModeleEnCours] = useState<string | null>(null);
  const [erreurModele, setErreurModele] = useState<string | null>(null);
  const [toast, setToast] = useState<MessageToast | null>(null);
  // Évite qu'une réponse tardive d'un ancien chargement écrase le résultat d'un plus récent.
  const generation = useRef(0);
  // Cibles du focus après un ajout ou un retrait de carte, essayées dans l'ordre une fois la liste rendue.
  const focusApresRendu = useRef<string[] | null>(null);
  const [demandeFocus, setDemandeFocus] = useState(0);

  // L'effet du parent passe après ceux des enfants : la modale est déjà fermée (et a rendu son focus) quand il s'exécute.
  useEffect(() => {
    const selecteurs = focusApresRendu.current;
    if (!selecteurs) return;
    focusApresRendu.current = null;
    for (const selecteur of selecteurs) {
      const cible = document.querySelector<HTMLElement>(selecteur);
      if (cible) {
        cible.focus();
        return;
      }
    }
  }, [demandeFocus]);

  function focaliserApresRendu(selecteurs: string[]) {
    focusApresRendu.current = selecteurs;
    setDemandeFocus((n) => n + 1);
  }

  // silencieux : la liste reste affichée pendant l'actualisation, pour que le focus ne soit pas perdu dans un squelette.
  async function charger({ silencieux = false } = {}): Promise<boolean> {
    const courante = ++generation.current;
    if (!silencieux) setQuiz({ etat: "chargement" });
    try {
      const { data, error } = await actions.quiz.lister();
      if (courante !== generation.current) return false;
      setQuiz(error ? { etat: "erreur", message: error.message } : { etat: "pret", elements: data.quizzes });
      return !error;
    } catch {
      if (courante === generation.current) setQuiz({ etat: "erreur", message: MESSAGE_RESEAU });
      return false;
    }
  }

  async function lancer(quizId: string) {
    if (lancementEnCours) return;
    setLancementEnCours(quizId);
    setErreurLance(null);
    try {
      const { data, error } = await actions.partie.lancer({ quizId });
      if (error) {
        setErreurLance(erreurLancement(quizId, error.code, error.message));
        setLancementEnCours(null);
        return;
      }
      let stockage: Storage | null = null;
      try {
        stockage = window.sessionStorage;
      } catch {
        // Accès refusé : la page de pilotage redemande un jeton hôte.
      }
      memoriserHote(stockage, data);
      window.location.assign(urlPilotage(data.sessionId));
    } catch {
      setErreurLance(erreurLancement(quizId, "INTERNAL_SERVER_ERROR", MESSAGE_RESEAU));
      setLancementEnCours(null);
    }
  }

  async function dupliquer(quizId: string) {
    try {
      const { data, error } = await actions.quiz.dupliquer({ quizId });
      if (error) {
        setToast({ variante: "erreur", texte: error.message });
        return;
      }
      setToast({ variante: "succes", texte: "Quiz dupliqué." });
      if (await charger({ silencieux: true })) focaliserApresRendu([selecteurMenu(data.quizId), selecteurMenu(quizId)]);
    } catch {
      setToast({ variante: "erreur", texte: MESSAGE_RESEAU });
    }
  }

  async function confirmerSuppression() {
    if (!aSupprimer || suppressionEnCours) return;
    setSuppressionEnCours(true);
    setErreurSuppression(null);
    try {
      const { error } = await actions.quiz.supprimer({ quizId: aSupprimer.id });
      if (error) {
        setErreurSuppression(error.message);
        return;
      }
      // Le dialogue rendrait le focus au « … » d'une carte disparue : il va à la carte suivante (ou précédente), sinon au titre.
      const elements = quiz.etat === "pret" ? quiz.elements : [];
      const index = elements.findIndex((q) => q.id === aSupprimer.id);
      const voisine = elements[index + 1] ?? elements[index - 1];
      setQuiz((courant) => (courant.etat === "pret" ? { etat: "pret", elements: courant.elements.filter((q) => q.id !== aSupprimer.id) } : courant));
      setASupprimer(null);
      setToast({ variante: "succes", texte: "Quiz supprimé." });
      focaliserApresRendu([...(voisine ? [selecteurMenu(voisine.id)] : []), "#titre-tableau", "#demarrage-titre"]);
    } catch {
      setErreurSuppression(MESSAGE_RESEAU);
    } finally {
      setSuppressionEnCours(false);
    }
  }

  async function choisirModele(modeleId: string) {
    if (modeleEnCours) return;
    setModeleEnCours(modeleId);
    setErreurModele(null);
    try {
      const { data, error } = await actions.quiz.creer({ modele: modeleId });
      if (error) {
        setErreurModele(error.message);
        setModeleEnCours(null);
        return;
      }
      window.location.assign(urlEditeur(data.quizId));
    } catch {
      setErreurModele(MESSAGE_RESEAU);
      setModeleEnCours(null);
    }
  }

  return (
    <TableauDeBordVue
      utilisateur={utilisateur}
      quiz={quiz}
      parties={parties}
      modeles={modeles}
      onglet={onglet}
      onOnglet={setOnglet}
      onReessayerQuiz={() => void charger()}
      onReessayerParties={() => window.location.reload()}
      lancement={{ enCours: lancementEnCours, erreur: erreurLance }}
      onLancer={(id) => void lancer(id)}
      onDupliquer={(id) => void dupliquer(id)}
      suppression={{ quiz: aSupprimer, enCours: suppressionEnCours, erreur: erreurSuppression }}
      onDemanderSuppression={(q) => {
        setErreurSuppression(null);
        setASupprimer(q);
      }}
      onConfirmerSuppression={() => void confirmerSuppression()}
      onAnnulerSuppression={() => setASupprimer(null)}
      demarrage={{ modeleEnCours, erreur: erreurModele }}
      onChoisirModele={(id) => void choisirModele(id)}
      toast={toast}
      onFermerToast={() => setToast(null)}
    />
  );
}
