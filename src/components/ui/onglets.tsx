import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "./cn";

export interface Onglet {
  id: string;
  label: string;
}

/** Index de l'onglet visé par une touche de navigation (modèle WAI-ARIA des onglets, bouclage inclus). */
export function ongletCible(touche: string, courant: number, total: number): number | null {
  switch (touche) {
    case "ArrowRight":
      return (courant + 1) % total;
    case "ArrowLeft":
      return (courant - 1 + total) % total;
    case "Home":
      return 0;
    case "End":
      return total - 1;
    default:
      return null;
  }
}

interface OngletsProps {
  onglets: Onglet[];
  label: string;
  valeur?: string;
  defaultValeur?: string;
  onChange?: (id: string) => void;
  /** Fonction qui rend le contenu du panneau actif ; reçoit les attributs ARIA à poser sur le panneau. */
  children?: (actif: string, panneau: { id: string; role: "tabpanel"; "aria-labelledby": string; tabIndex: 0 }) => ReactNode;
  className?: string;
}

export function Onglets({ onglets, label, valeur, defaultValeur, onChange, children, className }: OngletsProps) {
  const base = useId();
  const [interne, setInterne] = useState(defaultValeur ?? onglets[0]?.id ?? "");
  const actif = valeur ?? interne;
  const boutons = useRef<(HTMLButtonElement | null)[]>([]);

  function activer(id: string) {
    setInterne(id);
    onChange?.(id);
  }

  function surTouche(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    const cible = ongletCible(e.key, index, onglets.length);
    if (cible === null) return;
    e.preventDefault();
    boutons.current[cible]?.focus();
    activer(onglets[cible].id);
  }

  return (
    <div className={className}>
      <div
        role="tablist"
        aria-label={label}
        className="flex gap-1 rounded-pill border-trait border-vert-foret bg-creme p-1 foret:border-vert-nuit"
      >
        {onglets.map((onglet, index) => {
          const selectionne = onglet.id === actif;
          return (
            <button
              key={onglet.id}
              ref={(el) => {
                boutons.current[index] = el;
              }}
              type="button"
              role="tab"
              id={`${base}-onglet-${onglet.id}`}
              aria-selected={selectionne}
              aria-controls={`${base}-panneau`}
              // Roving tabindex : un seul onglet dans l'ordre de tabulation, les flèches font le reste.
              tabIndex={selectionne ? 0 : -1}
              onClick={() => activer(onglet.id)}
              onKeyDown={(e) => surTouche(e, index)}
              className={cn(
                "grid min-h-11 flex-1 place-items-center rounded-pill px-3 font-extrabold",
                selectionne ? "bg-vert-foret text-jaune-soleil" : "text-vert-foret",
                "foret:focus-visible:outline-jaune-soleil",
              )}
            >
              {onglet.label}
            </button>
          );
        })}
      </div>
      {children
        ? children(actif, { id: `${base}-panneau`, role: "tabpanel", "aria-labelledby": `${base}-onglet-${actif}`, tabIndex: 0 })
        : null}
    </div>
  );
}
