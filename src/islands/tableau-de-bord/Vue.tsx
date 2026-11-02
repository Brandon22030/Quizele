import { Plus } from "lucide-react";
import { Button } from "../../components/ui/button";
import { EtatErreur } from "../../components/ui/etat-erreur";
import { MenuCompte } from "../../components/ui/menu-compte";
import { Marque } from "../../components/ui/marque";
import { Modal } from "../../components/ui/modal";
import { Onglets } from "../../components/ui/onglets";
import { Squelette } from "../../components/ui/squelette";
import { Toast, ZoneToasts } from "../../components/ui/toast";
import { TitreAffiche } from "../../components/ui/titre-affiche";
import { CarteQuiz } from "./CarteQuiz";
import { ChoixDemarrage } from "./ChoixDemarrage";
import { ListeParties } from "./ListeParties";
import {
  titreOnglet,
  type EtatListe,
  type ErreurLancement,
  type ModeleCarte,
  type OngletId,
  type PartieJouee,
  type QuizCarte,
} from "./logique";

export interface Utilisateur {
  nom: string;
  email: string;
}

export interface MessageToast {
  variante: "succes" | "erreur";
  texte: string;
}

export interface VueProps {
  utilisateur: Utilisateur;
  quiz: EtatListe<QuizCarte>;
  /** null : la lecture des parties a échoué côté serveur. */
  parties: PartieJouee[] | null;
  modeles: ModeleCarte[];
  onglet: OngletId;
  onOnglet: (onglet: OngletId) => void;
  onReessayerQuiz: () => void;
  onReessayerParties: () => void;
  lancement: { enCours: string | null; erreur: ErreurLancement | null };
  onLancer: (quizId: string) => void;
  onDupliquer: (quizId: string) => void;
  suppression: { quiz: QuizCarte | null; enCours: boolean; erreur: string | null };
  onDemanderSuppression: (quiz: QuizCarte) => void;
  onConfirmerSuppression: () => void;
  onAnnulerSuppression: () => void;
  demarrage: { modeleEnCours: string | null; erreur: string | null };
  onChoisirModele: (modeleId: string) => void;
  toast: MessageToast | null;
  onFermerToast: () => void;
  onDeconnexion: () => void;
}

function SqueletteListe() {
  return (
    <div aria-busy="true" className="mt-5 flex flex-col gap-5">
      <p role="status" className="sr-only">
        Chargement de tes quiz
      </p>
      {[0, 1, 2].map((i) => (
        <div key={i} data-papier="" className="flex flex-col gap-3 rounded-md border-trait border-vert-foret bg-creme p-4">
          <Squelette className="h-6 w-1/2" />
          <Squelette className="h-8 w-3/4" />
          <Squelette className="h-14" />
        </div>
      ))}
    </div>
  );
}

export function TableauDeBordVue(props: VueProps) {
  const { utilisateur, quiz, parties, modeles, onglet, lancement, suppression, demarrage, toast } = props;
  const quizPrets = quiz.etat === "pret" ? quiz.elements : null;
  // Écran k2 : ni quiz ni partie, la page se réduit au choix de départ.
  const premiereVisite = quizPrets !== null && quizPrets.length === 0 && parties !== null && parties.length === 0;

  return (
    <div className="trame-points min-h-dvh pb-8">
      <div className="mx-auto w-full max-w-xl">
        <header className="flex items-center gap-2 px-4 pt-4">
          <Marque />
          <span className="flex-1" />
          {/* Better Auth refuse un POST de formulaire (415, JSON exigé) : on intercepte le submit de MenuCompte. */}
          <div
            onSubmit={(e) => {
              e.preventDefault();
              props.onDeconnexion();
            }}
          >
            <MenuCompte nom={utilisateur.nom} email={utilisateur.email} deconnexionHref="/api/auth/sign-out" />
          </div>
        </header>
        <main>
          {premiereVisite ? (
            <ChoixDemarrage
              modeles={modeles}
              modeleEnCours={demarrage.modeleEnCours}
              erreur={demarrage.erreur}
              onChoisir={props.onChoisirModele}
            />
          ) : (
            <div className="px-4 pt-4">
              <TitreAffiche id="titre-tableau" tabIndex={-1} className="-rotate-2 pl-2 text-3xl outline-none">
                TES QUIZ
              </TitreAffiche>
              <Button href="/quiz/nouveau" bloc className="mt-5">
                <Plus aria-hidden="true" className="size-5" />
                Créer un quiz
              </Button>
              <Onglets
                className="mt-5"
                label="Sections"
                valeur={onglet}
                onChange={(id) => props.onOnglet(id as OngletId)}
                onglets={[
                  { id: "quiz", label: titreOnglet("quiz", quizPrets?.length ?? null) },
                  { id: "parties", label: titreOnglet("parties", null) },
                ]}
              >
                {(actif, panneau) => (
                  <div {...panneau} className="outline-none">
                    {actif === "parties" ? (
                      <ListeParties parties={parties} onReessayer={props.onReessayerParties} />
                    ) : quiz.etat === "chargement" ? (
                      <SqueletteListe />
                    ) : quiz.etat === "erreur" ? (
                      <EtatErreur titre="Tes quiz sont introuvables" onRetry={props.onReessayerQuiz} className="mt-5">
                        {quiz.message}
                      </EtatErreur>
                    ) : quiz.elements.length === 0 ? (
                      <div className="-mx-4 mt-5">
                        <ChoixDemarrage
                          avecTitre={false}
                          modeles={modeles}
                          modeleEnCours={demarrage.modeleEnCours}
                          erreur={demarrage.erreur}
                          onChoisir={props.onChoisirModele}
                        />
                      </div>
                    ) : (
                      <ul className="mt-5 flex flex-col gap-2">
                        {quiz.elements.map((q) => (
                          <li key={q.id}>
                            <CarteQuiz
                              quiz={q}
                              lancementEnCours={lancement.enCours === q.id}
                              erreur={lancement.erreur?.quizId === q.id ? lancement.erreur : null}
                              onLancer={() => props.onLancer(q.id)}
                              onDupliquer={() => props.onDupliquer(q.id)}
                              onSupprimer={() => props.onDemanderSuppression(q)}
                            />
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </Onglets>
            </div>
          )}
        </main>
      </div>

      <Modal open={suppression.quiz !== null} onClose={props.onAnnulerSuppression} titre="Supprimer ce quiz ?">
        <p className="font-bold">
          « {suppression.quiz?.title} » et toutes ses questions seront supprimés. Cette action est définitive.
        </p>
        {suppression.erreur ? <EtatErreur>{suppression.erreur}</EtatErreur> : null}
        <div className="flex flex-col gap-3">
          <Button
            taille="petit"
            className="bg-piment text-creme"
            chargement={suppression.enCours}
            libelleChargement="Suppression en cours"
            onClick={props.onConfirmerSuppression}
          >
            Supprimer
          </Button>
          <Button taille="petit" variante="creme" onClick={props.onAnnulerSuppression}>
            Annuler
          </Button>
        </div>
      </Modal>

      <ZoneToasts
        statuts={
          toast?.variante === "succes" ? (
            <Toast variante="succes" duree={4000} onClose={props.onFermerToast}>
              {toast.texte}
            </Toast>
          ) : null
        }
        alertes={
          toast?.variante === "erreur" ? (
            <Toast variante="erreur" onClose={props.onFermerToast}>
              {toast.texte}
            </Toast>
          ) : null
        }
      />
    </div>
  );
}
