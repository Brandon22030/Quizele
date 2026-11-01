import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { cn } from "../ui/cn";

export type AnswerTileState = "repos" | "choisie" | "juste" | "taReponse" | "desactivee";

interface Props {
  letter: string;
  // Rang de la tuile : l'alternance de couleur de la lettre suit la position, pas la lettre affichée.
  index?: number;
  label: string;
  state?: AnswerTileState;
  // Sans onSelect, la tuile est une simple restitution (correction) et n'est pas focusable.
  onSelect?: () => void;
  // Remplace le libellé de la pastille de l'état.
  badge?: string;
  className?: string;
}

const base =
  "flex min-h-16 w-full items-center gap-4 rounded-md border-trait border-vert-foret py-2 pr-4 pl-2 text-left text-lg leading-snug font-extrabold";

const tuile: Record<AnswerTileState, string> = {
  repos: "bg-creme text-vert-foret shadow-relief",
  choisie: "-translate-x-1 translate-y-1 bg-vert-foret text-creme shadow-relief-appui",
  juste: "bg-vert-eclat text-vert-nuit shadow-relief",
  taReponse: "border-dashed bg-creme text-vert-foret",
  desactivee: "border-dashed bg-creme text-vert-mousse",
};

const pastille: Partial<Record<AnswerTileState, { texte: string; classes: string; coche: boolean }>> = {
  choisie: { texte: "Ton choix", classes: "bg-jaune-soleil text-vert-foret", coche: true },
  juste: { texte: "Bonne réponse", classes: "bg-vert-nuit text-vert-eclat", coche: true },
  taReponse: { texte: "Ta réponse", classes: "bg-piment text-creme", coche: false },
};

// Alternance de la couleur de la lettre comme dans la maquette : les tuiles en 2e et 4e position (B, D) sont jaunes au repos.
function lettreClasses(state: AnswerTileState, jaune: boolean): string {
  if (state === "choisie") return "bg-jaune-soleil text-vert-foret";
  if (state === "juste") return "bg-vert-nuit text-vert-eclat";
  if (state === "taReponse" || state === "desactivee") return "border-trait border-dashed border-vert-foret bg-creme text-vert-foret";
  return jaune ? "border-trait border-vert-foret bg-jaune-soleil text-vert-foret" : "bg-vert-foret text-jaune-soleil";
}

export function AnswerTile({ letter, index = 0, label, state = "repos", onSelect, badge, className }: Props) {
  const jaune = index % 2 === 1;
  const interactive = Boolean(onSelect) && (state === "repos" || state === "choisie" || state === "desactivee");
  const infoPastille = pastille[state];
  const contenu: ReactNode = (
    <>
      <span
        aria-hidden="true"
        className={cn("grid size-12 flex-none place-items-center rounded-sm font-affiche text-xl", lettreClasses(state, jaune))}
      >
        {letter}
      </span>
      <span className="min-w-0 flex-1 break-words">{label}</span>
      {infoPastille ? (
        <span
          className={cn(
            "ml-auto inline-flex flex-none items-center gap-1 rounded-pill px-2 py-1 text-xs font-extrabold",
            infoPastille.classes,
          )}
        >
          {infoPastille.coche ? <Check aria-hidden="true" className="size-4" strokeWidth={3} /> : null}
          {badge ?? infoPastille.texte}
        </span>
      ) : null}
    </>
  );
  const classes = cn(base, tuile[state], className);

  if (!interactive) {
    return <div className={classes}>{contenu}</div>;
  }
  return (
    <button
      type="button"
      aria-pressed={state === "choisie"}
      disabled={state === "desactivee"}
      onClick={onSelect}
      className={cn(
        classes,
        state === "desactivee" ? "cursor-not-allowed" : "cursor-pointer transition-all duration-100",
        state === "repos" && "active:-translate-x-1 active:translate-y-1 active:shadow-relief-appui",
      )}
    >
      {contenu}
    </button>
  );
}

interface ListeProps {
  label: string;
  className?: string;
  children: ReactNode;
}

// Marge gauche plus large que la droite : le relief des tuiles déborde vers la gauche.
export function AnswerList({ label, className, children }: ListeProps) {
  return (
    <div role="group" aria-label={label} className={cn("flex flex-col gap-4 pt-8 pr-4 pb-4 pl-6", className)}>
      {children}
    </div>
  );
}
