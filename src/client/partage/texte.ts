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

export function truncateGraphemes(text: string, max: number): string {
  const parts = graphemes(text);
  if (parts.length <= max) return text;
  if (max <= 0) return "";
  return parts.slice(0, max - 1).join("").trimEnd() + ELLIPSE;
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

/** Retourne au plus `maxLines` lignes ; la dernière est coupée avec une ellipse si le texte ne tient pas. */
export function wrapLines(measure: Measure, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (let i = 0; i < words.length; i++) {
    const candidate = current ? `${current} ${words[i]}` : words[i];
    if (measure(candidate) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = words[i];
    if (lines.length === maxLines - 1) {
      current = words.slice(i).join(" ");
      break;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, maxLines).map((line) => fitText(measure, line, maxWidth));
}
