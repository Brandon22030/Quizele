import { env } from "cloudflare:workers";
import { defineMiddleware } from "astro:middleware";
import { getSessionUser } from "./server/auth/session";
import { isProtectedPath, loginRedirectUrl, shouldResolveSession } from "./server/auth/routes";

export const onRequest = defineMiddleware(async (context, next) => {
  const { request, url } = context;
  context.locals.user = shouldResolveSession(url.pathname) ? await getSessionUser(env, request) : null;
  if (!context.locals.user && isProtectedPath(url.pathname)) {
    return context.redirect(loginRedirectUrl(url));
  }
  return next();
});
