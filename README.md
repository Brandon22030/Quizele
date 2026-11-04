# Quizdeszeles

Application de quiz en direct : un animateur crée un quiz, lance une partie, les joueurs rejoignent depuis leur téléphone avec un code. Interface en français, pensée mobile d'abord (390 px).

## Prérequis

- Node 24 (le champ `engines` de `package.json` exige au moins 22.23.4)
- npm
- Aucun compte Cloudflare n'est nécessaire en local : D1 et le Durable Object sont simulés par wrangler.

## Installation

```bash
npm ci
cp .dev.vars.example .dev.vars   # facultatif
```

`wrangler.jsonc` contient déjà des valeurs factices pour le développement local. `.dev.vars` (non versionné) sert à les surcharger : secrets Better Auth et jeton joueur, `MAIL_TRANSPORT` (`console` écrit le lien magique dans le journal, `resend` envoie réellement), identifiants Google, clé Resend. Ne jamais committer de vraie valeur.

`MAGIC_LINK_ENABLED` (lu dans `src/server/auth/auth.ts`, `true` par défaut) active la connexion par lien magique. Dans `wrangler.jsonc`, il vaut `true` en local et `false` en preview et production.

Préparer la base locale :

```bash
npm run db:migrate:local
npm run db:seed:local
```

## Commandes

| Commande | Rôle |
| --- | --- |
| `npm run dev` | serveur de développement Astro |
| `npm run build` | build Astro pour Cloudflare (dans `dist/`) |
| `npm run preview` | wrangler dev sur le build `dist/server/wrangler.json` |
| `npm run check` | `wrangler types` puis `astro check` |
| `npm run lint` | ESLint |
| `npm run lint:jetons` | contrôle des jetons de design (`scripts/verifier-jetons.mjs`) |
| `npm test` | build puis Vitest (projets `unit` et `worker`) |
| `npm run test:e2e` | Playwright (build et preview, plus astro dev) |
| `npm run test:charge` | simulation de 50 joueurs (`tests/charge/50-joueurs.mjs`) |
| `npm run db:generate` | génère une migration Drizzle |
| `npm run db:migrate:local` | applique les migrations sur la D1 locale |
| `npm run db:seed:local` | charge `scripts/seed-local.sql` en local |
| `npm run cf-typegen` | régénère les types des bindings |

## Architecture

```
Navigateur (îlots React, Astro, mobile d'abord)
   |  pages Astro, Actions (/_actions/*), API (/api/*)
   v
Worker (src/worker.ts, Astro SSR)
   |-- Better Auth : sessions, lien magique, Google (src/server/auth)
   |-- D1 via Drizzle : quiz, comptes, sessions de jeu, résultats (src/server/db)
   |-- Cron quotidien : purge (src/server/cron.ts)
   |
   +--> Durable Object GameSession (src/server/game)
          WebSocket des joueurs et de l'animateur, état de la partie,
          chronomètre, bonnes réponses jusqu'à la révélation
```

Dossiers utiles : `src/pages` (routes), `src/actions` (Actions Astro), `src/islands` (îlots par parcours), `src/components` (composants communs), `src/client` (temps réel et partage), `src/shared` (protocole, schéma de quiz, horloge), `src/styles/global.css` (jetons), `migrations/` (SQL D1), `tests/`.

Le chronomètre se calcule avec `src/shared/clock.ts` à partir de l'horodatage serveur. Pas de R2 : l'image de partage (PNG) est générée dans le navigateur (`src/client/partage`).

## Offre gratuite et limites

Le projet vise l'offre Workers gratuite : aucun binding payant, pas de rendu d'image côté serveur.

- CPU : 10 ms par invocation.
- Requêtes Workers : 100 000 par jour. Les assets statiques sont gratuits.
- D1 : 5 millions de lignes lues et 100 000 écrites par jour, 50 requêtes par invocation (un `batch()` compte pour une). Choix de conception : une écriture au démarrage de la partie, aucune pendant le jeu, un batch à la fin.
- Durable Object (SQLite) : 100 000 requêtes par jour.
- Quotas applicatifs : 20 lancements de partie par heure et par compte, 80 liens magiques par jour au total.
- Les chiffres Cloudflare évoluent : les revérifier dans la documentation avant tout déploiement.

## Tests

- Unitaires : `tests/unit` (Vitest, environnement Node).
- Worker : `tests/worker` (Vitest avec `@cloudflare/vitest-plugin`, D1 et Durable Object simulés sur le bundle `dist/server`). `npm test` lance ces deux projets après un build.
- E2E : `tests/e2e` (Playwright, viewports 390 px et 1280 px, axe-core). Les ports par défaut sont 4410 (preview) et 4411 (dev) ; en cas de worktrees parallèles, définir `E2E_PORT_PREVIEW` et `E2E_PORT_DEV`.

Avant une PR : `npm run check && npm run lint && npm run lint:jetons && npm test`.

## Sécurité

- Les bonnes réponses restent dans D1 et le Durable Object, jamais dans une Action, un îlot ou un message avant révélation.
- Garder `security.checkOrigin` actif dans `astro.config.mjs`.
- Ne jamais ajouter de CORS avec credentials sur `/_actions/*` ni `/api/*`.
- Ne jamais passer le cookie de session en `SameSite=None`.
- Aucun secret réel dans le dépôt : `.dev.vars` et `.env*` sont ignorés.

## Déploiement

Le déploiement (création des ressources Cloudflare, secrets, migrations distantes, preview puis production) est la tâche QZ-002-21. Il n'est pas fait et exige l'accord explicite du mainteneur avant chaque commande distante. Les identifiants `A_REMPLACER` de `wrangler.jsonc` sont renseignés à ce moment. Le lien magique est désactivé en preview et production tant qu'aucun domaine n'est vérifié chez Resend : seule la connexion Google y fonctionne. La CI (`.github/workflows/ci.yml`) ne déploie rien et n'utilise aucun secret Cloudflare.
