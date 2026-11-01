export const CODE_LENGTH = 6;

// Majuscules sans accent, lettres et chiffres seulement : même alphabet que le code serveur.
export function sanitizeCode(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

export interface CodeEdit {
  value: string;
  // Case à focaliser après l'édition.
  focus: number;
}

// Saisie dans une case déjà remplie : le navigateur renvoie ancien + nouveau caractère, on garde le nouveau.
export function extractTyped(previous: string | undefined, raw: string): string {
  if (previous && raw.length === 2) return sanitizeCode(raw.replace(previous, ""));
  return sanitizeCode(raw);
}

// Saisie ou collage à partir de la case `index` : écrase vers la droite, jamais plus de 6 caractères.
export function insertAt(value: string, index: number, raw: string): CodeEdit {
  const chars = sanitizeCode(raw);
  if (chars === "") return { value, focus: Math.min(index, CODE_LENGTH - 1) };
  const start = Math.min(index, value.length);
  const next = (value.slice(0, start) + chars + value.slice(start + chars.length)).slice(0, CODE_LENGTH);
  return { value: next, focus: Math.min(start + chars.length, CODE_LENGTH - 1) };
}

// Retour arrière : efface la case courante si elle est remplie, sinon la précédente.
export function backspaceAt(value: string, index: number): CodeEdit {
  if (index < value.length) return { value: value.slice(0, index) + value.slice(index + 1), focus: index };
  if (index === 0 || value.length === 0) return { value, focus: 0 };
  const prev = Math.min(index, value.length) - 1;
  return { value: value.slice(0, prev) + value.slice(prev + 1), focus: prev };
}
