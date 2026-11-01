import { choixMultiple, choixUnique, vraiFaux } from "./aide";
import type { Modele } from "./types";

export const figuresAncienTestament: Modele = {
  id: "figures-ancien-testament",
  title: "Grandes figures de l'Ancien Testament",
  description: "Noé, Abraham, Moïse, David, Joseph, Jonas : sept questions pour retrouver les grands récits.",
  category: "Bible",
  mode: "together",
  questions: [
    choixUnique("Qui a construit l'arche ?", ["Moïse", "Noé", "Abraham", "David"], 1, "Genèse 6:14", "Dieu demande à Noé de se faire une arche."),
    vraiFaux(
      "David a vaincu Goliath avec une fronde et une pierre.",
      true,
      "1 Samuel 17:49",
      "David n'avait ni épée ni armure : une pierre lancée à la fronde a suffi.",
    ),
    vraiFaux("Jonas a été avalé par un lion.", false, "Jonas 1:17", "Dieu fait venir un grand poisson pour engloutir Jonas."),
    choixMultiple(
      "Lesquels sont des fils de Jacob ?",
      ["Samuel", "Joseph", "Aaron", "Juda"],
      [1, 3],
      "Genèse 35:22-26",
      "Ce passage énumère les douze fils de Jacob.",
    ),
    choixUnique("Qui a reçu les dix commandements sur le mont Sinaï ?", ["Josué", "Élie", "Moïse", "Salomon"], 2, "Exode 20:1-17"),
    vraiFaux(
      "Abraham est le fils de Jacob.",
      false,
      "Genèse 21:3 et 25:26",
      "C'est l'inverse : Abraham est le père d'Isaac, et Isaac le père de Jacob.",
    ),
    vraiFaux("Joseph a été vendu par ses frères.", true, "Genèse 37:28", "Ses frères l'ont vendu à des marchands qui l'ont emmené en Égypte."),
  ],
};
