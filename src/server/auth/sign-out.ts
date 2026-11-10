import { createAuth, type Auth, type AuthEnv } from "./auth";

// Le contrôle d'origine d'Astro (security.checkOrigin) ne vise que les types de contenu d'un formulaire HTML
// et laisse passer une requête sans Origin ni Sec-Fetch-Site. Ici la règle est plus stricte et ne dépend pas
// du Content-Type : un envoi venu d'un autre site ne doit jamais pouvoir déconnecter l'animateur.
export function isCrossSiteRequest(request: Request): boolean {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") return true;
  const origin = request.headers.get("origin");
  return origin !== null && origin !== new URL(request.url).origin;
}

export const SIGN_OUT_FAILED_LOCATION = "/connexion?error=deconnexion";

interface CookieAttributes {
  path?: string;
  secure?: boolean;
  sameSite?: string;
  httpOnly?: boolean;
  domain?: string;
}

function expiredCookie(name: string, attributes: CookieAttributes): string {
  const parts = [`${name}=`, "Max-Age=0", `Path=${attributes.path ?? "/"}`];
  if (attributes.domain) parts.push(`Domain=${attributes.domain}`);
  if (attributes.httpOnly) parts.push("HttpOnly");
  if (attributes.secure) parts.push("Secure");
  if (attributes.sameSite) parts.push(`SameSite=${attributes.sameSite.charAt(0).toUpperCase()}${attributes.sameSite.slice(1)}`);
  return parts.join("; ");
}

// Le formulaire de MenuCompte poste de l'urlencoded, que Better Auth refuse (415) : la déconnexion passe donc
// par l'API serveur, qui reçoit les cookies de la requête et renvoie ceux qui effacent la session.
// `auth` n'est injecté que par les tests : Better Auth avale lui-même les erreurs D1 de signOut, une panne
// qui remonte en 5xx ou en exception ne se provoque donc pas depuis la base.
export async function signOutResponse(
  env: AuthEnv,
  request: Request,
  createAuthFor: (env: AuthEnv, request: Request) => Pick<Auth, "api" | "$context"> = createAuth,
): Promise<Response> {
  if (isCrossSiteRequest(request)) return new Response("Déconnexion refusée depuis un autre site.", { status: 403 });
  if (!(request.headers.get("cookie") ?? "").includes("session_token")) {
    return new Response(null, { status: 303, headers: { location: "/" } });
  }
  const auth = createAuthFor(env, request);
  const failure = await auth.api
    .signOut({ headers: request.headers, asResponse: true })
    .then((result) => (result.status >= 500 ? `statut ${result.status}` : result))
    .catch((error: unknown) => (error instanceof Error ? error.name : "erreur inconnue"));
  if (failure instanceof Response) {
    const headers = new Headers({ location: "/" });
    for (const cookie of failure.headers.getSetCookie()) headers.append("set-cookie", cookie);
    return new Response(null, { status: 303, headers });
  }
  // Panne côté serveur (D1 indisponible...) : la ligne de session survit peut-être, mais ce navigateur ne doit plus
  // l'utiliser. On expire ses cookies avec les attributs de Better Auth, et l'écran de connexion dit la vérité
  // au lieu de feindre une déconnexion confirmée.
  console.error(`[auth] déconnexion non confirmée (${failure}).`);
  const { authCookies } = await auth.$context;
  const headers = new Headers({ location: SIGN_OUT_FAILED_LOCATION });
  for (const cookie of [authCookies.sessionToken, authCookies.sessionData]) {
    headers.append("set-cookie", expiredCookie(cookie.name, cookie.attributes as CookieAttributes));
  }
  return new Response(null, { status: 303, headers });
}
