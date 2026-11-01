import { choixMultiple, choixUnique, vraiFaux } from "./aide";
import type { Modele } from "./types";

export const vieDeJesus: Modele = {
  id: "vie-de-jesus",
  title: "La vie de Jésus",
  description: "Naissance, apôtres, miracles : six questions sur les évangiles.",
  category: "Bible",
  mode: "together",
  questions: [
    choixUnique("Dans quelle ville Jésus est-il né ?", "Bethléem", ["Nazareth", "Jérusalem", "Capernaüm"], "Luc 2:4-7"),
    choixUnique("Combien d'apôtres Jésus a-t-il choisis ?", "Douze", ["Sept", "Dix", "Quatorze"], "Luc 6:13"),
    vraiFaux("Jésus a changé l'eau en vin lors d'une noce à Cana.", true, "Jean 2:1-11", "C'est le premier signe que Jésus accomplit dans l'évangile de Jean."),
    choixMultiple("Lesquels faisaient partie des douze apôtres ?", ["Pierre", "Jean"], ["Paul", "Timothée"], "Luc 6:13-16"),
    choixUnique("Qui a baptisé Jésus dans le Jourdain ?", "Jean-Baptiste", ["Pierre", "Jacques", "Barnabas"], "Matthieu 3:13-17"),
    vraiFaux("Jésus a nourri la foule avec cinq pains et deux poissons.", true, "Matthieu 14:17-21"),
  ],
};
