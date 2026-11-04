import type { ReactNode } from "react";
import { X } from "lucide-react";
import type { SessionState } from "../../client/realtime/session-state";
import {
  AnswerTile,
  Chrono,
  Classement,
  Explication,
  ListeJoueurs,
  Podium,
  StatutConnexion,
  type LigneClassement,
  type PlacePodium,
} from "../../components/jeu";
import { IconButton } from "../../components/ui/button";
import { EtatErreur } from "../../components/ui/etat-erreur";
import { Papier } from "../../components/ui/papier";
import { Pilule } from "../../components/ui/pilule";
import { Squelette } from "../../components/ui/squelette";
import { FocusTitre } from "../joueur/FocusTitre";
import { CodeQr, TicketCode } from "./CodeEtLien";
import { CompteurReponses } from "./Telecommande";
import { annoncePhase, lettre, libelleParticipants, titreVue, urlJoueur, vueHote, type VueHote } from "./logique";

interface CadreProps {
  titre: string;
  /** Change à chaque phase : le focus revient alors au titre, même quand le titre reste le même (question puis correction). */
  phase?: string;
  onFermer: () => void;
  children: ReactNode;
}

// Le fond forêt vient de data-theme : la projection reste lisible à distance, qu'elle soit en plein écran ou en vue agrandie.
export function Cadre({ titre, phase, onFermer, children }: CadreProps) {
  return (
    <div data-theme="foret" role="dialog" aria-modal="true" aria-label="Projection" className="trame-points fixed inset-0 z-40 overflow-y-auto bg-vert-foret text-creme">
      <div className="mx-auto flex min-h-full w-full max-w-7xl flex-col gap-6 px-4 py-4 lg:px-10 lg:py-8">
        <FocusTitre key={`${phase ?? ""}-${titre}`} selecteur="[data-focus-projection]" />
        <header className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <Pilule variante="soleil" className="border-vert-nuit text-xs">
              Session active
            </Pilule>
            <h1 data-focus-projection tabIndex={-1} className="mt-1 font-affiche text-xl break-words outline-none lg:text-3xl">
              {titre}
            </h1>
          </div>
          <IconButton label="Quitter la projection" icone={<X className="size-5" />} onClick={onFermer} />
        </header>
        {children}
      </div>
    </div>
  );
}

function Salle({ state, code, origine }: { state: SessionState; code: string; origine: string }) {
  const hote = origine.replace(/^https?:\/\//, "");
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="flex flex-col gap-6 lg:col-span-2">
        <TicketCode grand code={code} etiquette={hote ? `Va sur ${hote} et tape :` : "Tape ce code pour rejoindre :"} />
        <div className="flex items-center gap-4">
          <CodeQr url={origine ? urlJoueur(origine, code) : ""} className="w-1/3 lg:w-1/4" />
          <p className="-rotate-2 font-note text-2xl text-jaune-soleil lg:text-3xl">Ou scanne avec ton téléphone !</p>
        </div>
      </div>
      <Papier className="px-4 py-5 text-vert-foret lg:col-span-1">
        <div className="flex items-center justify-between">
          <h2 className="font-affiche text-2xl">Participants</h2>
          <p className="font-affiche text-3xl tabular-nums">{state.playerCount}</p>
        </div>
        {state.players.length === 0 ? (
          <p className="mt-4 font-bold">Personne n'est encore là. Les joueurs apparaissent ici dès qu'ils rejoignent.</p>
        ) : (
          <div className="mt-4">
            <ListeJoueurs players={state.players} max={12} label={libelleParticipants(state.playerCount)} />
          </div>
        )}
      </Papier>
    </div>
  );
}

function Question({ state }: { state: SessionState }) {
  const question = state.question!;
  return (
    <>
      <div className="flex items-center gap-4 lg:gap-8">
        <div className="min-w-0 flex-1">
          <CompteurReponses repondus={state.answeredCount} total={state.playerCount} />
        </div>
        {state.clock ? (
          <div className="rounded-full bg-jaune-soleil text-vert-foret">
            <Chrono key={question.questionId} clock={state.clock} />
          </div>
        ) : null}
      </div>
      <Papier className="my-0 px-4 py-5 text-vert-foret">
        <p className="font-affiche text-2xl break-words lg:text-4xl">{question.prompt}</p>
      </Papier>
      <ul aria-label="Réponses possibles" className="m-0 grid list-none gap-4 p-0 lg:grid-cols-2">
        {question.options.map((option, i) => (
          <li key={option.id}>
            <AnswerTile index={i} letter={lettre(i)} label={option.label} />
          </li>
        ))}
      </ul>
    </>
  );
}

function Correction({ state }: { state: SessionState }) {
  const question = state.question!;
  const reveal = state.reveal;
  const justes = new Set(reveal?.correctOptionIds ?? []);
  const montree = Boolean(reveal?.correctOptionIds);
  const lignes: LigneClassement[] = (reveal?.ranking ?? state.ranking).slice(0, 5).map((l) => ({ playerId: l.playerId, rank: l.rank, pseudo: l.pseudo, score: l.score }));
  return (
    <>
      <Papier className="my-0 px-4 py-5 text-vert-foret">
        <p className="font-affiche text-2xl break-words lg:text-4xl">{question.prompt}</p>
      </Papier>
      <ul aria-label="Réponses" className="m-0 grid list-none gap-4 p-0 lg:grid-cols-2">
        {question.options.map((option, i) => (
          <li key={option.id}>
            <AnswerTile index={i} letter={lettre(i)} label={option.label} state={justes.has(option.id) ? "juste" : montree ? "desactivee" : "repos"} badge={justes.has(option.id) ? "Bonne réponse" : undefined} />
          </li>
        ))}
      </ul>
      {montree ? null : <p className="font-bold">La bonne réponse n'est pas montrée pour ce quiz.</p>}
      <div className="grid gap-6 lg:grid-cols-2">
        <Explication explanation={reveal?.explanation} reference={reveal?.reference} />
        {lignes.length > 0 ? <Classement className="my-3" total={state.totalQuestions ?? question.total} rows={lignes} /> : null}
      </div>
    </>
  );
}

function Libre({ state }: { state: SessionState }) {
  return (
    <>
      <Papier className="my-0 px-4 py-5 text-vert-foret">
        <p className="font-affiche text-2xl lg:text-4xl">Chacun joue à son rythme</p>
        <p className="mt-2 font-bold">Les résultats s'affichent quand l'animateur termine la partie.</p>
      </Papier>
      <div className="lg:max-w-xl">
        <CompteurReponses repondus={state.finishedCount} total={state.playerCount} titre="Ont fini" label="Joueurs ayant fini" />
      </div>
    </>
  );
}

function Fin({ state }: { state: SessionState }) {
  const classement = state.ranking;
  const places: PlacePodium[] = classement.slice(0, 3).map((l) => ({ playerId: l.playerId, rank: l.rank as 1 | 2 | 3, pseudo: l.pseudo }));
  const lignes: LigneClassement[] = classement.slice(3, 10).map((l) => ({ playerId: l.playerId, rank: l.rank, pseudo: l.pseudo, score: l.score }));
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {places.length > 0 ? <Podium places={places} /> : <p className="font-bold">Aucun classement à afficher.</p>}
      {lignes.length > 0 ? <Classement total={state.totalQuestions ?? 0} rows={lignes} /> : null}
    </div>
  );
}

interface VueProps {
  state: SessionState;
  code: string;
  origine: string;
  onFermer: () => void;
}

// Vue lecture seule : aucun bouton de pilotage n'est affiché sur l'écran projeté (seule la sortie de projection l'est).
export function VueProjection({ state, code, origine, onFermer }: VueProps) {
  const vue: VueHote = vueHote(state);
  if (vue === "chargement") {
    return (
      <Cadre titre="Connexion à la partie" onFermer={onFermer}>
        <div aria-busy="true">
          <StatutConnexion status={state.connection} />
          <Squelette className="mt-4 h-scene-basse w-full" />
        </div>
      </Cadre>
    );
  }
  if (vue === "rejete") {
    return (
      <Cadre titre="Projection impossible" onFermer={onFermer}>
        <EtatErreur titre="Projection impossible">Le lien de projection n'est plus valable. Quitte la projection puis relance-la.</EtatErreur>
      </Cadre>
    );
  }
  return (
    <Cadre titre={titreVue(state, vue)} phase={`${vue}-${state.question?.questionId ?? ""}`} onFermer={onFermer}>
      {/* Région persistante : annonce chaque changement de phase sans déplacer le focus. */}
      <p aria-live="polite" className="sr-only">
        {annoncePhase(state, vue)}
      </p>
      <StatutConnexion status={state.connection === "ended" ? "open" : state.connection} />
      {vue === "salle" ? <Salle state={state} code={code} origine={origine} /> : null}
      {vue === "question" ? <Question state={state} /> : null}
      {vue === "correction" ? <Correction state={state} /> : null}
      {vue === "libre" ? <Libre state={state} /> : null}
      {vue === "fin" ? <Fin state={state} /> : null}
      {vue === "termine" ? <p className="font-bold">Cette partie est terminée.</p> : null}
    </Cadre>
  );
}
