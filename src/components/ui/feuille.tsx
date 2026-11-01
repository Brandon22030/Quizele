import { Dialogue, type DialogueProps } from "./dialogue";

/** Panneau qui monte du bas de l'écran (mobile) : liste des questions, choix secondaires. */
export function Feuille(props: DialogueProps) {
  return <Dialogue variante="feuille" {...props} />;
}
