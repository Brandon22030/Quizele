import { choixMultiple, choixUnique, vraiFaux } from "./aide";
import type { Modele } from "./types";

export const creationEtExode: Modele = {
  id: "creation-et-exode",
  title: "De la création à l'Exode",
  description: "Les premiers récits de la Bible, de la lumière du premier jour à la mer Rouge.",
  category: "Bible",
  mode: "together",
  questions: [
    choixUnique("Quel est le premier livre de la Bible ?", "La Genèse", ["L'Exode", "Les Psaumes", "Matthieu"], "Genèse 1:1"),
    choixUnique("Qu'est-ce que Dieu crée le premier jour ?", "La lumière", ["Les étoiles", "Les animaux", "L'homme"], "Genèse 1:3-5"),
    vraiFaux("Dieu s'est reposé le septième jour.", true, "Genèse 2:2"),
    choixMultiple(
      "Lesquelles sont des plaies d'Égypte ?",
      ["Le sang", "Les grenouilles"],
      ["La neige", "Le tremblement de terre"],
      "Exode 7 et 8",
      "Les eaux du Nil changées en sang, puis les grenouilles, ouvrent la série des plaies.",
    ),
    choixUnique("Quelle mer le peuple a-t-il traversée à pied sec avec Moïse ?", "La mer Rouge", ["La mer Morte", "Le lac de Tibériade", "La mer Méditerranée"], "Exode 14:21-22"),
  ],
};
