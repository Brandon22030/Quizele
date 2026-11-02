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
  parties: PartieJouee[] | null;
  modeles: ModeleCarte[];
}

const MESSAGE_RESEAU = "Connexion impossible. Vérifie ta connexion puis réessaie.";

export default function TableauDeBord({ utilisateur, parties, modeles }: TableauDeBordProps) {
  const [quiz, setQuiz] = useState<EtatListe<QuizCarte>>({ etat: "chargement" });
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

  async function charger() {
    const courante = ++generation.current;
    setQuiz({ etat: "chargement" });
    try {
      const { data, error } = await actions.quiz.lister();
      if (courante !== generation.current) return;
      setQuiz(error ? { etat: "erreur", message: error.message } : { etat: "pret", elements: data.quizzes });
    } catch {
      if (courante === generation.current) setQuiz({ etat: "erreur", message: MESSAGE_RESEAU });
    }
  }

  useEffect(() => {
    void charger();
  }, []);

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
      const { error } = await actions.quiz.dupliquer({ quizId });
      if (error) {
        setToast({ variante: "erreur", texte: error.message });
        return;
      }
      setToast({ variante: "succes", texte: "Quiz dupliqué." });
      await charger();
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
      setQuiz((courant) => (courant.etat === "pret" ? { etat: "pret", elements: courant.elements.filter((q) => q.id !== aSupprimer.id) } : courant));
      setASupprimer(null);
      setToast({ variante: "succes", texte: "Quiz supprimé." });
      // Le dialogue rend le focus à une carte qui n'existe plus : on le pose sur le titre de la page.
      document.getElementById("titre-tableau")?.focus();
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

  async function deconnecter() {
    try {
      const reponse = await fetch("/api/auth/sign-out", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (!reponse.ok) throw new Error("sign-out");
      window.location.assign("/");
    } catch {
      setToast({ variante: "erreur", texte: "Déconnexion impossible pour le moment. Réessaie." });
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
      onDeconnexion={() => void deconnecter()}
    />
  );
}
