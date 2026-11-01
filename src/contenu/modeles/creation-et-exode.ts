import { choixMultiple, choixUnique, vraiFaux } from "./aide";
import type { Modele } from "./types";

export const creationEtExode: Modele = {
  id: "creation-et-exode",
  title: "De la création à l'Exode",
  description: "Les premiers récits de la Bible, de la lumière du premier jour à la mer Rouge.",
  category: "Bible",
  mode: "together",
  questions: [
    choixUnique("Quel est le premier livre de la Bible ?", ["L'Exode", "Les Psaumes", "La Genèse", "Matthieu"], 2, "Genèse 1:1"),
    choixUnique("Qu'est-ce que Dieu crée le premier jour ?", ["Les étoiles", "La lumière", "Les animaux", "L'homme"], 1, "Genèse 1:3-5"),
    vraiFaux("Dieu s'est reposé le septième jour.", true, "Genèse 2:2"),
    vraiFaux("Dieu a créé l'homme le cinquième jour.", false, "Genèse 1:27-31", "L'homme est créé le sixième jour, après les animaux de la terre."),
    choixMultiple(
      "Lesquelles sont des plaies d'Égypte ?",
      ["La neige", "Le sang", "Le tremblement de terre", "Les grenouilles"],
      [1, 3],
      "Exode 7 et 8",
      "Les eaux du Nil changées en sang, puis les grenouilles, ouvrent la série des plaies.",
    ),
    vraiFaux("L'Égypte a été frappée de sept plaies.", false, "Exode 7 à 12", "Il y a eu dix plaies, la dernière étant la mort des premiers-nés."),
    choixUnique(
      "Quelle mer le peuple a-t-il traversée à pied sec avec Moïse ?",
      ["La mer Morte", "Le lac de Tibériade", "La mer Méditerranée", "La mer Rouge"],
      3,
      "Exode 14:21-22",
    ),
  ],
};
