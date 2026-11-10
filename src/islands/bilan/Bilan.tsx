import { useEffect, useRef, useState } from "react";
import type { messagePartage as MessagePartage, sharePng as SharePng } from "../../client/partage";
import { VueBilan, VueChargement, VueEnCours, VueErreur } from "./Vue";
import { NOMBRE_PARTAGE, type DonneesBilan, type EtatBilan } from "./logique";

// Les fonctions de partage sont gardées avec le Blob : au clic, aucun import ne s'intercale avant navigator.share.
interface Outils {
  sharePng: typeof SharePng;
  messagePartage: typeof MessagePartage;
}

type Image = { statut: "preparation" } | { statut: "prete"; blob: Blob; outils: Outils } | { statut: "echec" };

interface Props {
  initial: EtatBilan;
}

export default function Bilan({ initial }: Props) {
  const [etat, setEtat] = useState(initial);

  if (etat.etat === "chargement") return <VueChargement />;
  if (etat.etat === "erreur") {
    // Pas d'action pour relire un bilan : la page serveur refait la lecture.
    const recharger = () => {
      setEtat({ etat: "chargement" });
      window.location.reload();
    };
    return <VueErreur message={etat.message} onRetry={etat.reessayable ? recharger : undefined} />;
  }
  if (etat.etat === "en-cours") return <VueEnCours sessionId={etat.sessionId} quizTitle={etat.quizTitle} />;
  return <BilanPret donnees={etat.donnees} />;
}

function BilanPret({ donnees }: { donnees: DonneesBilan }) {
  const [image, setImage] = useState<Image>({ statut: "preparation" });
  const [essai, setEssai] = useState(0);
  const [annonce, setAnnonce] = useState("");
  const partageEnCours = useRef(false);
  const aDesJoueurs = donnees.joueurs.length > 0;

  // Le PNG est fabriqué dès l'affichage : Safari iOS n'accepte navigator.share que dans le geste du clic,
  // sans chargement de module ni dessin entre les deux. Seuls pseudo, score et rang du top 5 y entrent.
  useEffect(() => {
    if (!aDesJoueurs) return;
    let annule = false;
    setImage({ statut: "preparation" });
    import("../../client/partage")
      .then(async ({ renderLeaderboardImage, sharePng, messagePartage }) => ({
        outils: { sharePng, messagePartage },
        blob: await renderLeaderboardImage({
          quizTitle: donnees.quizTitle,
          total: donnees.total,
          playerCount: donnees.joueurs.length,
          top: donnees.joueurs.slice(0, NOMBRE_PARTAGE).map((j) => ({ pseudo: j.pseudo, score: j.score, rank: j.rank })),
        }),
      }))
      .then(({ blob, outils }) => !annule && setImage({ statut: "prete", blob, outils }))
      .catch(() => !annule && setImage({ statut: "echec" }));
    return () => {
      annule = true;
    };
    // Les données sont figées à la fin de la partie : seul « Réessayer » relance le dessin.
  }, [essai, aDesJoueurs]);

  const partager = async () => {
    // Un second appui pendant la feuille de partage ou le téléchargement est ignoré.
    if (image.statut !== "prete" || partageEnCours.current) return;
    partageEnCours.current = true;
    const { sharePng, messagePartage } = image.outils;
    // Vider la région avant de repartir : un message identique à celui du partage précédent est ainsi réannoncé.
    // Cette mise à jour est synchrone et laisse navigator.share dans le geste du clic (Safari iOS).
    setAnnonce("");
    try {
      const retour = await sharePng(image.blob, {
        filename: "quizdeszeles-classement.png",
        title: "Quizdeszeles",
        text: `Le classement de ${donnees.quizTitle}.`,
      });
      setAnnonce(messagePartage(retour) ?? "");
    } finally {
      partageEnCours.current = false;
    }
  };

  return (
    <VueBilan
      donnees={donnees}
      image={image.statut}
      annonce={annonce}
      onPartager={() => void partager()}
      onReessayerImage={() => setEssai((n) => n + 1)}
    />
  );
}
