import { Rebond } from "./Rebond";
import { Bouton } from "./Bouton";
import { TRAIT, cx } from "./cx";

const encart = "rounded-md border-vert-foret bg-creme p-4 text-center shadow-relief-sm";

// Correction masquée par l'animateur : rien, ici, ne doit laisser deviner si la réponse était juste.
export function ReponseEnregistree({ className }: { className?: string }) {
  return (
    <div role="status" className={cx(encart, TRAIT, className)}>
      <p className="font-affiche text-xl">Réponse enregistrée</p>
      <p className="mt-1 flex items-center justify-center gap-2 text-sm font-semibold text-vert-mousse">
        <Rebond className="scale-60" />
        La correction arrive à la fin de la partie.
      </p>
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
  return (
    <div className={cx(encart, TRAIT, className)}>
      <p className="font-bold">
        {vide ? "Sélectionne une ou plusieurs réponses." : `${selectedCount} réponse${selectedCount > 1 ? "s" : ""} sélectionnée${selectedCount > 1 ? "s" : ""}.`}
      </p>
      <Bouton bloc disabled={vide} onClick={onValidate} className="mt-3">
        Valider la sélection
      </Bouton>
    </div>
  );
}

export function AttenteQuestionSuivante({ className }: { className?: string }) {
  return (
    <p role="status" className={cx("flex items-center justify-center gap-2 text-sm font-semibold text-vert-mousse", className)}>
      <Rebond className="scale-60" />
      En attente de la question suivante…
    </p>
  );
}
