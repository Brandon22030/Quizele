import { choixMultiple, choixUnique, vraiFaux } from "./aide";
import type { Modele } from "./types";

export const vieDeJesus: Modele = {
  id: "vie-de-jesus",
  title: "La vie de Jésus",
  description: "Naissance, apôtres, miracles : huit questions sur les évangiles.",
  category: "Bible",
  mode: "together",
  questions: [
    choixUnique("Dans quelle ville Jésus est-il né ?", ["Nazareth", "Jérusalem", "Bethléem", "Capernaüm"], 2, "Luc 2:4-7"),
    choixUnique("Combien d'apôtres Jésus a-t-il choisis ?", ["Sept", "Dix", "Quatorze", "Douze"], 3, "Luc 6:13"),
    vraiFaux("Jésus a changé l'eau en vin lors d'une noce à Cana.", true, "Jean 2:1-11", "C'est le premier signe que Jésus accomplit dans l'évangile de Jean."),
    choixMultiple("Lesquels faisaient partie des douze apôtres ?", ["Pierre", "Paul", "Jean", "Timothée"], [0, 2], "Luc 6:13-16"),
    vraiFaux("Pierre a renié Jésus une seule fois.", false, "Matthieu 26:69-75", "Pierre l'a renié trois fois avant le chant du coq."),
    choixUnique("Qui a baptisé Jésus dans le Jourdain ?", ["Pierre", "Jean-Baptiste", "Jacques", "Barnabas"], 1, "Matthieu 3:13-17"),
    vraiFaux("Judas a livré Jésus pour cinquante pièces d'argent.", false, "Matthieu 26:14-16", "Les chefs des prêtres lui ont donné trente pièces d'argent."),
    vraiFaux("Jésus a nourri la foule avec cinq pains et deux poissons.", true, "Matthieu 14:17-21"),
  ],
};
