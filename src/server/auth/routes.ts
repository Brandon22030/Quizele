// Routes réservées aux animateurs. `/j/*`, `/`, `/api/parties/*` et `/api/auth/*` restent publiques.
export const PROTECTED_PREFIXES = ["/tableau-de-bord", "/quiz", "/partie"] as const;
// Pages publiques qui affichent l'utilisateur connecté (en-tête, bouton de connexion).
const USER_AWARE_PATHS = ["/", "/connexion"];
const DEFAULT_RETURN_PATH = "/tableau-de-bord";
const MAX_RETURN_LENGTH = 512;

export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

// Les joueurs (/j/*, /api/parties/*) sont anonymes et nombreux : résoudre la session y coûterait une requête D1
// par appel pour rien.
export function shouldResolveSession(pathname: string): boolean {
  return isProtectedPath(pathname) || USER_AWARE_PATHS.includes(pathname);
}

export function loginRedirectUrl(url: URL): string {
  return `/connexion?retour=${encodeURIComponent(url.pathname + url.search)}`;
}

// eslint-disable-next-line no-control-regex -- on cherche justement les caractères de contrôle.
const FORBIDDEN_CHARS = /[\u0000-\u001f\u007f\\]/;

function decodeOnce(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    // Séquence % mal formée : la valeur est refusée, le repli s'applique.
    return null;
  }
}

// `retour` est la valeur brute du paramètre, encodée comme le fait loginRedirectUrl ; elle n'est décodée
// qu'une fois pour qu'un double encodage (%252F%252F) ne devienne jamais un `//` exploitable.
export function safeReturnPath(retour: string | null | undefined, origin: string): string {
  if (!retour || retour.length > MAX_RETURN_LENGTH) return DEFAULT_RETURN_PATH;
  const path = decodeOnce(retour);
  if (path === null || path.length > MAX_RETURN_LENGTH) return DEFAULT_RETURN_PATH;
  if (!path.startsWith("/") || path.startsWith("//") || path.startsWith("/\\")) return DEFAULT_RETURN_PATH;
  if (FORBIDDEN_CHARS.test(path)) return DEFAULT_RETURN_PATH;
  const expectedOrigin = new URL(origin).origin;
  const target = new URL(path, expectedOrigin);
  if (target.origin !== expectedOrigin) return DEFAULT_RETURN_PATH;
  // Contrôle sur le chemin résolu : `/quiz/../ailleurs` est ramené à `/ailleurs` avant la comparaison.
  if (!isProtectedPath(target.pathname)) return DEFAULT_RETURN_PATH;
  return target.pathname + target.search;
}
