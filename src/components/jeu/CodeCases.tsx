import { useRef, type ClipboardEvent, type KeyboardEvent } from "react";
import { CODE_LENGTH, backspaceAt, extractTyped, insertAt } from "./code-input";
import { cx, TRAIT } from "./cx";

interface Props {
  value: string;
  onChange: (value: string) => void;
  // Appelé quand les 6 cases sont remplies.
  onComplete?: (code: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  autoFocus?: boolean;
  className?: string;
}

const cases = Array.from({ length: CODE_LENGTH }, (_, i) => i);

export function CodeCases({ value, onChange, onComplete, disabled, invalid, describedBy, autoFocus, className }: Props) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  // Une seule case est dans l'ordre de tabulation : la première vide, ou la dernière si le code est complet.
  const active = Math.min(value.length, CODE_LENGTH - 1);

  const apply = (edit: { value: string; focus: number }) => {
    if (edit.value !== value) onChange(edit.value);
    if (edit.value.length === CODE_LENGTH && edit.value !== value) onComplete?.(edit.value);
    refs.current[edit.focus]?.focus();
  };

  const onKeyDown = (index: number, event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Backspace") {
      event.preventDefault();
      apply(backspaceAt(value, index));
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      refs.current[Math.max(0, index - 1)]?.focus();
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      refs.current[Math.min(CODE_LENGTH - 1, index + 1)]?.focus();
    }
  };

  const onPaste = (index: number, event: ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    apply(insertAt(value, index, event.clipboardData.getData("text")));
  };

  return (
    <div role="group" aria-label="Code de la partie" className={cx("flex justify-center gap-2", className)}>
      {cases.map((i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          value={value[i] ?? ""}
          onChange={(e) => apply(insertAt(value, i, extractTyped(value[i], e.target.value)))}
          onKeyDown={(e) => onKeyDown(i, e)}
          onPaste={(e) => onPaste(i, e)}
          onFocus={(e) => e.currentTarget.select()}
          tabIndex={i === active ? 0 : -1}
          aria-label={`Caractère ${i + 1} du code`}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          autoFocus={autoFocus && i === 0}
          disabled={disabled}
          type="text"
          inputMode="text"
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          className={cx(
            "h-16 w-12 rounded-sm border-vert-foret bg-creme text-center font-affiche text-2xl text-vert-foret uppercase shadow-relief-sm focus:bg-jaune-soleil",
            TRAIT,
            invalid && "border-piment",
          )}
        />
      ))}
    </div>
  );
}
