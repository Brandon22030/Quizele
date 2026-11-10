import { useLayoutEffect, useRef } from "react";
import { Check, X } from "lucide-react";
import { cn } from "../../components/ui/cn";
import { OPTION_LABEL_MAX } from "../../shared/quiz-schema";

interface Props {
  index: number;
  label: string;
  isCorrect: boolean;
  // Vrai/faux : les libellés sont figés, seule la bonne réponse se choisit.
  libelleFige?: boolean;
  onLabel: (label: string) => void;
  onToggle: () => void;
  onRetirer?: () => void;
}

export const LETTRES = ["A", "B", "C", "D"] as const;

// Bonne réponse d'un tap : le rond de 44 px est un bouton à bascule (aria-pressed), l'état coché ne repose pas que sur la couleur.
export function TuileReponseEditable({ index, label, isCorrect, libelleFige = false, onLabel, onToggle, onRetirer }: Props) {
  const lettre = LETTRES[index] ?? String(index + 1);
  const champ = useRef<HTMLTextAreaElement>(null);

  // Sans field-sizing (Firefox, anciens Safari), la hauteur suit le contenu à la main.
  useLayoutEffect(() => {
    const el = champ.current;
    if (!el || CSS.supports("field-sizing", "content")) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [label]);

  return (
    <div
      className={cn(
        "flex min-h-16 min-w-0 items-center gap-2 rounded-md border-trait border-vert-foret bg-creme p-2 shadow-relief-sm",
        isCorrect && "bg-vert-eclat text-vert-nuit",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "grid size-10 shrink-0 place-items-center rounded-sm bg-vert-foret font-affiche text-lg text-jaune-soleil",
          isCorrect && "bg-vert-nuit text-vert-eclat",
        )}
      >
        {lettre}
      </span>
      {libelleFige ? (
        <span className="min-w-0 flex-1 px-1 text-lg font-extrabold">{label}</span>
      ) : (
        // Un libellé tient sur une ligne logique mais peut en occuper plusieurs à l'écran : rien n'est masqué, Entrée ne casse rien.
        <textarea
          ref={champ}
          rows={1}
          value={label}
          maxLength={OPTION_LABEL_MAX}
          onChange={(e) => onLabel(e.target.value.replace(/[\r\n]+/g, " "))}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.preventDefault();
          }}
          placeholder={`Réponse ${lettre}`}
          aria-label={`Réponse ${lettre}`}
          className={cn(
            "field-sizing-content min-h-11 min-w-0 flex-1 resize-none bg-transparent px-1 py-2 text-lg leading-tight font-extrabold text-inherit placeholder:font-semibold",
            isCorrect ? "placeholder:text-vert-nuit" : "placeholder:text-vert-mousse",
          )}
        />
      )}
      {onRetirer ? (
        <button
          type="button"
          onClick={onRetirer}
          aria-label={`Retirer la réponse ${lettre}`}
          className="grid size-11 shrink-0 place-items-center rounded-full text-vert-nuit"
        >
          <X aria-hidden="true" className="size-5" />
        </button>
      ) : null}
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={isCorrect}
        aria-label={`Marquer ${lettre} comme bonne réponse`}
        className={cn(
          "grid size-11 shrink-0 place-items-center rounded-full border-trait border-dashed border-vert-foret text-vert-foret",
          "aria-pressed:border-solid aria-pressed:border-vert-nuit aria-pressed:bg-vert-nuit aria-pressed:text-vert-eclat",
        )}
      >
        <Check aria-hidden="true" className="size-5" strokeWidth={3} />
      </button>
    </div>
  );
}
