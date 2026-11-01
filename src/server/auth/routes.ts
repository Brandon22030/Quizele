// Routes réservées aux animateurs. `/j/*`, `/`, `/api/parties/*` et `/api/auth/*` restent publiques.
const PROTECTED_PREFIXES = ["/tableau-de-bord", "/quiz", "/partie"];

export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export function loginRedirectUrl(url: URL): string {
  return `/connexion?retour=${encodeURIComponent(url.pathname + url.search)}`;
}
