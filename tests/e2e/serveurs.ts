// Source unique des ports e2e : lue par playwright.config.ts et par les tests.
// Valeurs peu courantes pour ne jamais croiser un serveur d'un autre worktree.
export const PORT_PREVIEW = Number(process.env.E2E_PORT_PREVIEW ?? 4410);
export const PORT_DEV = Number(process.env.E2E_PORT_DEV ?? 4411);

export const URL_PREVIEW = `http://localhost:${PORT_PREVIEW}`;
// Les planches /dev/* n'existent qu'en DEV (404 sur le build).
export const URL_DEV = `http://localhost:${PORT_DEV}`;
