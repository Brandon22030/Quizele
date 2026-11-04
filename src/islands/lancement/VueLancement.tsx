import { ArrowLeft, Play } from "lucide-react";
import { Button } from "../../components/ui/button";
import { EtatErreur } from "../../components/ui/etat-erreur";
import { Squelette } from "../../components/ui/squelette";
import { TitreAffiche } from "../../components/ui/titre-affiche";
import { TraitsEnergie } from "../../components/ui/traits-energie";
import { FocusTitre } from "../joueur/FocusTitre";
import { urlEditeur } from "../tableau-de-bord/logique";
import { ListeVerification } from "./ListeVerification";
import { MODES, peutLancer, resumeQuiz, urlReglages, verifications, type EtatLancement } from "./logique";

export interface VueLancementProps {
  quizId: string;
  etat: EtatLancement;
  lancementEnCours: boolean;
  erreurLancement: string | null;
  onLancer: () => void;
  onReessayer: () => void;
}

function Entete({ quizId }: { quizId: string }) {
  return (
    <header className="flex items-center gap-3 px-4 py-2">
      <a
        href={urlEditeur(quizId)}
        aria-label="Retour à l'éditeur"
        className="grid size-11 shrink-0 place-items-center rounded-sm border-trait border-vert-foret bg-creme text-vert-foret shadow-relief-sm"
      >
        <ArrowLeft aria-hidden="true" className="size-5" />
      </a>
      <p className="font-affiche text-lg">Lancer une partie</p>
    </header>
  );
}

function Chargement() {
  return (
    <div aria-busy="true" className="px-4 pt-6">
      <h1 className="sr-only">Chargement du quiz</h1>
      <p role="status" className="sr-only">
        Chargement du quiz
      </p>
      <Squelette className="mx-auto h-14 w-2/3" />
      <Squelette className="mx-auto mt-4 h-8 w-1/2" />
      <Squelette className="mt-8 h-scene-basse w-full" />
      <Squelette className="mt-6 h-16 w-full" />
    </div>
  );
}

export function VueLancement({ quizId, etat, lancementEnCours, erreurLancement, onLancer, onReessayer }: VueLancementProps) {
  return (
    <div className="trame-points flex min-h-dvh flex-col">
      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col">
        <Entete quizId={quizId} />
        {etat.etat === "chargement" ? <Chargement /> : null}
        {etat.etat === "erreur" ? (
          <div className="px-4 pt-6">
            <FocusTitre selecteur="h1" />
            <h1 className="sr-only">Lancement impossible</h1>
            <EtatErreur
              titre={etat.introuvable ? "Quiz introuvable" : "Chargement impossible"}
              onRetry={etat.introuvable ? undefined : onReessayer}
            >
              {etat.message}
            </EtatErreur>
            <Button bloc variante="creme" href="/tableau-de-bord" className="mt-4">
              Retour au tableau de bord
            </Button>
          </div>
        ) : null}
        {etat.etat === "pret" ? (
          <>
            <FocusTitre selecteur="h1" />
            <section className="relative px-4 pt-4 text-center">
              <TraitsEnergie className="absolute top-2 left-5" />
              <TitreAffiche as="h1" className="-rotate-3 text-4xl">
                PRÊT ?
              </TitreAffiche>
              <p className="mt-3 font-affiche text-xl break-words">{etat.quiz.title}</p>
              <p className="text-sm font-semibold">{resumeQuiz(etat.quiz)}</p>
            </section>
            <ListeVerification verifications={verifications(etat.quiz, etat.status)} />
            <section aria-labelledby="mode-partie" className="px-4 pt-6">
              <h2 id="mode-partie" className="font-affiche text-lg">
                Pour cette partie
              </h2>
              <div className="mt-3 rounded-md border-trait border-vert-foret bg-vert-foret p-4 text-creme shadow-relief-vif">
                <p className="font-affiche text-lg leading-tight">{MODES[etat.quiz.mode].titre}</p>
                <p className="text-sm font-semibold">{MODES[etat.quiz.mode].description}</p>
              </div>
              <a href={urlReglages(quizId)} className="mt-1 inline-flex min-h-11 items-center font-extrabold underline decoration-trait underline-offset-4">
                Changer dans les réglages
              </a>
            </section>
            <div className="flex-1" />
            <div className="sticky bottom-0 mt-6 bg-jaune-soleil">
              <div aria-hidden="true" className="h-trait bg-vert-foret" />
              <div className="flex flex-col gap-3 px-4 pt-4 pb-6">
                {erreurLancement ? <EtatErreur titre="Lancement impossible">{erreurLancement}</EtatErreur> : null}
                <Button
                  bloc
                  disabled={!peutLancer(etat.status)}
                  chargement={lancementEnCours}
                  libelleChargement="Lancement de la partie en cours"
                  onClick={onLancer}
                  aria-describedby={peutLancer(etat.status) ? undefined : "aide-lancement"}
                >
                  <Play aria-hidden="true" className="size-5" />
                  Lancer la partie
                </Button>
                {peutLancer(etat.status) ? null : (
                  <p id="aide-lancement" className="text-center text-sm font-bold">
                    Complète les points signalés ci-dessus pour lancer la partie.
                  </p>
                )}
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
