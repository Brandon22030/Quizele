import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import { localNow } from "../../shared/clock";
import { announcementFor, chronoLevel, initialRemainingMs, secondsLeft, startChronoTicker, type ChronoLevel } from "./chrono-state";
import { cx } from "./cx";

interface Props {
  startedAt: number;
  serverNow: number;
  durationMs: number;
  // Appelé une seule fois : la correction arrive du serveur environ 2 s plus tard (tolérance de réponse).
  onExpire?: () => void;
  // Horloge locale injectable pour les tests et le styleguide.
  now?: () => number;
  className?: string;
}

const coeur: Record<ChronoLevel, string> = {
  calme: "bg-creme text-vert-foret",
  attention: "bg-mangue text-vert-nuit",
  critique: "bg-piment text-creme",
};

const piste = "color-mix(in srgb, var(--color-vert-foret) 15%, transparent)";

// Affichage seulement : le Durable Object reste seul juge du délai.
export function Chrono({ startedAt, serverNow, durationMs, onExpire, now = localNow, className }: Props) {
  const reduced = useReducedMotion();
  const [remaining, setRemaining] = useState(() => initialRemainingMs(startedAt, serverNow, durationMs));
  const [announcement, setAnnouncement] = useState(() => announcementFor(initialRemainingMs(startedAt, serverNow, durationMs)));
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  useEffect(
    () =>
      startChronoTicker({ startedAt, serverNow, durationMs }, now, {
        onTick: (left, next) => {
          setRemaining(left);
          if (next) setAnnouncement(next);
        },
        onExpire: () => onExpireRef.current?.(),
      }),
    [startedAt, serverNow, durationMs, now],
  );

  const level = chronoLevel(remaining);
  const expired = remaining <= 0;
  const seconds = secondsLeft(remaining);
  const percent = Math.max(0, Math.min(100, durationMs > 0 ? (remaining / durationMs) * 100 : 0));
  const couleurAnneau = level === "critique" ? "var(--color-piment)" : "var(--color-vert-foret)";

  return (
    <div
      role="timer"
      aria-label={expired ? "Temps écoulé" : `${seconds} secondes restantes`}
      className={cx("relative size-33 flex-none", className)}
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 rounded-full"
        style={{
          background: `conic-gradient(${couleurAnneau} ${percent}%, ${piste} 0)`,
          mask: "radial-gradient(closest-side, transparent 78%, var(--color-vert-foret) 79%)",
          WebkitMask: "radial-gradient(closest-side, transparent 78%, var(--color-vert-foret) 79%)",
        }}
      />
      <div
        aria-hidden="true"
        className={cx("forme-explosion absolute inset-3.5 bg-vert-foret", level === "critique" && !expired && !reduced && "animate-tremble")}
      >
        <span className={cx("forme-explosion absolute inset-1 grid place-items-center", coeur[level])}>
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
