// Source unique des ports e2e : lue par playwright.config.ts et par les tests.
// Valeurs peu courantes pour ne jamais croiser un serveur d'un autre worktree.
export const PORT_PREVIEW = Number(process.env.E2E_PORT_PREVIEW ?? 4410);
export const PORT_DEV = Number(process.env.E2E_PORT_DEV ?? 4411);

export const URL_PREVIEW = `http://localhost:${PORT_PREVIEW}`;
// Les planches /dev/* n'existent qu'en DEV (404 sur le build).
export const URL_DEV = `http://localhost:${PORT_DEV}`;

// Ports que Chromium refuse d'ouvrir (ERR_UNSAFE_PORT), limités à la plage utile ici. Les ouvrir exigerait un drapeau de
// lancement du navigateur : on les évite à la place.
const PORTS_BLOQUES = new Set([4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697]);

/**
 * Port d'un serveur dédié à un spec : base + décalage du spec + 100 par worker Playwright, de sorte que deux workers ne
 * visent jamais le même port. Un port refusé par Chromium est décalé de 500 (déterministe, donc stable pour un même appel).
 * Espacer d'au moins 1000 les E2E_PORT_PREVIEW de deux worktrees lancés en parallèle : le décalage par worker (100) et
 * les décalages de specs (jusqu'à une centaine) feraient sinon se croiser leurs plages.
 */
export function portDedie(decalage: number, base = PORT_PREVIEW): number {
  let port = base + decalage + Number(process.env.TEST_PARALLEL_INDEX ?? 0) * 100;
  while (PORTS_BLOQUES.has(port)) port += 500;
  return port;
}
