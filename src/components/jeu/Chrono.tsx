import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { QuestionClock } from "../../shared/clock";
import { announcementFor, chronoLevel, secondsLeft, startChronoTicker, type ChronoLevel } from "./chrono-state";
import { cn } from "../ui/cn";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";

interface Props {
  // Horloge de l'état de session (calée sur startedAt et serverNow reçus du Durable Object).
  clock: QuestionClock;
  // Appelé une seule fois par horloge : la correction arrive du serveur environ 2 s plus tard (tolérance de réponse).
  onExpire?: () => void;
  className?: string;
}

const coeur: Record<ChronoLevel, string> = {
  calme: "bg-creme text-vert-foret",
  attention: "bg-mangue text-vert-nuit",
  critique: "bg-piment text-creme",
};

// Affichage seulement : le Durable Object reste seul juge du délai.
export function Chrono({ clock, onExpire, className }: Props) {
  const reduced = usePrefersReducedMotion();
  // Durée totale = déjà écoulé + restant, constante pour une horloge donnée.
  const durationMs = clock.remaining() + clock.elapsed();
  const [remaining, setRemaining] = useState(() => clock.remaining());
  const [announcement, setAnnouncement] = useState(() => announcementFor(clock.remaining()));
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  useEffect(
    () =>
      startChronoTicker(clock, {
        onTick: (left, next) => {
          setRemaining(left);
          if (next) setAnnouncement(next);
        },
        onExpire: () => onExpireRef.current?.(),
      }),
    [clock],
  );

  const level = chronoLevel(remaining);
  const expired = remaining <= 0;
  const seconds = secondsLeft(remaining);
  const progression = durationMs > 0 ? Math.max(0, Math.min(100, (remaining / durationMs) * 100)) : 0;

  return (
    <div
      role="timer"
      aria-label={expired ? "Temps écoulé" : `${seconds} secondes restantes`}
      className={cn("relative size-chrono flex-none", className)}
    >
      <div
        aria-hidden="true"
        data-niveau={level}
        className="anneau-chrono absolute inset-0 rounded-full"
        style={{ "--progression": progression } as CSSProperties}
      />
      <div
        aria-hidden="true"
        className={cn("forme-explosion absolute inset-3 bg-vert-foret", level === "critique" && !expired && !reduced && "animate-tremble")}
      >
        <span className={cn("forme-explosion absolute inset-1 grid place-items-center", coeur[level])}>
          {expired ? (
            <b className="px-2 text-center font-affiche text-sm leading-tight">Temps écoulé</b>
          ) : (
            <b className="font-affiche text-3xl leading-none tabular-nums">
              {seconds}
              <small className="text-lg">s</small>
            </b>
          )}
        </span>
      </div>
      <p role="status" className="sr-only">
        {announcement.text}
      </p>
    </div>
  );
}
