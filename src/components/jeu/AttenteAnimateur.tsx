import { useReducedMotion } from "motion/react";
import { cx } from "./cx";
import { Rebond } from "./Rebond";

interface Props {
  className?: string;
}

// Écran c : l'animateur n'a pas encore lancé. Explosion crème sur explosion forêt, qui tournent lentement ;
// overflow-hidden car la boîte tournée déborde de la largeur de l'écran sans que la forme y touche.
export function AttenteAnimateur({ className }: Props) {
  const reduced = useReducedMotion();
  const rotation = !reduced && "animate-tourne";
  return (
    <div className={cx("relative grid h-75 place-items-center overflow-hidden", className)}>
      <div aria-hidden="true" className={cx("forme-explosion absolute size-75 bg-vert-foret", rotation)} />
      <div aria-hidden="true" className={cx("forme-explosion absolute size-71 bg-creme", rotation)} />
      <div className="relative text-center">
        <p className="-rotate-5 font-badge text-2xl leading-none tracking-wider">
          EN ATTENTE
          <br />
          DE L'ANIMATEUR
        </p>
        <Rebond className="mt-4" />
      </div>
    </div>
  );
}
