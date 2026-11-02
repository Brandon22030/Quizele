import { useEffect, useState } from "react";
import { Play, Timer } from "lucide-react";
import type { SessionState } from "../../client/realtime/session-state";
import { Jauge } from "../../components/jeu";
import { chronoLevel, chronoSnapshot, secondsLeft, startChronoTicker } from "../../components/jeu/chrono-state";
import { Button } from "../../components/ui/button";
import { Papier } from "../../components/ui/papier";
import { Pilule } from "../../components/ui/pilule";
import type { QuestionClock } from "../../shared/clock";
import { cn } from "../../components/ui/cn";
import { bonnesReponses, commandesDisponibles, libelleDemarrer, libelleFinis, libelleSuivante, libelleTerminer } from "./logique";

interface CommandesProps {
  state: SessionState;
  onDemarrer: () => void;
  onReveler: () => void;
  onSuivante: () => void;
  onTerminer: () => void;
}

// Barre de commandes collée en bas : au pouce, sur toutes les phases (maquettes g et k8).
export function BarreCommandes({ state, onDemarrer, onReveler, onSuivante, onTerminer }: CommandesProps) {
  const ok = commandesDisponibles(state);
  const phase = state.phase;
  const ensemble = state.mode !== "own_pace";
  const enJeu = phase === "question" || phase === "revealed";
  return (
    <div className="sticky bottom-0 mt-6 bg-vert-foret">
      <div aria-hidden="true" className="h-trait bg-creme/50" />
      <div className="flex flex-col gap-3 px-4 pt-4 pb-6">
        {phase === "lobby" ? (
          <Button bloc variante="soleil" disabled={!ok.demarrer} onClick={onDemarrer}>
            <Play aria-hidden="true" className="size-5" />
            {libelleDemarrer(state)}
          </Button>
        ) : null}
        {ensemble && enJeu ? (
          <>
            <Button bloc variante="soleil" disabled={!ok.reveler} onClick={onReveler}>
              Révéler la réponse
            </Button>
            <Button bloc variante="soleil" disabled={!ok.suivante} onClick={onSuivante}>
              {libelleSuivante(state)}
            </Button>
          </>
        ) : null}
        {phase !== "finished" ? (
          <Button bloc taille="petit" variante={ensemble && !enJeu && phase !== "lobby" ? "soleil" : "creme"} disabled={!ok.terminer} onClick={onTerminer}>
            {libelleTerminer(state)}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

// Une pastille par question : faites en jaune, en cours en crème, à venir en crème atténuée (décor, la progression est dite en texte).
export function SegmentsProgression({ index, total }: { index: number; total: number }) {
  return (
    <div aria-hidden="true" className="flex gap-1">
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={cn("h-2 flex-1 rounded-pill", i < index ? "bg-jaune-soleil" : i === index ? "bg-creme" : "bg-creme/25")} />
      ))}
    </div>
  );
}

// Chrono compact de la télécommande : même horloge (startedAt + serverNow) que le grand chrono, sans annonce vocale
// chaque seconde. L'animateur n'a pas besoin d'être interrompu pendant qu'il pilote.
export function PuceChrono({ clock }: { clock: QuestionClock }) {
  const [snap, setSnap] = useState(() => chronoSnapshot(clock));
  if (snap.clock !== clock) setSnap(chronoSnapshot(clock));
  useEffect(
    () =>
      startChronoTicker(clock, {
        onTick: (left) => setSnap((prev) => (prev.clock === clock ? { ...prev, remaining: left } : prev)),
      }),
    [clock],
  );
  const niveau = chronoLevel(snap.remaining);
  return (
    <Pilule
      variante="creme"
      role="timer"
      aria-label={snap.remaining <= 0 ? "Temps écoulé" : `${secondsLeft(snap.remaining)} secondes restantes`}
      className={cn(niveau === "critique" && "bg-piment text-creme", niveau === "attention" && "bg-mangue text-vert-nuit")}
    >
      <Timer aria-hidden="true" className="size-5" />
      {snap.remaining <= 0 ? "Terminé" : `${secondsLeft(snap.remaining)} s`}
    </Pilule>
  );
}

interface CompteurProps {
  repondus: number;
  total: number;
  titre?: string;
  label?: string;
}

export function CompteurReponses({ repondus, total, titre = "Ont répondu", label = "Réponses reçues" }: CompteurProps) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <p className="font-affiche text-lg">{titre}</p>
        <p className="font-affiche text-3xl tabular-nums text-jaune-soleil">
          {repondus}
          <span className="text-xl text-creme"> / {total}</span>
        </p>
      </div>
      <Jauge className="mt-2" value={repondus} max={total} label={label} />
    </div>
  );
}

export function TelecommandeQuestion({ state }: { state: SessionState }) {
  const question = state.question!;
  const revele = state.phase === "revealed";
  const justes = bonnesReponses(state);
  return (
    <>
      <div className="px-4 pt-3">
        <div className="flex items-center justify-between gap-3">
          <h1 data-focus-titre tabIndex={-1} className="font-affiche text-lg text-jaune-soleil outline-none">
            Question {question.index + 1} sur {question.total}
          </h1>
          {!revele && state.clock ? <PuceChrono clock={state.clock} /> : null}
        </div>
        <div className="mt-3">
          <SegmentsProgression index={question.index} total={question.total} />
        </div>
      </div>
      <Papier className="mx-4 mt-6 px-4 py-4">
        <p className="font-affiche text-xl break-words">{question.prompt}</p>
        {revele && justes.length > 0 ? (
          <p className="mt-2 text-sm font-bold text-vert-mousse">
            {justes.length > 1 ? "Bonnes réponses : " : "Bonne réponse : "}
            <b className="text-vert-foret">{justes.join(" ; ")}</b> (visible par toi seul)
          </p>
        ) : null}
      </Papier>
      <div className="px-4 pt-6">
        <CompteurReponses repondus={state.answeredCount} total={state.playerCount} />
        <p className="mt-3 text-sm font-semibold">
          {revele
            ? "Les joueurs voient la correction. Passe à la suite quand tu es prêt."
            : "Le grand écran montre la question et le chrono. Les joueurs voient la correction quand tu la révèles."}
        </p>
      </div>
    </>
  );
}

export function TelecommandeLibre({ state }: { state: SessionState }) {
  return (
    <section className="px-4 pt-3">
      <h1 data-focus-titre tabIndex={-1} className="font-affiche text-lg text-jaune-soleil outline-none">
        Partie en cours
      </h1>
      <Papier className="mt-6 px-4 py-4">
        <p className="font-affiche text-xl">Chacun avance à son rythme</p>
        <p className="mt-2 text-sm font-bold text-vert-mousse">Termine la partie quand tu veux : les joueurs voient alors leur résultat.</p>
      </Papier>
      <div className="mt-6">
        <CompteurReponses repondus={state.finishedCount} total={state.playerCount} titre="Ont fini" label="Joueurs ayant fini" />
        <p className="mt-3 text-sm font-semibold">{libelleFinis(state.finishedCount, state.playerCount)}.</p>
      </div>
    </section>
  );
}
