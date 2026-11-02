import { Button } from "../ui/button";
import { cn } from "../ui/cn";
import { Rebond } from "./Rebond";

const encart = "rounded-md border-trait border-vert-foret bg-creme p-4 text-center shadow-relief-sm";

interface EnregistreeProps {
  // La région role=status reste dans le DOM : seul son contenu apparaît, ce qui garantit l'annonce.
  active?: boolean;
  // Texte sous le titre : avant la révélation, « à la fin de la partie » serait faux quand la correction est visible.
  detail?: string;
  className?: string;
}

// Correction masquée par l'animateur : rien, ici, ne doit laisser deviner si la réponse était juste.
export function ReponseEnregistree({ active = true, detail = "La correction arrive à la fin de la partie.", className }: EnregistreeProps) {
  return (
    <div role="status" className={className}>
      {active ? (
        <div className={encart}>
          {/* Cible du focus quand l'écran change : tabIndex -1 le rend focalisable par script sans l'ajouter à l'ordre de tabulation. */}
          <h2 tabIndex={-1} data-focus-titre="" className="font-affiche text-xl">
            Réponse enregistrée
          </h2>
          <p className="mt-1 flex items-center justify-center gap-2 text-sm font-semibold text-vert-mousse">
            <Rebond taille="petit" />
            {detail}
          </p>
        </div>
      ) : null}
    </div>
  );
}

interface ValidationProps {
  selectedCount: number;
  onValidate: () => void;
  className?: string;
}

// Question à plusieurs bonnes réponses : rien n'est envoyé tant que le joueur ne valide pas.
export function ValidationMultiple({ selectedCount, onValidate, className }: ValidationProps) {
  const vide = selectedCount === 0;
  const pluriel = selectedCount > 1 ? "s" : "";
  return (
    <div className={cn(encart, className)}>
      <p className="font-bold">{vide ? "Sélectionne une ou plusieurs réponses." : `${selectedCount} réponse${pluriel} sélectionnée${pluriel}.`}</p>
      <Button bloc disabled={vide} onClick={onValidate} className="mt-3">
        Valider la sélection
      </Button>
    </div>
  );
}

export function AttenteQuestionSuivante({ className }: { className?: string }) {
  return (
    <p role="status" className={cn("flex items-center justify-center gap-2 text-sm font-semibold text-vert-mousse", className)}>
      <Rebond taille="petit" />
      En attente de la question suivante…
    </p>
  );
}
