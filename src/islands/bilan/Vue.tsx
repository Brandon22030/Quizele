import type { ReactNode } from "react";
import { ArrowLeft, Download, Play, Share2, Users } from "lucide-react";
import { Classement, Podium, type LigneClassement, type PlacePodium } from "../../components/jeu";
import { Button } from "../../components/ui/button";
import { EtatErreur } from "../../components/ui/etat-erreur";
import { EtatVide } from "../../components/ui/etat-vide";
import { Pilule } from "../../components/ui/pilule";
import { Repli } from "../../components/ui/repli";
import { Squelette } from "../../components/ui/squelette";
import { CarteARevoir } from "./CarteARevoir";
import { useCoteClient } from "./cote-client";
import {
  MENTION_PURGE,
  NOMBRE_LIGNES_VISIBLES,
  dateJouee,
  formaterMoyenne,
  libelleJoueurs,
  urlExport,
  urlPilotage,
  urlRetour,
  type DonneesBilan,
} from "./logique";

function TitreBarre({ jouee }: { jouee?: string }) {
  const client = useCoteClient();
  // Avant le montage, la date n'est pas formatée : un titre neutre évite un décalage d'hydratation.
  return <span className="font-affiche text-lg leading-tight">{jouee && client ? `Partie du ${dateJouee(new Date(jouee))}` : "Bilan de la partie"}</span>;
}

export function Cadre({ jouee, barre, children }: { jouee?: string; barre?: ReactNode; children: ReactNode }) {
  return (
    <div className="trame-points flex min-h-dvh flex-col">
      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col">
        <header className="flex items-center gap-3 px-4 pt-4">
          <a
            href={urlRetour}
            aria-label="Retour aux parties jouées"
            className="grid size-11 shrink-0 place-items-center rounded-sm border-trait border-vert-foret bg-creme text-vert-foret shadow-relief-sm active:-translate-x-1 active:translate-y-1 active:shadow-relief-appui"
          >
            <ArrowLeft aria-hidden="true" className="size-5" />
          </a>
          <TitreBarre jouee={jouee} />
        </header>
        <main className="flex-1 px-4 pt-4 pb-8">{children}</main>
        {barre}
      </div>
    </div>
  );
}

export function VueChargement() {
  return (
    <Cadre>
      <div aria-busy="true" className="flex flex-col gap-5">
        <p role="status" className="sr-only">
          Chargement du bilan
        </p>
        <Squelette className="h-8 w-2/3" />
        <Squelette className="h-8 w-1/2" />
        <Squelette className="h-scene-basse w-full" />
        <Squelette className="h-20 w-full" />
      </div>
    </Cadre>
  );
}

export function VueErreur({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Cadre>
      <h1 className="mb-4 font-affiche text-2xl leading-tight">Bilan indisponible</h1>
      <EtatErreur onRetry={onRetry}>
        {message}
      </EtatErreur>
      <Button href={urlRetour} variante="creme" taille="petit" className="mt-4">
        Retour aux parties jouées
      </Button>
    </Cadre>
  );
}

// Le bilan n'existe qu'une fois la partie terminée : d'ici là, le pilotage est la bonne page.
export function VueEnCours({ sessionId, quizTitle }: { sessionId: string; quizTitle: string }) {
  return (
    <Cadre>
      <h1 className="font-affiche text-2xl leading-tight break-words">{quizTitle}</h1>
      <EtatVide
        icone={<Play className="size-10" />}
        titre="Partie en cours"
        action={
          <Button href={urlPilotage(sessionId)} taille="petit" className="w-full">
            Reprendre le pilotage
          </Button>
        }
      >
        Le bilan sera disponible quand la partie sera terminée.
      </EtatVide>
    </Cadre>
  );
}

type Image = "preparation" | "prete" | "echec";

interface VueBilanProps {
  donnees: DonneesBilan;
  image: Image;
  annonce: string;
  onPartager: () => void;
  onReessayerImage: () => void;
}

export function VueBilan({ donnees, image, annonce, onPartager, onReessayerImage }: VueBilanProps) {
  const { joueurs, total, moyenne, aRevoir } = donnees;
  const vide = joueurs.length === 0;

  const places: PlacePodium[] = joueurs
    .filter((j) => j.rank <= 3)
    .map((j) => ({ playerId: j.id, rank: j.rank as 1 | 2 | 3, pseudo: j.pseudo }));
  const lignes = (liste: typeof joueurs): LigneClassement[] =>
    liste.map((j) => ({ playerId: j.id, rank: j.rank, pseudo: j.pseudo, score: j.score }));
  const suite = joueurs.filter((j) => j.rank > 3);
  const visibles = suite.slice(0, NOMBRE_LIGNES_VISIBLES - 3);
  const reste = suite.slice(NOMBRE_LIGNES_VISIBLES - 3);

  const barre = vide ? null : (
    <footer className="sticky bottom-0 border-trait border-x-0 border-b-0 border-vert-foret bg-jaune-soleil px-4 py-3">
      <div className="flex gap-3">
        <Button href={urlExport(donnees.sessionId)} download variante="creme" taille="petit" className="flex-1">
          <Download aria-hidden="true" className="size-5" />
          Exporter
        </Button>
        <Button
          taille="petit"
          className="flex-1"
          disabled={image === "echec"}
          chargement={image === "preparation"}
          libelleChargement="Préparation de l'image"
          onClick={onPartager}
        >
          <Share2 aria-hidden="true" className="size-5" />
          Partager
        </Button>
      </div>
      <p role="status" className="pt-2 text-center text-sm font-bold">
        {annonce}
      </p>
    </footer>
  );

  return (
    <Cadre jouee={donnees.jouee} barre={barre}>
      <h1 className="font-affiche text-2xl leading-tight break-words">{donnees.quizTitle}</h1>
      {vide ? (
        // Des statistiques sans joueur : la partie a été clôturée par le cron de secours, les scores n'ont pas été gardés.
        total > 0 ? (
          <EtatVide icone={<Users className="size-10" />} titre="Aucun résultat enregistré pour cette partie">
            La partie a été clôturée automatiquement : ni classement ni question à revoir n'ont pu être gardés.
          </EtatVide>
        ) : (
          <EtatVide icone={<Users className="size-10" />} titre="Personne n'a joué cette partie">
            Aucun joueur n'a rejoint : il n'y a ni classement ni question à revoir.
          </EtatVide>
        )
      ) : (
        <>
          <div className="mt-3 flex flex-wrap gap-2">
            <Pilule>{libelleJoueurs(joueurs.length)}</Pilule>
            {moyenne !== null ? <Pilule variante="creme">{formaterMoyenne(moyenne, total)}</Pilule> : null}
          </div>
          <Podium className="pt-6" places={places} />
          {visibles.length > 0 ? <Classement className="mt-6" total={total} rows={lignes(visibles)} /> : null}
          {reste.length > 0 ? (
            <Repli titre={`Voir les ${reste.length} autres joueurs`} className="mt-4">
              <Classement className="mt-0" total={total} rows={lignes(reste)} />
            </Repli>
          ) : null}
          {image === "echec" ? (
            <EtatErreur titre="Image indisponible" onRetry={onReessayerImage} className="mt-6">
              L'image du classement n'a pas pu être créée.
            </EtatErreur>
          ) : null}
          <section aria-labelledby="a-revoir" className="mt-8">
            <h2 id="a-revoir" className="font-affiche text-xl leading-tight">
              À revoir ensemble
            </h2>
            {aRevoir.length === 0 ? (
              <p className="mt-1 text-sm font-semibold">Aucune question n'a posé de difficulté : bravo à la salle !</p>
            ) : (
              <>
                <p className="mt-1 text-sm font-semibold">Les questions les plus ratées, pour la prochaine fois.</p>
                <ul className="m-0 mt-3 flex list-none flex-col gap-4 p-0">
                  {aRevoir.map((q) => (
                    <li key={q.position}>
                      <CarteARevoir question={q} />
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        </>
      )}
      <p className="pt-8 text-center text-sm font-semibold">{MENTION_PURGE}</p>
    </Cadre>
  );
}
