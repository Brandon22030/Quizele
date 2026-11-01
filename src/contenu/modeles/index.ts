import { creationEtExode } from "./creation-et-exode";
import { figuresAncienTestament } from "./figures-ancien-testament";
import type { Modele } from "./types";
import { vieDeJesus } from "./vie-de-jesus";

export type { Modele } from "./types";

export const MODELES: readonly Modele[] = [figuresAncienTestament, vieDeJesus, creationEtExode];

export function trouverModele(id: string): Modele | undefined {
  return MODELES.find((modele) => modele.id === id);
}
