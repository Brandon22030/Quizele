export function formatDuree(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const secondes = total % 60;
  return minutes > 0 ? `${minutes} min ${secondes} s` : `${secondes} s`;
}

export const libelleJustes = (n: number): string => `${n} ${n > 1 ? "justes" : "juste"}`;

export function initiale(pseudo: string): string {
  const [premier] = Array.from(pseudo.trim());
  return premier ? premier.toLocaleUpperCase("fr") : "?";
}
