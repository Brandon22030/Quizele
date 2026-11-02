// Logique pure de la connexion : aucune dépendance au DOM ni à React, donc testable seule.
// Le serveur revalide tout (e-mail, quotas, callbackURL) : ces contrôles ne servent qu'à guider la saisie.

const MAX_EMAIL_LENGTH = 254;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export const DELAI_RENVOI_SECONDES = 60;
export const MESSAGE_TROP_DE_DEMANDES = "Trop de demandes, réessaie dans une minute.";
const MESSAGE_GENERIQUE = "Quelque chose n'a pas fonctionné. Réessaie dans un instant.";

export type ResultatEmail = { ok: true; email: string } | { ok: false; message: string };

export function validerEmail(saisie: string): ResultatEmail {
  const email = saisie.trim();
  if (!email) return { ok: false, message: "Saisis ton adresse e-mail." };
  if (email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email)) {
    return { ok: false, message: "Cette adresse e-mail n'a pas l'air valide." };
  }
  return { ok: true, email };
}

// safeReturnPath attend la valeur brute du paramètre (décodée une seule fois par lui) : URLSearchParams
// la décoderait déjà, d'où cette lecture directe de la chaîne de requête.
export function retourBrut(search: string): string | null {
  const trouve = /(?:^|[?&])retour=([^&]*)/.exec(search);
  return trouve ? trouve[1]! : null;
}

// Codes d'erreur ajoutés par Better Auth au paramètre `error` quand il redirige vers /connexion.
export function messageErreurRedirection(code: string | null | undefined): string | null {
  if (!code) return null;
  switch (code.toLowerCase()) {
    case "invalid_token":
    case "expired_token":
      return "Ce lien a expiré ou a déjà servi. Demande-en un nouveau.";
    case "state_mismatch":
    case "state_not_found":
      return "La connexion avec Google a expiré ou a été interrompue. Relance-la.";
    case "deconnexion":
      return "La déconnexion n'a pas pu être confirmée. Reconnecte-toi ou réessaie.";
    case "access_denied":
      return "La connexion avec Google a été refusée. Tu peux réessayer ou choisir une autre méthode.";
    default:
      return "La connexion a échoué. Réessaie dans un instant.";
  }
}

// Le 429 reste neutre : il ne dit jamais si c'est la limite par adresse, par IP ou le plafond quotidien.
export function messageDepuisStatut(statut: number): string {
  if (statut === 429) return MESSAGE_TROP_DE_DEMANDES;
  if (statut === 400) return "Cette adresse e-mail n'a pas l'air valide.";
  return MESSAGE_GENERIQUE;
}

export function urlErreurConnexion(retour: string): string {
  return `/connexion?retour=${encodeURIComponent(retour)}`;
}

// L'adresse ne figure jamais dans l'URL (historique, journaux) : elle voyage par sessionStorage.
export function urlVerification(retour: string): string {
  return `/connexion/verifier?retour=${encodeURIComponent(retour)}`;
}

export const CLE_EMAIL = "quizdeszeles:connexion-email";
export const CLE_ENVOI = "quizdeszeles:connexion-envoi";

// b***@gmail.com : assez pour reconnaître sa boîte, sans exposer l'adresse entière à l'écran.
export function masquerEmail(email: string): string {
  const arobase = email.lastIndexOf("@");
  if (arobase < 1) return "***";
  return `${email[0]}***${email.slice(arobase)}`;
}

type Stockage = Pick<Storage, "getItem" | "setItem">;

// Le stockage peut être indisponible (navigation privée, quota) : la page de confirmation sait s'en passer.
function essayer<T>(action: () => T, repli: T): T {
  try {
    return action();
  } catch {
    return repli;
  }
}

export function memoriserEnvoi(stockage: Stockage, maintenant: number, email?: string): void {
  essayer(() => {
    if (email) stockage.setItem(CLE_EMAIL, email);
    stockage.setItem(CLE_ENVOI, String(maintenant));
  }, undefined);
}

export function lireEmail(stockage: Stockage): string | null {
  const valeur = essayer(() => stockage.getItem(CLE_EMAIL), null);
  if (!valeur) return null;
  const verification = validerEmail(valeur);
  return verification.ok ? verification.email : null;
}

export function lireEnvoi(stockage: Stockage): number | null {
  const brut = essayer(() => stockage.getItem(CLE_ENVOI), null);
  const valeur = brut === null ? NaN : Number(brut);
  return Number.isFinite(valeur) ? valeur : null;
}

// Un horodatage dans le futur (horloge reculée) est borné : le délai ne dépasse jamais DELAI_RENVOI_SECONDES.
export function secondesRestantes(envoiMs: number, maintenantMs: number): number {
  const ecoule = Math.max(0, Math.floor((maintenantMs - envoiMs) / 1000));
  return Math.max(0, DELAI_RENVOI_SECONDES - ecoule);
}

type Fetcher = typeof fetch;
export type ResultatAppel<T = undefined> = { ok: true; donnees: T } | { ok: false; message: string };

// Content-Type JSON obligatoire : sans lui le serveur répond 415.
async function postJson(chemin: string, corps: unknown, appel: Fetcher): Promise<Response | null> {
  try {
    return await appel(chemin, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corps),
      credentials: "same-origin",
    });
  } catch {
    return null;
  }
}

export async function demanderLienMagique(email: string, retour: string, appel: Fetcher = fetch): Promise<ResultatAppel> {
  const reponse = await postJson(
    "/api/auth/sign-in/magic-link",
    { email, callbackURL: retour, errorCallbackURL: urlErreurConnexion(retour) },
    appel,
  );
  if (!reponse) return { ok: false, message: "Impossible de joindre le serveur. Vérifie ta connexion." };
  return reponse.ok ? { ok: true, donnees: undefined } : { ok: false, message: messageDepuisStatut(reponse.status) };
}

export async function demanderUrlGoogle(retour: string, appel: Fetcher = fetch): Promise<ResultatAppel<string>> {
  const reponse = await postJson(
    "/api/auth/sign-in/social",
    { provider: "google", callbackURL: retour, errorCallbackURL: urlErreurConnexion(retour) },
    appel,
  );
  if (!reponse) return { ok: false, message: "Impossible de joindre le serveur. Vérifie ta connexion." };
  if (!reponse.ok) return { ok: false, message: messageDepuisStatut(reponse.status) };
  try {
    const corps = (await reponse.json()) as { url?: unknown };
    if (typeof corps.url === "string" && corps.url) return { ok: true, donnees: corps.url };
  } catch {
    // Corps illisible : traité comme un échec ci-dessous.
  }
  return { ok: false, message: "La connexion avec Google n'a pas pu démarrer. Réessaie." };
}
