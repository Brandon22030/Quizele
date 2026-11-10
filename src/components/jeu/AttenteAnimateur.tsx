import { cn } from "../ui/cn";
import { Rebond } from "./Rebond";

interface Props {
  className?: string;
}

// Écran c : l'animateur n'a pas encore lancé. Explosion crème sur explosion forêt, qui tournent lentement (le CSS les fige
// sous prefers-reduced-motion) ; overflow-hidden car la boîte tournée déborde de la largeur de l'écran sans que la forme y touche.
export function AttenteAnimateur({ className }: Props) {
  return (
    <div className={cn("relative grid h-scene place-items-center overflow-hidden", className)}>
      <div aria-hidden="true" className="forme-explosion absolute size-scene animate-tourne bg-vert-foret" />
      <div aria-hidden="true" className="forme-explosion absolute size-scene-coeur animate-tourne bg-creme" />
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
