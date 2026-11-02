import { useEffect, useMemo, useRef, useState } from "react";
import { actions } from "astro:actions";
import { VueChargement, VueErreur, VueReglages } from "./Vue";
import {
  MESSAGE_RESEAU,
  creerFileEnregistrement,
  urlEditeur,
  type DonneesReglages,
  type EtatChargement,
  type PatchReglages,
  type Reglages as ValeursReglages,
  type StatutEnregistrement,
} from "./logique";

interface Props {
  quizId: string;
  initial: EtatChargement<DonneesReglages>;
}

// Délai de frappe avant enregistrement : une requête par pause, pas par touche.
const DELAI_TEXTE_MS = 600;

export default function Reglages({ quizId, initial }: Props) {
  const [etat, setEtat] = useState(initial);

  async function recharger() {
    setEtat({ etat: "chargement" });
    try {
      const { data, error } = await actions.quiz.charger({ quizId });
      if (error) {
        setEtat({ etat: "erreur", message: error.message, reessayable: error.code === "INTERNAL_SERVER_ERROR" });
        return;
      }
      const q = data.quiz;
      setEtat({
        etat: "pret",
        donnees: {
          quizId: q.id,
          title: q.title,
          mode: q.mode,
          showCorrectAnswer: q.showCorrectAnswer,
          shuffle: q.shuffle,
          description: q.description ?? "",
          category: q.category ?? "",
        },
      });
    } catch {
      setEtat({ etat: "erreur", message: MESSAGE_RESEAU, reessayable: true });
    }
  }

  if (etat.etat === "chargement") return <VueChargement quizId={quizId} />;
  if (etat.etat === "erreur") return <VueErreur quizId={quizId} message={etat.message} onRetry={etat.reessayable ? () => void recharger() : undefined} />;
  return <Edition donnees={etat.donnees} />;
}

function Edition({ donnees }: { donnees: DonneesReglages }) {
  const [valeurs, setValeurs] = useState<ValeursReglages>({
    mode: donnees.mode,
    showCorrectAnswer: donnees.showCorrectAnswer,
    shuffle: donnees.shuffle,
    description: donnees.description,
    category: donnees.category,
  });
  const [statut, setStatut] = useState<StatutEnregistrement>({ etat: "repos" });
  const texteEnAttente = useRef<PatchReglages>({});
  const minuteur = useRef<ReturnType<typeof setTimeout> | null>(null);

  const file = useMemo(
    () =>
      creerFileEnregistrement(async (patch) => {
        const { error } = await actions.quiz.majReglages({ quizId: donnees.quizId, ...patch });
        return error ? error.message : null;
      }, (nouveau) => {
        // Une saisie encore dans son délai n'est pas partie : « Enregistré » serait faux tant qu'elle est en attente.
        setStatut(nouveau.etat === "enregistre" && Object.keys(texteEnAttente.current).length > 0 ? { etat: "enregistrement" } : nouveau);
      }),
    [donnees.quizId],
  );

  function envoyerTexte() {
    if (minuteur.current) clearTimeout(minuteur.current);
    minuteur.current = null;
    const patch = texteEnAttente.current;
    texteEnAttente.current = {};
    if (Object.keys(patch).length > 0) file.pousser(patch);
  }

  useEffect(
    () => () => {
      if (minuteur.current) clearTimeout(minuteur.current);
    },
    [],
  );

  function changer(patch: PatchReglages) {
    setValeurs((v) => ({ ...v, ...patch }));
    file.pousser(patch);
  }

  function saisirTexte(champ: "description" | "category", valeur: string) {
    setValeurs((v) => ({ ...v, [champ]: valeur }));
    texteEnAttente.current = { ...texteEnAttente.current, [champ]: valeur };
    // Pendant le délai de frappe, « Enregistré » serait faux : la saisie n'est pas encore partie.
    setStatut({ etat: "enregistrement" });
    if (minuteur.current) clearTimeout(minuteur.current);
    minuteur.current = setTimeout(envoyerTexte, DELAI_TEXTE_MS);
  }

  // Quitter avec une saisie ou un envoi en cours : on laisse finir, sinon la navigation annulerait la requête.
  function retour(event: React.MouseEvent<HTMLAnchorElement>) {
    if (Object.keys(texteEnAttente.current).length === 0 && statut.etat !== "enregistrement" && statut.etat !== "echec") return;
    event.preventDefault();
    envoyerTexte();
    void file.attendre().then(() => {
      // Un échec reste affiché (avec Réessayer) plutôt que d'abandonner la modification en silence.
      if (!file.enEchec()) window.location.assign(urlEditeur(donnees.quizId));
    });
  }

  return (
    <VueReglages
      donnees={donnees}
      valeurs={valeurs}
      statut={statut}
      onChange={changer}
      onTexte={saisirTexte}
      onTexteTermine={envoyerTexte}
      onReessayer={() => file.reessayer()}
      onRetour={retour}
    />
  );
}
