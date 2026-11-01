// Mélange déterministe : la même graine donne toujours le même ordre. Le mode ensemble en tire un ordre unique pour
// toute la partie, le mode libre un ordre par joueur (graine dérivée de l'identifiant du joueur), sans rien stocker.

// FNV-1a 32 bits : suffisant pour disperser des graines textuelles, la qualité cryptographique n'est pas recherchée.
export function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

// mulberry32 : générateur 32 bits à état minimal.
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffleSeeded<T>(items: readonly T[], seed: string): T[] {
  const result = [...items];
  const next = random(hashSeed(seed));
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}
