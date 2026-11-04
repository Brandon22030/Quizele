import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Monitor } from "lucide-react";
import type { SessionState } from "../../client/realtime/session-state";
import type { PlayerInfo } from "../../shared/protocol";
import { Classement, Podium, StatutConnexion, type LigneClassement, type PlacePodium } from "../../components/jeu";
import { Button } from "../../components/ui/button";
import { EtatErreur } from "../../components/ui/etat-erreur";
import { Modal } from "../../components/ui/modal";
import { Pilule } from "../../components/ui/pilule";
import { Squelette } from "../../components/ui/squelette";
import { Toast, ZoneToasts } from "../../components/ui/toast";
import { FocusTitre } from "../joueur/FocusTitre";
import { PartageCode, TicketCode } from "./CodeEtLien";
import { ParticipantsHote } from "./ParticipantsHote";
import { BarreCommandes, TelecommandeLibre, TelecommandeQuestion } from "./Telecommande";
import { annoncePhase, messageErreurServeur, messageEchec, urlBilan, urlPilotage, vueHote, type EchecAcces, type VueHote } from "./logique";

export interface VuePilotageProps {
  sessionId: string;
  code: string;
  state: SessionState;
  onDemarrer: () => void;
  onReveler: () => void;
  onSuivante: () => void;
  onTerminer: () => void;
  onRetirer: (playerId: string) => void;
  onProjeter: () => void;
  // Sert à refermer la bonne réponse et les notifications quand la projection s'ouvre ou se ferme.
  projectionOuverte?: boolean;
}

interface Message {
  variante: "succes" | "erreur";
  texte: string;
}

// Écran de chargement : connexion au Durable Object, avant le premier instantané.
export function ChargementPilotage({ status = "connecting" }: { status?: SessionState["connection"] }) {
  return (
    <div aria-busy="true" className="mx-auto w-full max-w-xl px-4 pt-4">
      <StatutConnexion status={status} />
      <h1 className="sr-only">Connexion à la partie</h1>
      <Squelette className="h-10 w-2/3 rounded-pill" />
      <Squelette className="mt-6 h-scene-basse w-full" />
      <Squelette className="mt-6 h-16 w-full" />
      <Squelette className="mt-4 h-16 w-full" />
    </div>
  );
}

interface EchecProps {
  echec: EchecAcces;
  onReessayer: () => void;
  sessionId?: string;
}

export function EchecPilotage({ echec, onReessayer, sessionId }: EchecProps) {
  const message = messageEchec(echec);
  const retour = sessionId ? urlPilotage(sessionId) : "/tableau-de-bord";
  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-6">
      <FocusTitre selecteur="h1" />
      <h1 className="sr-only">{message.titre}</h1>
      <EtatErreur titre={message.titre} onRetry={message.reessayer ? onReessayer : undefined}>
        {message.texte}
      </EtatErreur>
      <Button bloc variante="creme" href={echec === "connexion" ? `/connexion?retour=${encodeURIComponent(retour)}` : "/tableau-de-bord"} className="mt-4">
        {echec === "connexion" ? "Me connecter" : "Retour au tableau de bord"}
      </Button>
      {echec === "introuvable" && sessionId ? (
        <a href={urlBilan(sessionId)} className="mt-2 inline-flex min-h-11 items-center font-extrabold underline decoration-trait underline-offset-4">
          Voir le bilan
        </a>
      ) : null}
    </div>
  );
}

// Partie finie (ou socket fermée par le serveur à la fin) : classement et lien vers le bilan, construit par QZ-002-17.
function FinPartie({ state, sessionId, termine }: { state: SessionState; sessionId: string; termine: boolean }) {
  const classement = state.ranking;
  const places: PlacePodium[] = classement.slice(0, 3).map((l) => ({
    playerId: l.playerId,
    rank: l.rank as 1 | 2 | 3,
    pseudo: l.pseudo,
  }));
  const lignes: LigneClassement[] = classement.slice(3).map((l) => ({
    playerId: l.playerId,
    rank: l.rank,
    pseudo: l.pseudo,
    score: l.score,
  }));
  const total = state.totalQuestions ?? 0;
  return (
    <section className="px-4 pt-3">
      <FocusTitre selecteur="[data-focus-titre]" />
      <h1 data-focus-titre tabIndex={-1} className="font-affiche text-2xl text-jaune-soleil outline-none">
        Partie terminée
      </h1>
      {termine && classement.length === 0 ? <p className="mt-2 font-semibold">Les résultats sont disponibles dans le bilan de la partie.</p> : null}
      {places.length > 0 ? <Podium className="pt-6" places={places} /> : null}
      {lignes.length > 0 ? <Classement className="mt-6" total={total} rows={lignes} /> : null}
      <div className="mt-8 flex flex-col gap-3 pb-8">
        <Button bloc variante="soleil" href={urlBilan(sessionId)}>
          Voir le bilan de la partie
        </Button>
        <Button bloc variante="creme" href="/tableau-de-bord">
          Retour au tableau de bord
        </Button>
      </div>
    </section>
  );
}

interface SalleProps {
  state: SessionState;
  code: string;
  onCopier: () => void;
  onRetirer: (joueur: PlayerInfo) => void;
  retraitDemande: string | null;
  onRetraitTermine: () => void;
}

function Salle({ state, code, onCopier, onRetirer, retraitDemande, onRetraitTermine }: SalleProps) {
  // L'origine n'existe pas au rendu serveur : le QR est calculé après l'hydratation.
  const [origine, setOrigine] = useState("");
  useEffect(() => setOrigine(window.location.origin), []);
  return (
    <section className="px-4 pt-2">
      <FocusTitre selecteur="[data-focus-titre]" />
      <Pilule variante="soleil" className="border-vert-nuit text-xs">
        Session active
      </Pilule>
      <h1 data-focus-titre tabIndex={-1} className="mt-1 font-affiche text-xl break-words outline-none">
        {state.title}
      </h1>
      <div className="lg:mt-6 lg:grid lg:grid-cols-2 lg:gap-8">
        <div className="mt-6 flex flex-col gap-6 lg:mt-0">
          <TicketCode code={code} />
          <PartageCode code={code} origine={origine} onCopier={onCopier} />
        </div>
        <div className="mt-8 lg:mt-0">
          <ParticipantsHote joueurs={state.players} total={state.playerCount} retraitDemande={retraitDemande} onRetraitTermine={onRetraitTermine} onRetirer={onRetirer} />
        </div>
      </div>
    </section>
  );
}

export function VuePilotage(props: VuePilotageProps) {
  const { sessionId, code, state } = props;
  const vue: VueHote = vueHote(state);
  const [aRetirer, setARetirer] = useState<PlayerInfo | null>(null);
  const [confirmerFin, setConfirmerFin] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [retraitDemande, setRetraitDemande] = useState<string | null>(null);
  const finRetrait = useCallback(() => setRetraitDemande(null), []);
  const [reponse, setReponse] = useState({ ouverte: false, cle: "" });
  const cleReponse = `${state.question?.questionId ?? ""}-${props.projectionOuverte ? "p" : "t"}`;
  // La clé change à chaque question et à chaque ouverture ou fermeture de la projection : le repli se referme sans effet différé.
  const reponseVisible = reponse.ouverte && reponse.cle === cleReponse;

  // Une erreur affichée en toast ne doit pas rester sur le grand écran.
  useEffect(() => {
    if (props.projectionOuverte) setMessage(null);
  }, [props.projectionOuverte]);

  // Hors des phases de jeu, la fenêtre de confirmation de fin n'a plus d'objet (partie finie par le serveur entre-temps).
  useEffect(() => {
    if (state.phase === "finished") setConfirmerFin(false);
  }, [state.phase]);

  const demanderRetrait = useCallback((joueur: PlayerInfo) => setARetirer(joueur), []);

  const copier = useCallback(async () => {
    const url = `${window.location.origin}/j/${code}`;
    try {
      await navigator.clipboard.writeText(url);
      setMessage({ variante: "succes", texte: "Lien copié." });
    } catch {
      setMessage({
        variante: "erreur",
        texte: "Copie impossible. Sélectionne le lien affiché pour le copier.",
      });
    }
  }, [code]);

  if (vue === "chargement") return <ChargementPilotage status={state.connection} />;
  if (vue === "rejete") return <EchecPilotage echec="expire" onReessayer={() => window.location.reload()} />;

  const enJeu = vue === "salle" || vue === "question" || vue === "correction" || vue === "libre";
  let contenu: ReactNode;
  if (vue === "salle") contenu = <Salle state={state} code={code} onCopier={() => void copier()} onRetirer={demanderRetrait} retraitDemande={retraitDemande} onRetraitTermine={finRetrait} />;
  else if (vue === "question" || vue === "correction")
    contenu = (
      <>
        <FocusTitre key={`${state.question?.questionId}-${vue}`} selecteur="[data-focus-titre]" />
        <TelecommandeQuestion state={state} reponseVisible={reponseVisible} onBasculerReponse={() => setReponse({ ouverte: !reponseVisible, cle: cleReponse })} />
      </>
    );
  else if (vue === "libre")
    contenu = (
      <>
        <FocusTitre selecteur="[data-focus-titre]" />
        <TelecommandeLibre state={state} />
      </>
    );
  else contenu = <FinPartie state={state} sessionId={sessionId} termine={vue === "termine"} />;

  return (
    <div className="trame-points min-h-dvh pb-2 text-creme">
      <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col lg:max-w-5xl">
        {/* Région persistante : une région insérée avec son texte est annoncée de façon peu fiable. */}
        <p aria-live="polite" className="sr-only">
          {annoncePhase(state, vue)}
        </p>
        <StatutConnexion status={state.connection === "ended" ? "open" : state.connection} className="px-4 pt-2" />
        {vue !== "fin" && vue !== "termine" ? (
          <header className="flex items-center gap-3 px-4 pt-2">
            {vue === "salle" ? null : (
              <Pilule variante="soleil" className="border-vert-nuit">
                <span className="sr-only">Code de la partie : </span>
                {code}
              </Pilule>
            )}
            <span className="flex-1" />
            <Button id="bouton-projeter" taille="petit" variante="soleil" onClick={props.onProjeter}>
              <Monitor aria-hidden="true" className="size-5" />
              Projeter
            </Button>
          </header>
        ) : null}
        {state.error ? (
          <div className="px-4 pt-3">
            <EtatErreur>{messageErreurServeur(state.error)}</EtatErreur>
          </div>
        ) : null}
        <div className="flex-1">{contenu}</div>
        {enJeu ? <BarreCommandes state={state} onDemarrer={props.onDemarrer} onReveler={props.onReveler} onSuivante={props.onSuivante} onTerminer={() => setConfirmerFin(true)} /> : null}
      </div>

      <Modal open={aRetirer !== null} onClose={() => setARetirer(null)} titre={aRetirer ? `Retirer ${aRetirer.pseudo} ?` : "Retirer un joueur"}>
        <p className="font-semibold">Ce joueur sera exclu de la partie et ne pourra plus la rejoindre.</p>
        <div className="flex flex-col gap-3">
          <Button
            bloc
            onClick={() => {
              if (aRetirer) {
                setRetraitDemande(aRetirer.id);
                props.onRetirer(aRetirer.id);
              }
              setARetirer(null);
            }}
          >
            Retirer
          </Button>
          <Button bloc variante="creme" onClick={() => setARetirer(null)}>
            Annuler
          </Button>
        </div>
      </Modal>

      <Modal open={confirmerFin} onClose={() => setConfirmerFin(false)} titre="Terminer la partie ?">
        <p className="font-semibold">La partie s'arrête pour tous les joueurs et le classement est affiché.</p>
        <div className="flex flex-col gap-3">
          <Button
            bloc
            onClick={() => {
              setConfirmerFin(false);
              props.onTerminer();
            }}
          >
            Terminer la partie
          </Button>
          <Button bloc variante="creme" onClick={() => setConfirmerFin(false)}>
            Continuer à jouer
          </Button>
        </div>
      </Modal>

      <ZoneToasts
        statuts={
          message?.variante === "succes" ? (
            <Toast variante="succes" duree={3000} onClose={() => setMessage(null)}>
              {message.texte}
            </Toast>
          ) : null
        }
        alertes={
          message?.variante === "erreur" ? (
            <Toast variante="erreur" onClose={() => setMessage(null)}>
              {message.texte}
            </Toast>
          ) : null
        }
      />
    </div>
  );
}
