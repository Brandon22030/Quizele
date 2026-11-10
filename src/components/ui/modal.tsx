import { Dialogue, type DialogueProps } from "./dialogue";

/** Boîte centrée pour une confirmation courte (suppression, abandon). */
export function Modal(props: DialogueProps) {
  return <Dialogue variante="modal" {...props} />;
}
