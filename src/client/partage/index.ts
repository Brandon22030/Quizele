// Règle d'usage pour les pages (résultat joueur, bilan animateur) :
// 1. Dès l'affichage de l'écran de résultat, charger ce module par `import()` et générer le PNG
//    (renderResultImage ou renderLeaderboardImage), puis garder le Blob.
// 2. Au clic sur « Partager », appeler seulement sharePng avec ce Blob, sans import ni rendu entre-temps.
// Raison : Safari iOS n'accepte navigator.share que pendant le geste utilisateur ; un chargement de module ou un
// rendu de canvas entre le clic et share le fait expirer (NotAllowedError, repli en téléchargement).
// Le résultat de sharePng s'annonce avec messagePartage dans une région role="status".
export { renderLeaderboardImage, renderResultImage } from "./rendu";
export { messagePartage, sharePng, type ShareDeps } from "./partage";
export type {
  LeaderboardShareData,
  ResultShareData,
  ShareFormat,
  ShareOptions,
  ShareRankingEntry,
  ShareResult,
} from "./types";
