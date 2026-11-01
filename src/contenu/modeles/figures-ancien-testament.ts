import { choixMultiple, choixUnique, vraiFaux } from "./aide";
import type { Modele } from "./types";

export const figuresAncienTestament: Modele = {
  id: "figures-ancien-testament",
  title: "Grandes figures de l'Ancien Testament",
  description: "Noé, Moïse, David, Joseph : cinq questions pour retrouver les grands récits.",
  category: "Bible",
  mode: "together",
  questions: [
    choixUnique("Qui a construit l'arche ?", "Noé", ["Moïse", "Abraham", "David"], "Genèse 6:14", "Dieu demande à Noé de se faire une arche."),
    vraiFaux(
      "David a vaincu Goliath avec une fronde et une pierre.",
      true,
      "1 Samuel 17:49",
      "David n'avait ni épée ni armure : une pierre lancée à la fronde a suffi.",
    ),
    choixMultiple("Lesquels sont des fils de Jacob ?", ["Joseph", "Juda"], ["Samuel", "Aaron"], "Genèse 35:22-26", "Ce passage énumère les douze fils de Jacob."),
    choixUnique("Qui a reçu les dix commandements sur le mont Sinaï ?", "Moïse", ["Josué", "Élie", "Salomon"], "Exode 20:1-17"),
    vraiFaux("Joseph a été vendu par ses frères.", true, "Genèse 37:28", "Ses frères l'ont vendu à des marchands qui l'ont emmené en Égypte."),
  ],
};
