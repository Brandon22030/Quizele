import { createAuth, type AuthEnv } from "./auth";

// Le contrôle d'origine d'Astro (security.checkOrigin) ne vise que les types de contenu d'un formulaire HTML
// et laisse passer une requête sans Origin ni Sec-Fetch-Site. Ici la règle est plus stricte et ne dépend pas
// du Content-Type : un envoi venu d'un autre site ne doit jamais pouvoir déconnecter l'animateur.
export function isCrossSiteRequest(request: Request): boolean {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") return true;
  const origin = request.headers.get("origin");
  return origin !== null && origin !== new URL(request.url).origin;
}

// Le formulaire de MenuCompte poste de l'urlencoded, que Better Auth refuse (415) : la déconnexion passe donc
// par l'API serveur, qui reçoit les cookies de la requête et renvoie ceux qui effacent la session.
export async function signOutResponse(env: AuthEnv, request: Request): Promise<Response> {
  if (isCrossSiteRequest(request)) return new Response("Déconnexion refusée depuis un autre site.", { status: 403 });
  const headers = new Headers({ location: "/" });
  if ((request.headers.get("cookie") ?? "").includes("session_token")) {
    const result = await createAuth(env, request).api.signOut({ headers: request.headers, asResponse: true });
    // Une panne (D1 indisponible...) ne doit pas se déguiser en déconnexion réussie : la session resterait active.
    if (result.status >= 500) throw new Error(`Déconnexion impossible (statut ${result.status}).`);
    for (const cookie of result.headers.getSetCookie()) headers.append("set-cookie", cookie);
  }
  return new Response(null, { status: 303, headers });
}
