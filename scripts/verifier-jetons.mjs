// Garde-fou du système de jetons : échoue sur toute valeur qui ne vient pas de src/styles/global.css.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const racine = process.cwd();
const dossierSource = join(racine, "src");
const fichierJetons = join("src", "styles", "global.css");
const extensions = new Set([".astro", ".tsx", ".jsx", ".ts", ".js", ".mjs", ".css", ".html"]);
// L'horloge partagée est le seul endroit autorisé à lire l'heure locale du navigateur.
const fichierHorloge = join("src", "shared", "clock.ts");

// Multiples d'espacement déclarés dans global.css (--spacing-4 : 16px...) : p-4 est permis, p-7 ou size-4.5 non.
// Une valeur hors grille doit d'abord devenir un jeton nommé (--spacing-chrono...).
function multiplesDeclares() {
  try {
    const css = readFileSync(join(racine, fichierJetons), "utf8");
    return new Set([...css.matchAll(/--spacing-(\d+(?:\.\d+)?)\s*:/g)].map((m) => m[1]));
  } catch {
    return new Set();
  }
}
const declares = multiplesDeclares();
const prefixesEspacement =
  "p|px|py|pt|pr|pb|pl|ps|pe|m|mx|my|mt|mr|mb|ml|ms|me|gap|gap-x|gap-y|space-x|space-y|w|h|size|min-w|min-h|max-w|max-h|inset|inset-x|inset-y|top|right|bottom|left|start|end|basis|translate-x|translate-y";

const regles = [
  {
    nom: "classe Tailwind arbitraire",
    motif: /(?<![\w-])(?:[a-z0-9-]+:)*-?[a-z][a-z0-9]*(?:-[a-z0-9]+)*-\[[^\]\s]+\]/g,
    applicable: () => true,
  },
  {
    nom: "multiple d'espacement non déclaré dans global.css",
    motif: new RegExp(`(?<![\\w-])(?:[a-z0-9-]+:)*-?(?:${prefixesEspacement})-(\\d+(?:\\.\\d+)?)(?![\\w./%-])`, "g"),
    applicable: (chemin) => chemin !== fichierJetons,
    ignorer: (correspondance) => correspondance[1] === "0" || declares.has(correspondance[1]),
  },
  {
    nom: "couleur hexadécimale hors global.css",
    motif: /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/g,
    applicable: (chemin) => chemin !== fichierJetons,
  },
  {
    nom: "couleur fonctionnelle hors global.css",
    motif: /\b(?:rgb|rgba|hsl|hsla|oklch|oklab|lab|lch)\(/g,
    applicable: (chemin) => chemin !== fichierJetons,
  },
  {
    nom: "Date.now() interdit hors src/shared/clock.ts",
    motif: /\bDate\.now\(/g,
    applicable: (chemin) =>
      chemin !== fichierHorloge &&
      (chemin.startsWith(join("src", "islands") + sep) || chemin.startsWith(join("src", "components") + sep)),
  },
];

function* fichiers(dossier) {
  for (const entree of readdirSync(dossier)) {
    const chemin = join(dossier, entree);
    if (statSync(chemin).isDirectory()) yield* fichiers(chemin);
    else if (extensions.has(chemin.slice(chemin.lastIndexOf(".")))) yield chemin;
  }
}

let erreurs = 0;
for (const chemin of fichiers(dossierSource)) {
  const relatif = relative(racine, chemin);
  const contenu = readFileSync(chemin, "utf8");
  for (const regle of regles) {
    if (!regle.applicable(relatif)) continue;
    for (const correspondance of contenu.matchAll(regle.motif)) {
      if (regle.ignorer?.(correspondance)) continue;
      const ligne = contenu.slice(0, correspondance.index).split("\n").length;
      console.error(`${relatif}:${ligne} ${regle.nom} -> ${correspondance[0]}`);
      erreurs += 1;
    }
  }
}

if (erreurs > 0) {
  console.error(`\n${erreurs} violation(s) des jetons.`);
  process.exit(1);
}
console.log("Jetons : aucune violation.");
