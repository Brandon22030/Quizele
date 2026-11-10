// Découpe de texte pour le canvas : coupe aux frontières de graphèmes pour ne jamais séparer un emoji composé.

export type Measure = (text: string) => number;

const ELLIPSE = "…";

export function graphemes(text: string): string[] {
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const segmenter = new Intl.Segmenter("fr", { granularity: "grapheme" });
    return Array.from(segmenter.segment(text), (s) => s.segment);
  }
  return Array.from(text);
}

/** Tient sur une ligne de `maxWidth` : coupe avec une ellipse si nécessaire. */
export function fitText(measure: Measure, text: string, maxWidth: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (measure(clean) <= maxWidth) return clean;
  const parts = graphemes(clean);
  let low = 0;
  let high = parts.length;
  // Recherche dichotomique : le plus long préfixe qui tient avec l'ellipse.
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (measure(parts.slice(0, mid).join("").trimEnd() + ELLIPSE) <= maxWidth) low = mid;
    else high = mid - 1;
  }
  return low === 0 ? ELLIPSE : parts.slice(0, low).join("").trimEnd() + ELLIPSE;
}
