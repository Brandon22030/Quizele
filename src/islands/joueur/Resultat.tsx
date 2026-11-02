import { useEffect, useState } from "react";
import type { SessionState } from "../../client/realtime/session-state";
import type { ShareResult } from "../../client/partage";
import { Classement, Podium, ScoreFinal, type LigneClassement, type PlacePodium } from "../../components/jeu";
import { Button } from "../../components/ui/button";
import { EtatErreur } from "../../components/ui/etat-erreur";

interface Props {
  state: SessionState;
  total: number;
}

type Image = { statut: "preparation" } | { statut: "prete"; blob: Blob } | { statut: "echec" };

function messageFinal(score: number, total: number): string {
  const part = total > 0 ? score / total : 0;
  if (part >= 0.8) return "Beau parcours, tu connais bien ta Bible !";
  if (part >= 0.5) return "Bien joué, continue comme ça !";
  return "Merci d'avoir joué, la prochaine fois sera la bonne !";
}

// Écran f. Le PNG est fabriqué dès l'affichage : Safari iOS n'accepte navigator.share que dans le geste du clic,
// sans chargement de module ni dessin entre les deux.
export function Resultat({ state, total }: Props) {
  const resultat = state.result;
  const classement = state.ranking;
  const moi = state.me;
  const [image, setImage] = useState<Image>({ statut: "preparation" });
  const [essai, setEssai] = useState(0);
  const [annonce, setAnnonce] = useState("");

  const score = resultat?.score ?? 0;
  const nombreJoueurs = Math.max(state.playerCount, classement.length);

  useEffect(() => {
    if (!resultat) return;
    let annule = false;
    setImage({ statut: "preparation" });
    import("../../client/partage")
      .then(({ renderResultImage }) =>
        renderResultImage({
          quizTitle: state.title,
          pseudo: moi?.pseudo ?? "",
          score: resultat.score,
          total,
          rank: resultat.rank,
          playerCount: nombreJoueurs,
          top: classement.slice(0, 5).map((l) => ({ pseudo: l.pseudo, score: l.score })),
        }),
      )
      .then((blob) => !annule && setImage({ statut: "prete", blob }))
      .catch(() => !annule && setImage({ statut: "echec" }));
    return () => {
      annule = true;
    };
    // Les données du résultat sont figées à la fin de la partie : seul « Réessayer » relance le dessin.
  }, [essai, resultat?.rank, resultat?.score, total]);

  const partager = async () => {
    if (image.statut !== "prete") return;
    const { sharePng, messagePartage } = await import("../../client/partage");
    const retour: ShareResult = await sharePng(image.blob, {
      filename: "quizdeszeles-resultat.png",
      title: "Quizdeszeles",
      text: `J'ai fait ${score} sur ${total} à ${state.title}.`,
    });
    setAnnonce(messagePartage(retour) ?? "");
  };

  const places: PlacePodium[] = classement.slice(0, 3).map((l, i) => ({
    playerId: l.playerId,
    rank: (i + 1) as 1 | 2 | 3,
    pseudo: l.pseudo,
    isYou: l.playerId === moi?.playerId,
  }));
  const lignes: LigneClassement[] = classement.slice(3).map((l, i) => ({
    playerId: l.playerId,
    rank: i + 4,
    pseudo: l.pseudo,
    score: l.score,
    isYou: l.playerId === moi?.playerId,
  }));

  return (
    <>
      <h1 className="sr-only">Résultat final</h1>
      {resultat ? (
        <ScoreFinal
          score={resultat.score}
          total={total}
          totalMs={resultat.totalMs}
          rank={resultat.rank}
          playerCount={nombreJoueurs}
          message={messageFinal(resultat.score, total)}
        />
      ) : (
        <p className="px-6 pt-8 text-center font-affiche text-2xl">La partie est terminée. Merci d'avoir joué !</p>
      )}
      {places.length > 0 ? <Podium className="px-4 pt-8" places={places} /> : null}
      {lignes.length > 0 ? <Classement className="mx-4 mt-6" total={total} rows={lignes} /> : null}
      {resultat ? (
        <div className="px-4 pt-8">
          {image.statut === "echec" ? (
            <EtatErreur titre="Image indisponible" onRetry={() => setEssai((n) => n + 1)}>
              L'image de ton score n'a pas pu être créée.
            </EtatErreur>
          ) : (
            <Button
              bloc
              chargement={image.statut === "preparation"}
              libelleChargement="Préparation de l'image"
              onClick={partager}
            >
              Partager mon score
            </Button>
          )}
        </div>
      ) : null}
      <p role="status" className="px-4 pt-4 text-center font-bold">
        {annonce}
      </p>
    </>
  );
}
