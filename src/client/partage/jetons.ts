// Lecture des jetons par getComputedStyle. Tailwind n'émet que les variables de thème utilisées :
// on lit donc des éléments sondes porteurs des classes d'utilitaires (les noms de classe sont écrits en
// toutes lettres pour que Tailwind les détecte), jamais des couleurs écrites ici.

export interface Jetons {
  couleurs: { jaune: string; creme: string; foret: string; nuit: string; vif: string; mousse: string };
  polices: { affiche: string; badge: string; note: string; texte: string };
  tailles: { sm: number; lg: number; xl: number; xxl: number; xxxl: number; quatre: number; cinq: number; six: number };
  espaces: { deux: number; trois: number; quatre: number; six: number; huit: number };
}

const SONDES = {
  jaune: "bg-jaune-soleil",
  creme: "bg-creme",
  foret: "bg-vert-foret",
  nuit: "bg-vert-nuit",
  vif: "bg-vert-vif",
  mousse: "bg-vert-mousse",
  affiche: "font-affiche",
  badge: "font-badge",
  note: "font-note",
  texte: "font-sans",
  sm: "text-sm",
  lg: "text-lg",
  xl: "text-xl",
  xxl: "text-2xl",
  xxxl: "text-3xl",
  quatre: "text-4xl",
  cinq: "text-5xl",
  six: "text-6xl",
  e2: "p-2",
  e3: "p-3",
  e4: "p-4",
  e6: "p-6",
  e8: "p-8",
} as const;

type Cle = keyof typeof SONDES;

export function lireJetons(doc: Document = document): Jetons {
  const conteneur = doc.createElement("div");
  conteneur.setAttribute("aria-hidden", "true");
  conteneur.className = "hidden";
  const sondes = {} as Record<Cle, HTMLElement>;
  for (const cle of Object.keys(SONDES) as Cle[]) {
    const sonde = doc.createElement("span");
    sonde.className = SONDES[cle];
    conteneur.appendChild(sonde);
    sondes[cle] = sonde;
  }
  // `hidden` (display: none) suffit pour résoudre couleurs, polices et tailles ; l'élément est retiré aussitôt.
  doc.body.appendChild(conteneur);
  const style = (cle: Cle) => getComputedStyle(sondes[cle]);
  const couleur = (cle: Cle) => style(cle).backgroundColor;
  const police = (cle: Cle) => style(cle).fontFamily;
  const taille = (cle: Cle) => Number.parseFloat(style(cle).fontSize);
  const espace = (cle: Cle) => Number.parseFloat(style(cle).paddingTop);
  const jetons: Jetons = {
    couleurs: {
      jaune: couleur("jaune"),
      creme: couleur("creme"),
      foret: couleur("foret"),
      nuit: couleur("nuit"),
      vif: couleur("vif"),
      mousse: couleur("mousse"),
    },
    polices: { affiche: police("affiche"), badge: police("badge"), note: police("note"), texte: police("texte") },
    tailles: {
      sm: taille("sm"),
      lg: taille("lg"),
      xl: taille("xl"),
      xxl: taille("xxl"),
      xxxl: taille("xxxl"),
      quatre: taille("quatre"),
      cinq: taille("cinq"),
      six: taille("six"),
    },
    espaces: { deux: espace("e2"), trois: espace("e3"), quatre: espace("e4"), six: espace("e6"), huit: espace("e8") },
  };
  conteneur.remove();
  return jetons;
}
