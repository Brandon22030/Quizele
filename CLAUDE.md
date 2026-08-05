## Règles de ce projet

- Français partout : interface, commentaires, noms de fichiers de contenu.
  Le code (variables, fonctions) reste en anglais.

- Mobile d'abord, sans exception. Toute maquette se conçoit à 390px de large
  puis s'élargit. Aucune fonctionnalité ne doit être réservée au bureau.

- Interdiction absolue d'inventer une couleur, une taille de police, un rayon
  ou un espacement. Tout vient des jetons définis dans app/globals.css.
  Aucune valeur arbitraire Tailwind (pas de text-[13px], pas de bg-[#123456]).

- Aucun appel client à la table `options` de Supabase : elle contient les
  bonnes réponses. Tout le déroulé du jeu passe par les fonctions RPC.

- Le chronomètre s'appuie sur l'horodatage serveur renvoyé par les RPC,
  jamais sur Date.now() seul.

- Accessibilité : focus visible sur tout élément interactif, contraste AA
  minimum, prefers-reduced-motion respecté, cibles tactiles de 44px minimum.

- Les états vides, de chargement et d'erreur font partie de la fonctionnalité.
  Une page livrée sans ses trois états n'est pas terminée.

- Pas de commentaires évidents dans le code. Commente le pourquoi, pas le quoi.
