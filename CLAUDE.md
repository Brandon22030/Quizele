## Règles de ce projet

- Français partout : interface, commentaires, noms de fichiers de contenu.
  Le code (variables, fonctions) reste en anglais.

- Mobile d'abord, sans exception. Toute maquette se conçoit à 390px de large
  puis s'élargit. Aucune fonctionnalité ne doit être réservée au bureau.

- Interdiction absolue d'inventer une couleur, une taille de police, un rayon
  ou un espacement. Tout vient des jetons définis dans src/styles/global.css.
  Aucune valeur arbitraire Tailwind (pas de text-[13px], pas de bg-[#123456])
  et aucune classe utilitaire qui n'existe pas dans le CSS compilé.
  `npm run lint:jetons` contrôle ces règles.

- Les bonnes réponses vivent uniquement dans D1 et le Durable Object. Elles ne
  transitent jamais par une Action, un îlot ou un message avant la révélation.

- Le chronomètre s'appuie sur src/shared/clock.ts (startedAt et serverNow reçus
  du Durable Object), jamais sur Date.now() seul.

- Accessibilité : focus visible sur tout élément interactif, contraste AA
  minimum, prefers-reduced-motion respecté, cibles tactiles de 44px minimum.

- Les états vides, de chargement et d'erreur font partie de la fonctionnalité.
  Une page livrée sans ses trois états n'est pas terminée.

- Pas de commentaires évidents dans le code. Commente le pourquoi, pas le quoi.

- Le projet tourne sur l'offre gratuite de Cloudflare : aucun binding payant,
  pas de rendu d'image serveur (le PNG de partage se génère dans le navigateur),
  10 ms de CPU par invocation.

- Aucune commande Cloudflare distante (wrangler login, deploy, d1 create,
  secret put, migrations --remote, etc.) sans accord explicite de l'utilisateur.
  Tout se teste en local.

- Sécurité : garder `security.checkOrigin` actif, jamais de CORS avec
  credentials sur /_actions/* ni /api/*, jamais de cookie de session en
  SameSite=None.

## Points pratiques

- Plusieurs worktrees en parallèle : isoler les ports e2e avec E2E_PORT_PREVIEW
  et E2E_PORT_DEV (défauts 4410 et 4411), sinon les serveurs se croisent.
- `npm test` lance d'abord `npm run build` : le Worker testé est dist/server.
- Certains tests worker de charge peuvent échouer sous machine chargée ; les
  relancer seuls avant de conclure à une régression.
