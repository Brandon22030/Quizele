import { Suspense, lazy, useState, type ReactNode } from "react";
import { Users } from "lucide-react";
import type { SessionState } from "../../client/realtime/session-state";
import {
  AnswerList,
  AnswerTile,
  AttenteAnimateur,
  AttenteQuestionSuivante,
  Chrono,
  EcranJeu,
  EnonceQuestion,
  EnteteQuestion,
  Explication,
  PuceJoueur,
  PuceReste,
  ReponseEnregistree,
  StatutConnexion,
  ValidationMultiple,
} from "../../components/jeu";
import { Button } from "../../components/ui/button";
import { Papier } from "../../components/ui/papier";
import { Pilule } from "../../components/ui/pilule";
import { Rebond } from "../../components/jeu/Rebond";
import { Squelette } from "../../components/ui/squelette";
import { Resultat } from "./Resultat";
import { urlRejoindre } from "./jeton";

// Verdict embarque motion : chargé à la demande, hors du paquet de l'écran d'attente et de question.
const Verdict = lazy(() => import("../../components/jeu/Verdict").then((m) => ({ default: m.Verdict })));

export interface ChoixLocal {
  questionId: string;
  optionIds: string[];
}

interface VueProps {
  code: string;
  state: SessionState;
  total: number;
  choixLocal: ChoixLocal | null;
  onAnswer: (questionId: string, optionIds: string[]) => void;
  onNext: () => void;
}

const lettres = "ABCDEFGH";

function Cadre({ children }: { children: ReactNode }) {
  return (
    <EcranJeu>
      <div className="mx-auto max-w-ecran">{children}</div>
    </EcranJeu>
  );
}

// Chargement : connexion en cours, avant le premier instantané de la partie.
export function VueChargement({ code, status = "connecting" }: { code: string; status?: SessionState["connection"] }) {
  return (
    <Cadre>
      <div aria-busy="true" className="px-4 pt-2">
        <StatutConnexion status={status} rejoindreHref={urlRejoindre(code)} />
        <h1 className="sr-only">Connexion à la partie</h1>
        <div className="flex items-center justify-between pt-2">
          <Squelette className="h-10 w-2/3 rounded-pill" />
          <Squelette className="h-10 w-1/4 rounded-pill" />
        </div>
        <Squelette className="mt-8 h-scene-basse w-full" />
        <Squelette className="mt-8 h-16 w-full" />
        <Squelette className="mt-4 h-16 w-full" />
        <Squelette className="mt-4 h-16 w-full" />
      </div>
    </Cadre>
  );
}

export function VueJoueur({ code, state, total, choixLocal, onAnswer, onNext }: VueProps) {
  const terminal = state.connection === "kicked" || state.connection === "ended" || state.connection === "rejected";
  // La fin de partie close parfois la connexion (« ended ») : le résultat reçu reste à afficher.
  const resultatRecu = state.connection === "ended" && state.phase === "finished";
  if (terminal && !resultatRecu) {
    return (
      <Cadre>
        <StatutConnexion status={state.connection} rejoindreHref={state.connection === "rejected" ? urlRejoindre(code) : "/"} />
      </Cadre>
    );
  }
  if (state.phase === null) return <VueChargement code={code} status={state.connection} />;

  const statut = <StatutConnexion status={state.connection} rejoindreHref={urlRejoindre(code)} className="px-4 pt-2" />;
  const question = state.question;
  const choix = choixPour(state, choixLocal);

  let contenu: ReactNode;
  if (state.phase === "finished") {
    contenu = <Resultat state={state} total={total} />;
  } else if (state.phase === "question" && question) {
    contenu = <EcranQuestion key={question.questionId} state={state} choix={choix} onAnswer={onAnswer} />;
  } else if (state.phase === "revealed" && question) {
    contenu = <EcranCorrection state={state} choix={choix} onNext={onNext} />;
  } else if (state.phase === "waiting") {
    contenu = <EcranFinPerso />;
  } else {
    contenu = <SalleAttente state={state} />;
  }

  return (
    <Cadre>
      {statut}
      {contenu}
    </Cadre>
  );
}

// Le message `question` remet answeredOptionIds à zéro et `answer_ack` ne le renseigne pas : le choix envoyé est gardé localement.
function choixPour(state: SessionState, local: ChoixLocal | null): string[] {
  if (state.answeredOptionIds.length > 0) return state.answeredOptionIds;
  return local && local.questionId === state.question?.questionId ? local.optionIds : [];
}

function SalleAttente({ state }: { state: SessionState }) {
  const autres = Math.max(0, state.playerCount - 1);
  return (
    <>
      <header className="flex items-center justify-between gap-2 px-4 pt-2">
        <Pilule variante="foret" className="min-w-0">
          <span className="truncate">{state.title}</span>
        </Pilule>
        {state.me ? <Pilule variante="creme">{state.me.pseudo}</Pilule> : null}
      </header>
      <h1 className="sr-only">Salle d'attente</h1>
      <AttenteAnimateur className="mt-4" />
      <p className="px-6 pt-4 text-center font-bold">C'est bon, tu es dans la partie. L'animateur lancera les questions.</p>
      <Papier className="mx-4 mt-8 px-4 py-5">
        <div className="flex items-center justify-between">
          <h2 className="font-affiche text-xl">Joueurs</h2>
          <Pilule variante="foret">
            <Users aria-hidden="true" className="size-5" />
            <span className="sr-only">Joueurs dans la salle : </span>
            {Math.max(state.playerCount, 1)}
          </Pilule>
        </div>
        {autres === 0 ? (
          <p className="mt-4 font-bold">Tu es le premier arrivé. Les autres joueurs te rejoindront avec le même code.</p>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-2">
          {state.me ? <PuceJoueur pseudo={state.me.pseudo} nouveau /> : null}
          {autres > 0 ? <PuceReste count={autres} /> : null}
        </div>
      </Papier>
      <p className="mt-8 -rotate-2 text-center font-note text-xl">Prépare ta Bible et ton meilleur sourire !</p>
    </>
  );
}

function EcranFinPerso() {
  return (
    <section className="px-4 pt-8 text-center">
      <h1 className="font-affiche text-2xl">Tu as terminé !</h1>
      <Papier className="mt-6 px-4 py-5">
        <p role="status" className="flex items-center justify-center gap-2 font-bold">
          <Rebond taille="petit" />
          On attend les autres joueurs pour afficher les résultats.
        </p>
      </Papier>
    </section>
  );
}

interface QuestionProps {
  state: SessionState;
  choix: string[];
  onAnswer: (questionId: string, optionIds: string[]) => void;
}

// Écran d : `key={questionId}` remet à zéro la sélection et l'état « temps écoulé » à chaque question.
function EcranQuestion({ state, choix, onAnswer }: QuestionProps) {
  const question = state.question!;
  const [selection, setSelection] = useState<string[]>([]);
  const [ecoule, setEcoule] = useState(false);
  const repondu = state.answered || choix.length > 0;
  const options = question.options.map((option, i) => ({ ...option, lettre: lettres[i] ?? "?", index: i }));

  const envoyer = (ids: string[]) => onAnswer(question.questionId, ids);
  const toucher = (id: string) => {
    if (question.kind === "multiple") setSelection((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
    else envoyer([id]);
  };

  if (repondu) {
    const mesChoix = options.filter((o) => choix.includes(o.id));
    return (
      <>
        <EnteteQuestion index={question.index + 1} total={question.total} score={state.me?.score} />
        <h1 className="sr-only">{question.prompt}</h1>
        <div className="px-4 pt-6">
          <AnswerList label="Ta réponse" className="pt-0">
            {mesChoix.map((o) => (
              <AnswerTile key={o.id} index={o.index} letter={o.lettre} label={o.label} state="choisie" />
            ))}
          </AnswerList>
          <ReponseAttente />
          {state.lateAnswer ? (
            <p role="status" className="mt-3 text-center text-sm font-bold">
              Ta réponse est arrivée après la fin du temps.
            </p>
          ) : null}
        </div>
      </>
    );
  }

  return (
    <>
      <EnteteQuestion index={question.index + 1} total={question.total} score={state.me?.score} />
      <div className="flex items-center gap-4 px-4 pt-4">
        {state.clock ? <Chrono clock={state.clock} onExpire={() => setEcoule(true)} /> : null}
        <p className="-rotate-3 font-note text-xl leading-tight">
          {ecoule ? (
            "Trop tard, la correction arrive."
          ) : (
            <>
              Choisis vite,
              <br />
              le chrono tourne !
            </>
          )}
        </p>
      </div>
      <EnonceQuestion prompt={question.prompt} kind={question.kind} />
      <AnswerList label="Réponses">
        {options.map((o) => (
          <AnswerTile
            key={o.id}
            index={o.index}
            letter={o.lettre}
            label={o.label}
            state={ecoule ? "desactivee" : selection.includes(o.id) ? "choisie" : "repos"}
            onSelect={ecoule ? undefined : () => toucher(o.id)}
          />
        ))}
      </AnswerList>
      {question.kind === "multiple" && !ecoule ? (
        <div className="px-4">
          <ValidationMultiple selectedCount={selection.length} onValidate={() => envoyer(selection)} />
        </div>
      ) : null}
    </>
  );
}

// Avant la révélation, rien ne dit si la réponse est juste ; ni le texte ni le score n'en laissent deviner la justesse.
function ReponseAttente() {
  return (
    <div role="status">
      <div className="mt-4 rounded-md border-trait border-vert-foret bg-creme p-4 text-center shadow-relief-sm">
        <p className="font-affiche text-xl">Réponse enregistrée</p>
        <p className="mt-1 flex items-center justify-center gap-2 text-sm font-semibold text-vert-mousse">
          <Rebond taille="petit" />
          On attend la suite de la partie.
        </p>
      </div>
    </div>
  );
}

interface CorrectionProps {
  state: SessionState;
  choix: string[];
  onNext: () => void;
}

function EcranCorrection({ state, choix, onNext }: CorrectionProps) {
  const question = state.question!;
  const reveal = state.reveal;
  const libre = state.mode === "own_pace";
  const derniere = question.index + 1 >= question.total;
  const suite = libre ? (
    <Button bloc onClick={onNext} className="mt-4">
      {derniere ? "Voir mon résultat" : "Question suivante"}
    </Button>
  ) : (
    <AttenteQuestionSuivante />
  );
  const options = question.options.map((option, i) => ({ ...option, lettre: lettres[i] ?? "?", index: i }));

  // Sans bonne réponse dans le message (correction masquée), l'écran se limite à l'accusé de réception.
  if (!reveal?.correctOptionIds || !reveal.you) {
    const mesChoix = options.filter((o) => choix.includes(o.id));
    return (
      <>
        <EnteteQuestion index={question.index + 1} total={question.total} />
        <h1 className="sr-only">Réponse enregistrée</h1>
        <div className="px-4 pt-6">
          {mesChoix.length > 0 ? (
            <AnswerList label="Ta réponse" className="pt-0">
              {mesChoix.map((o) => (
                <AnswerTile key={o.id} index={o.index} letter={o.lettre} label={o.label} state="choisie" />
              ))}
            </AnswerList>
          ) : null}
          <ReponseEnregistree className="mt-4" />
          {libre ? suite : null}
        </div>
      </>
    );
  }

  const justes = new Set(reveal.correctOptionIds);
  const correct = reveal.you.wasCorrect;
  const pseudo = state.me?.pseudo ?? "";
  const message = correct
    ? `+1 bonne réponse. Bien joué${pseudo ? `, ${pseudo}` : ""} !`
    : choix.length === 0
      ? "Tu n'as pas répondu à temps. Tu retiens la bonne pour la prochaine."
      : "Pas de panique, tu retiens la bonne pour la prochaine.";
  const tuiles = options.filter((o) => justes.has(o.id) || choix.includes(o.id));

  return (
    <>
      <h1 className="sr-only">Correction</h1>
      <Suspense fallback={<VerdictStatique correct={correct} message={message} />}>
        <Verdict correct={correct} message={message} />
      </Suspense>
      <div className="flex flex-col gap-4 px-4 pt-6">
        {tuiles.map((o) => (
          <AnswerTile
            key={o.id}
            index={o.index}
            letter={o.lettre}
            label={o.label}
            state={justes.has(o.id) ? "juste" : "taReponse"}
          />
        ))}
        <Explication explanation={reveal.explanation} reference={reveal.reference} />
        {suite}
      </div>
    </>
  );
}

// Affichage pendant le chargement du module d'animation : le résultat est lisible tout de suite, sans effet.
function VerdictStatique({ correct, message }: { correct: boolean; message: string }) {
  return (
    <section aria-label="Verdict" className="px-6 pt-8 text-center">
      <p role="heading" aria-level={2} className="font-badge text-4xl tracking-wider">
        {correct ? "JUSTE !" : "PAS CETTE FOIS !"}
      </p>
      <p className="mt-4 font-affiche text-xl">{message}</p>
    </section>
  );
}
