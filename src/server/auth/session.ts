import { createAuth, type AuthEnv } from "./auth";

export interface SessionUser {
  id: string;
  name: string | null;
  email: string;
}

// Sans cookie de session, inutile de construire Better Auth ni d'interroger D1 : économise CPU et requêtes.
const hasSessionCookie = (request: Request) => (request.headers.get("cookie") ?? "").includes("session_token");

export async function getSessionUser(env: AuthEnv, request: Request): Promise<SessionUser | null> {
  if (!hasSessionCookie(request)) return null;
  const session = await createAuth(env, request).api.getSession({ headers: request.headers });
  if (!session) return null;
  const { id, name, email } = session.user;
  return { id, name: name || null, email };
}
