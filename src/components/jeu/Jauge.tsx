import { cn } from "../ui/cn";

interface Props {
  value: number;
  max: number;
  // Texte de la barre pour les technologies d'assistance, ex. « Réponses reçues ».
  label: string;
  className?: string;
}

// Compteur de réponses de la télécommande : piste vert nuit, remplissage jaune (lisible sur fond forêt).
export function Jauge({ value, max, label, className }: Props) {
  const part = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={`${value} sur ${max}`}
      className={cn("h-5 overflow-hidden rounded-pill border-trait border-vert-nuit bg-vert-nuit", className)}
    >
      <div className="h-full bg-jaune-soleil transition-all duration-300" style={{ width: `${part}%` }} />
    </div>
  );
}
